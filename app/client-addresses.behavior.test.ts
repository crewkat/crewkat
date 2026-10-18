// Multiple saved addresses per client (Danny, 2026-10-15 — migration 0081).
//
// Danny does repeat work for the same clients at DIFFERENT addresses, so
// a client profile holds a LIST of saved addresses (label + address, one
// primary). The legacy single `address` field stays as the primary's
// mirror for every existing reader. Profiles accumulate addresses ONLY
// through explicit user action: the Clients-screen form (saveClient), the
// dedicated appendClientAddress action behind the document sheet's
// "Save to {client}'s addresses" opt-in, and the job/lead paths that have
// always owned the record. Document saves stay doc-only (278a20b): picking
// a saved address in DocClientSheet fills the document snapshot and
// writes NOTHING to the profile.
//
// Covers:
//  1. Journal/migration: newest tag is 0081_client_addresses, when
//     strictly greater than 0080's; the SQL adds addresses_json and
//     backfills each client's current address as the primary entry.
//  2. Backfill behavior: the migration's own UPDATE statement turns a
//     legacy address into the first saved entry; even without it, the
//     payload synthesizes the legacy address as primary (read fallback).
//  3. saveClient list CRUD: create with two addresses (legacy field
//     mirrors the primary), switch primary (mirror follows), remove an
//     entry, exact duplicates collapse, address-only save seeds the list.
//  4. appendClientAddress: appends exactly one entry without touching
//     the primary or any other field; a repeat append (case/space
//     variant) is a no-op; on an address-less profile the entry becomes
//     primary and mirrors; unknown client throws.
//  5. Doc-sheet flow at the action level: saveQuote with a picked client
//     + a new address leaves the profile byte-identical (list included);
//     the explicit append then adds exactly one entry; a later saveQuote
//     without the opt-in changes nothing further.
//  6. Job path coherence: createJob's client is born with the job
//     address as its primary saved entry; updateJob to a new address
//     promotes it to primary, keeping the other saved entries.
//  7. Static guards on the client UI wiring (sheet chips + opt-in,
//     clients-form editor, job-form chips, builders' append calls).
//
// Run from app/:  bun client-addresses.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- 1. Journal / migration -------------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number }> };
const byTag = Object.fromEntries(journal.entries.map((e) => [e.tag, e]));
check("newest migration tag is 0085_contract_opened_notify", journal.entries[journal.entries.length - 1]!.tag === "0085_contract_opened_notify", journal.entries[journal.entries.length - 1]!.tag);
check("0081 when strictly greater than 0080", byTag["0081_client_addresses"]!.when > byTag["0080_photo_pairs"]!.when);
const sql81 = await readFile(join("drizzle", "0081_client_addresses.sql"), "utf8");
check("0081 adds addresses_json column", sql81.includes("ALTER TABLE `clients` ADD COLUMN `addresses_json`"));
check("0081 backfills from the legacy address", sql81.includes("json_array(json_object(") && sql81.includes("WHERE trim(`address`) <> ''"));

// --- Scratch DB + ctx ---------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-client-addresses-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "client-addresses-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Addr Co", updatedAt: new Date() });

const clientRow = async (id: number) => (await db.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1))[0]!;
const clientRowJson = async (id: number) => JSON.stringify(await clientRow(id));
const listed = async (id: number) => (await A.listClients.handler(ctx, { search: "" })).clients.find((c: any) => c.id === id);

// --- 2. Backfill: the migration UPDATE turns a legacy address into entry #1 ---------
const [legacy] = await db.insert(schema.clients).values({
  companyId: 1, name: "Legacy Larry", phone: "", email: "", address: "12 Old Way, Tampa, FL",
  notes: "", tags: "[]", addressesJson: "[]", createdAt: new Date(), updatedAt: new Date(),
}).returning();
// Read fallback first: no stored list yet, payload still shows the primary.
const preBackfill = await listed(legacy!.id);
check("read fallback: legacy address surfaces as the primary entry", preBackfill?.addresses.length === 1 && preBackfill.addresses[0].address === "12 Old Way, Tampa, FL" && preBackfill.addresses[0].primary === true, JSON.stringify(preBackfill?.addresses));
// Now run the migration's own backfill statement verbatim.
const backfillSql = sql81.split("--> statement-breakpoint").map((s) => s.trim()).find((s) => s.startsWith("UPDATE"))!;
await sqlite.execute(backfillSql.replace(/;$/, ""));
const postBackfill = await listed(legacy!.id);
check("backfill: stored list holds the legacy address as primary", postBackfill?.addresses.length === 1 && postBackfill.addresses[0].address === "12 Old Way, Tampa, FL" && postBackfill.addresses[0].primary === true, JSON.stringify(postBackfill?.addresses));
check("backfill: stored JSON was written", (await clientRow(legacy!.id)).addressesJson.includes("12 Old Way, Tampa, FL"));

// --- 3. saveClient list CRUD ---------------------------------------------------------
const made = await A.saveClient.handler(ctx, {
  id: null, name: "Multi Property Mary", phone: "(813) 555-0111", email: "mary@example.com",
  address: "1 Home St, Trinity, FL",
  addresses: [
    { label: "Home", address: "1 Home St, Trinity, FL", primary: true },
    { label: "Rental — Tampa", address: "22 Rental Ave, Tampa, FL", primary: false },
  ],
  notes: "", tags: [], referredByClientId: null,
});
const mary = await listed(made.id);
check("saveClient create: both addresses saved", mary?.addresses.length === 2, JSON.stringify(mary?.addresses));
check("saveClient create: primary flagged on Home", mary?.addresses[0].label === "Home" && mary?.addresses[0].primary === true && mary?.addresses[1].primary === false);
check("saveClient create: legacy address mirrors the primary", mary?.address === "1 Home St, Trinity, FL", mary?.address);

// Switch primary to the rental.
await A.saveClient.handler(ctx, {
  id: made.id, name: "Multi Property Mary", phone: "(813) 555-0111", email: "mary@example.com",
  address: "1 Home St, Trinity, FL",
  addresses: [
    { label: "Home", address: "1 Home St, Trinity, FL", primary: false },
    { label: "Rental — Tampa", address: "22 Rental Ave, Tampa, FL", primary: true },
  ],
  notes: "", tags: [], referredByClientId: null,
});
const marySwitched = await listed(made.id);
check("primary switch: legacy address mirrors the new primary", marySwitched?.address === "22 Rental Ave, Tampa, FL", marySwitched?.address);
check("primary switch: exactly one primary", marySwitched?.addresses.filter((a: any) => a.primary).length === 1);

// Remove the rental + feed a duplicate of Home: list collapses to one entry.
await A.saveClient.handler(ctx, {
  id: made.id, name: "Multi Property Mary", phone: "(813) 555-0111", email: "mary@example.com",
  address: "22 Rental Ave, Tampa, FL",
  addresses: [
    { label: "Home", address: "1 Home St, Trinity, FL", primary: false },
    { label: "Copy", address: "1  home   st, Trinity, FL", primary: false },
  ],
  notes: "", tags: [], referredByClientId: null,
});
const maryDeduped = await listed(made.id);
check("edit: removal + duplicate collapse leaves one entry", maryDeduped?.addresses.length === 1 && maryDeduped.addresses[0].address === "1 Home St, Trinity, FL", JSON.stringify(maryDeduped?.addresses));
check("edit: a list with no flagged primary promotes the first entry", maryDeduped?.addresses[0].primary === true && maryDeduped?.address === "1 Home St, Trinity, FL");

// Address-only save (no list sent) seeds the list from the single field.
const seeded = await A.saveClient.handler(ctx, {
  id: null, name: "Single Address Sam", phone: "", email: "", address: "9 Solo Rd, Lutz, FL",
  addresses: [], notes: "", tags: [], referredByClientId: null,
});
const sam = await listed(seeded.id);
check("address-only save: list seeds with the typed address as primary", sam?.addresses.length === 1 && sam.addresses[0].address === "9 Solo Rd, Lutz, FL" && sam.addresses[0].primary === true, JSON.stringify(sam?.addresses));

// getClient carries the list too.
const got = await A.getClient.handler(ctx, { id: made.id });
check("getClient: payload carries the addresses list", Array.isArray(got.client?.addresses) && got.client.addresses.length === 1);

// --- 4. appendClientAddress -----------------------------------------------------------
const maryBeforeAppend = await clientRowJson(made.id);
const appended = await A.appendClientAddress.handler(ctx, { clientId: made.id, address: "400 Beach Blvd, Clearwater, FL", label: "Beach house" });
check("append: exactly one entry added", appended.addresses.length === 2, JSON.stringify(appended.addresses));
check("append: new entry keeps its label, not primary", appended.addresses[1].label === "Beach house" && appended.addresses[1].primary === false);
const maryAfterAppend = await clientRow(made.id);
check("append: primary + legacy address column unchanged", maryAfterAppend.address === "1 Home St, Trinity, FL");
check("append: name/phone/email untouched", maryAfterAppend.name === "Multi Property Mary" && maryAfterAppend.phone === "(813) 555-0111" && maryAfterAppend.email === "mary@example.com");
check("append: row actually changed (the append is a real write)", (await clientRowJson(made.id)) !== maryBeforeAppend);

const appendedAgain = await A.appendClientAddress.handler(ctx, { clientId: made.id, address: "400  beach   blvd, Clearwater, FL", label: "Dupe" });
check("append dedupe: case/space variant adds nothing", appendedAgain.addresses.length === 2, JSON.stringify(appendedAgain.addresses));
check("append dedupe: original label kept", appendedAgain.addresses[1].label === "Beach house");

const bare = await A.saveClient.handler(ctx, { id: null, name: "No Address Ned", phone: "", email: "", address: "", addresses: [], notes: "", tags: [], referredByClientId: null });
const bareAppend = await A.appendClientAddress.handler(ctx, { clientId: bare.id, address: "77 First St, Odessa, FL", label: "" });
check("append to empty profile: entry becomes primary", bareAppend.addresses.length === 1 && bareAppend.addresses[0].primary === true);
check("append to empty profile: legacy address mirrors it", (await clientRow(bare.id)).address === "77 First St, Odessa, FL");

let threw = false;
try { await A.appendClientAddress.handler(ctx, { clientId: 999999, address: "1 Nowhere", label: "" }); } catch { threw = true; }
check("append: unknown client throws", threw);

// --- 5. Doc-sheet flow: doc-only save, then the explicit opt-in append ------------------
const docFields = {
  jobId: null, clientPhone: "(813) 555-0111", clientEmail: "mary@example.com",
  shippingAddress: "", jobType: "Kitchen remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
const line = [{ name: "Cabinets", description: "Cabinet refinish", amount: "500.00", quantity: 1 }];
const maryProfileBefore = await clientRowJson(made.id);
const quote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: made.id, clientName: "Multi Property Mary",
  jobAddress: "500 Jobsite Ct, Palm Harbor, FL", // typed for THIS document only
  lineItems: line, subtotal: "500.00", total: "500.00",
  expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
});
check("doc-only: quote save leaves the profile byte-identical (list included)", (await clientRowJson(made.id)) === maryProfileBefore);
const quoteRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id)).limit(1))[0]!;
check("doc-only: the document carries the typed address as its snapshot", quoteRow.jobAddress === "500 Jobsite Ct, Palm Harbor, FL" && quoteRow.clientId === made.id);

// The opt-in append is its own explicit call (as the builders fire it
// after a successful save) — exactly one entry lands.
await A.appendClientAddress.handler(ctx, { clientId: made.id, address: "500 Jobsite Ct, Palm Harbor, FL", label: "" });
const maryAfterOptIn = await listed(made.id);
check("opt-in append: exactly one entry added after the doc save", maryAfterOptIn?.addresses.length === 3, JSON.stringify(maryAfterOptIn?.addresses));
check("opt-in append: it lands as a non-primary entry", maryAfterOptIn?.addresses.find((a: any) => a.address === "500 Jobsite Ct, Palm Harbor, FL")?.primary === false);

// A later document save without the opt-in changes nothing further.
const maryProfileAfterOptIn = await clientRowJson(made.id);
await A.saveInvoice.handler(ctx, {
  ...docFields, clientId: made.id, clientName: "Multi Property Mary",
  jobAddress: "600 Other Pl, Dunedin, FL",
  invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "500.00", total: "500.00",
  issueDate: "2026-10-15", dueDate: "", status: "draft",
  recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
});
check("doc-only: invoice save without the opt-in writes nothing to the profile", (await clientRowJson(made.id)) === maryProfileAfterOptIn);

// --- 6. Job path coherence --------------------------------------------------------------
const job = await A.createJob.handler(ctx, {
  clientId: null, clientName: "Job Path Jane", clientPhone: "(813) 555-0133", clientEmail: "",
  jobAddress: "700 Job Way, Trinity, FL", jobType: "Bathroom remodel", notes: "", jobDate: "2026-10-20",
  appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "",
});
const jobRow = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).limit(1))[0]!;
const jane = await listed(jobRow.clientId!);
check("job path: created client is born with the job address as primary entry", jane?.addresses.length === 1 && jane.addresses[0].address === "700 Job Way, Trinity, FL" && jane.addresses[0].primary === true, JSON.stringify(jane?.addresses));
// Give Jane a second saved address, then move the job: the new job address
// becomes primary WITHOUT dropping the saved one.
await A.appendClientAddress.handler(ctx, { clientId: jobRow.clientId!, address: "701 Second St, Trinity, FL", label: "Second home" });
await A.updateJob.handler(ctx, {
  id: job.id, clientId: jobRow.clientId, clientName: "Job Path Jane", clientPhone: "(813) 555-0133", clientEmail: "",
  jobAddress: "702 Moved Way, Trinity, FL", jobType: "Bathroom remodel", notes: "", jobDate: "2026-10-20",
  appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "", galleryPick: false,
});
const janeMoved = await listed(jobRow.clientId!);
check("job path: updateJob promotes the new job address to primary", janeMoved?.address === "702 Moved Way, Trinity, FL" && janeMoved?.addresses.find((a: any) => a.primary)?.address === "702 Moved Way, Trinity, FL", JSON.stringify(janeMoved?.addresses));
check("job path: the other saved entry survives the move", janeMoved?.addresses.some((a: any) => a.address === "701 Second St, Trinity, FL"));

// --- 7. Static guards on the client wiring -------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const sheetSlice = appSrc.slice(appSrc.indexOf("function DocClientSheet"), appSrc.indexOf("function JobDateSheet"));
check("static: doc sheet renders saved-address chips", sheetSlice.includes("doc-client-saved-addresses") && sheetSlice.includes("doc-client-saved-chip"));
check("static: doc sheet fills ONLY the document snapshot from a chip", sheetSlice.includes("onPatch({ jobAddress: entry.address })"));
check("static: opt-in copy exists EN + ES", sheetSlice.includes("Save to ${pickedClient!.name}'s addresses") && sheetSlice.includes("Guardar en las direcciones de ${pickedClient!.name}"));
check("static: builders fire appendClientAddress exactly twice (quote + invoice)", (appSrc.match(/api\.appendClientAddress/g) ?? []).length === 2, String((appSrc.match(/api\.appendClientAddress/g) ?? []).length));
check("static: append is gated on the opt-in state in both builders", (appSrc.match(/saveAddrToClient && form\.clientId/g) ?? []).length === 2);
const formSlice = appSrc.slice(appSrc.indexOf("function ClientForm"), appSrc.indexOf("function NewClientScreen"));
check("static: client form manages the address list", formSlice.includes("client-addresses-field") && formSlice.includes("client-address-row") && formSlice.includes("patchAddress"));
check("static: client form no longer renders the lone address input", !formSlice.includes('<span className="ck-label">{t.address}</span>'));
const jobFieldsSlice = appSrc.slice(appSrc.indexOf("function JobFields"), appSrc.indexOf("function ClientPicker"));
check("static: job form offers saved-address chips", jobFieldsSlice.includes("job-saved-addresses") && jobFieldsSlice.includes("jobAddress: entry.address"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
