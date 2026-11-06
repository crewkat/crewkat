// Audit Batch 5 (competitor picks) behavior tests — the new server
// surface, verified through the production response path
// (action.response.safeParse, exactly as server.mjs applies it):
//
//  1. Item 3: getClient / listClients totals follow the ONE money rule
//     (invoiceShape's paidApplied discipline): an overpayment becomes
//     credit, never inflated paid; last invoice / payment dates ride.
//  2. Item 5: bulkShiftAppointments moves a day's non-cancelled
//     appointments together, keeping times; cancelled stays put.
//  3. Item 6: attachJobMediaToDocument copies job photos/files into a
//     document's attachments (blob COPIED — deleting the attachment
//     leaves the job photo's blob intact); cross-job media is skipped;
//     an unlinked document refuses.
//  4. Item 7: draftWeeklyClientUpdate returns the template draft
//     (source "template") while the AI hookup is dormant — real
//     privileged getAiStatus with AI_API_KEY unset — in EN and ES,
//     carrying the week's log lines and the upcoming appointment.
//  5. Item 4: mergeClients (Batch 2) exists and is classified.
//  6. All three new actions are classified in ALL_ROLE_ACTIONS.
//
// Run from app/:  bun batch5-competitor-picks.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import * as privileged from "./server/src/privileged.ts";
import { ADMIN_ACTIONS, ALL_ROLE_ACTIONS } from "./server/src/permissions.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const dir = await mkdtemp(join(tmpdir(), "crewkat-batch5-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "batch5-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data as unknown as Uint8Array)); },
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async (key: string) => blobStore.get(key) ?? null,
    delete: async (key: string) => { blobStore.delete(key); },
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  // Real privileged AI handlers (env-driven): with AI_API_KEY unset,
  // getAiStatus reports configured:false — the dormant path.
  executePrivileged: async (fn: unknown, args: Record<string, unknown>) => {
    const name = (fn as { name?: string })?.name ?? "";
    if (name === "getAiStatus") return (privileged as any).getAiStatus(args);
    if (name === "aiComplete") return (privileged as any).aiComplete(args);
    throw new Error(`unexpected privileged call: ${name}`);
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "premium",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Batch5 Co", updatedAt: new Date() });
await db.insert(schema.authUsers).values({ id: 1, companyId: 1, name: "Owner", email: "owner@test.local", passwordHash: "x", passwordSalt: "x", tier: "premium", createdAt: new Date(), updatedAt: new Date() });

const dayMs = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = iso(new Date());
const daysAgo = (n: number) => iso(new Date(Date.now() - n * dayMs));
const daysAhead = (n: number) => iso(new Date(Date.now() + n * dayMs));

const docFields = {
  jobId: null, clientPhone: "", clientEmail: "",
  shippingAddress: "", jobType: "Remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
const line = [{ name: "Work", description: "Work item", amount: "100.00", quantity: 1 }];

// --- Seed: one client, one job, two invoices --------------------------------
const client = await A.saveClient.handler(ctx, { id: null, name: "Casey Client", phone: "555-0100", email: "", address: "9 Oak St", addresses: [], notes: "", tags: [], referredByClientId: null });
const jobRow = (await db.insert(schema.jobs).values({ companyId: 1, clientId: client.id, clientName: "Casey Client", jobAddress: "9 Oak St", jobType: "Bathroom remodel", jobDate: today }).returning({ id: schema.jobs.id }))[0]!;
const invA = await A.saveInvoice.handler(ctx, { ...docFields, jobId: jobRow.id, clientId: client.id, clientName: "Casey Client", jobAddress: "9 Oak St", invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "100.00", total: "100.00", issueDate: daysAgo(3), dueDate: "", status: "sent", recurringFrequency: "none", nextDueDate: "", recurringEndDate: "" });
const invB = await A.saveInvoice.handler(ctx, { ...docFields, jobId: jobRow.id, clientId: client.id, clientName: "Casey Client", jobAddress: "9 Oak St", invoiceNumber: "", quoteId: null, lineItems: [{ name: "Work", description: "Work item", amount: "50.00", quantity: 1 }], subtotal: "50.00", total: "50.00", issueDate: daysAgo(1), dueDate: "", status: "sent", recurringFrequency: "none", nextDueDate: "", recurringEndDate: "" });
// Overpay invoice A by $50 — the excess is credit, never "paid".
await A.addPayment.handler(ctx, { invoiceId: invA.id, amount: "150.00", paymentDate: daysAgo(2), method: "Card", note: "" });

// --- 1. Item 3: client money at a glance, one money rule ---------------------
const parsedClient = A.getClient.response.safeParse(await A.getClient.handler(ctx, { id: client.id }));
check("client: getClient survives safeParse", parsedClient.success, parsedClient.success ? "" : parsedClient.error.message);
const c = parsedClient.success ? parsedClient.data.client : null;
check("client: invoiced sums totals (100 + 50)", c?.totalInvoiced === 150, String(c?.totalInvoiced));
check("client: paid is paidApplied — overpay capped at 100, not 150", c?.totalPaid === 100, String(c?.totalPaid));
check("client: balance is the unpaid invoice only (50)", c?.balanceDue === 50, String(c?.balanceDue));
check("client: lastInvoiceAt is the newest issue date", c?.lastInvoiceAt === daysAgo(1), String(c?.lastInvoiceAt));
check("client: lastPaymentAt rides along", c?.lastPaymentAt === daysAgo(2), String(c?.lastPaymentAt));
const parsedList = A.listClients.response.safeParse(await A.listClients.handler(ctx, { search: "" }));
const listed = parsedList.success ? parsedList.data.clients.find((x: any) => x.id === client.id) : null;
check("client: listClients agrees with getClient", !!listed && listed.totalInvoiced === 150 && listed.totalPaid === 100 && listed.balanceDue === 50);

// --- 2. Item 5: bulk shift ----------------------------------------------------
const apptDate = daysAhead(2);
const mkAppt = async (startsAt: string, status: string) => (await db.insert(schema.appointments).values({ companyId: 1, jobId: jobRow.id, clientId: client.id, clientName: "Casey Client", clientPhone: "", startsAt, notes: "", status, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.appointments.id }))[0]!;
const appt1 = await mkAppt(`${apptDate}T09:00:00`, "scheduled");
const appt2 = await mkAppt(`${apptDate}T14:30:00`, "cancelled");
const parsedShift = A.bulkShiftAppointments.response.safeParse(await A.bulkShiftAppointments.handler(ctx, { date: apptDate, days: 3 }));
check("shift: survives safeParse", parsedShift.success, parsedShift.success ? "" : parsedShift.error.message);
check("shift: only the live appointment moved", parsedShift.success && parsedShift.data.moved === 1, JSON.stringify(parsedShift.success ? parsedShift.data : null));
const appt1After = (await db.select().from(schema.appointments).where(eq(schema.appointments.id, appt1.id)))[0]!;
const appt2After = (await db.select().from(schema.appointments).where(eq(schema.appointments.id, appt2.id)))[0]!;
check("shift: date moved +3, time kept", appt1After.startsAt === `${daysAhead(5)}T09:00:00`, appt1After.startsAt);
check("shift: cancelled appointment untouched", appt2After.startsAt === `${apptDate}T14:30:00`, appt2After.startsAt);

// --- 3. Item 6: attach job media to the invoice -------------------------------
blobStore.set("photos/p1.jpg", Buffer.from("photo-bytes"));
blobStore.set("files/f1.pdf", Buffer.from("pdf-bytes"));
const photo = (await db.insert(schema.photos).values({ companyId: 1, jobId: jobRow.id, stage: "during", caption: "Framing", blobKey: "photos/p1.jpg", filename: "framing.jpg", contentType: "image/jpeg", createdAt: new Date() }).returning({ id: schema.photos.id }))[0]!;
const jobFile = (await db.insert(schema.jobFiles).values({ companyId: 1, jobId: jobRow.id, title: "Permit", filename: "permit.pdf", blobKey: "files/f1.pdf", contentType: "application/pdf", createdAt: new Date() }).returning({ id: schema.jobFiles.id }))[0]!;
// A photo on ANOTHER job must not attach to this invoice.
const otherJob = (await db.insert(schema.jobs).values({ companyId: 1, clientId: client.id, clientName: "Casey Client", jobAddress: "10 Oak St", jobType: "Kitchen", jobDate: today }).returning({ id: schema.jobs.id }))[0]!;
const foreignPhoto = (await db.insert(schema.photos).values({ companyId: 1, jobId: otherJob.id, stage: "before", caption: "", blobKey: "photos/p1.jpg", filename: "other.jpg", contentType: "image/jpeg", createdAt: new Date() }).returning({ id: schema.photos.id }))[0]!;
const parsedAttach = A.attachJobMediaToDocument.response.safeParse(await A.attachJobMediaToDocument.handler(ctx, { docType: "invoice", docId: invA.id, photoIds: [photo.id, foreignPhoto.id], jobFileIds: [jobFile.id] }));
check("attach: survives safeParse", parsedAttach.success, parsedAttach.success ? "" : parsedAttach.error.message);
check("attach: 2 attached, foreign photo skipped", parsedAttach.success && parsedAttach.data.attached === 2, JSON.stringify(parsedAttach.success ? parsedAttach.data : null));
const parsedAttList = A.listDocumentAttachments.response.safeParse(await A.listDocumentAttachments.handler(ctx, { docType: "invoice", docId: invA.id }));
check("attach: list survives safeParse with picker data", parsedAttList.success && parsedAttList.data.jobId === jobRow.id && parsedAttList.data.jobPhotos.length === 1 && parsedAttList.data.jobFiles.length === 1, parsedAttList.success ? "" : parsedAttList.error.message);
const attRows = parsedAttList.success ? parsedAttList.data.attachments : [];
check("attach: two attachments listed (image + pdf)", attRows.length === 2 && attRows.some((a: any) => a.kind === "image") && attRows.some((a: any) => a.kind === "pdf"));
// The blob is a COPY: deleting the attachment must not kill the job photo.
const imgAtt = attRows.find((a: any) => a.kind === "image")!;
await A.deleteDocumentAttachment.handler(ctx, { id: imgAtt.id });
check("attach: deleting the attachment leaves the job photo's blob intact", blobStore.has("photos/p1.jpg"));
// An invoice with no job refuses.
const orphanInv = await A.saveInvoice.handler(ctx, { ...docFields, clientId: client.id, clientName: "Casey Client", jobAddress: "9 Oak St", invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "100.00", total: "100.00", issueDate: today, dueDate: "", status: "draft", recurringFrequency: "none", nextDueDate: "", recurringEndDate: "" });
let orphanRefused = false;
try { await A.attachJobMediaToDocument.handler(ctx, { docType: "invoice", docId: orphanInv.id, photoIds: [photo.id], jobFileIds: [] }); } catch { orphanRefused = true; }
check("attach: document without a job refuses", orphanRefused);

// --- 4. Item 7: weekly update draft (AI dormant → template) -------------------
await db.insert(schema.dailyLogs).values({ companyId: 1, jobId: jobRow.id, logDate: daysAgo(1), crew: "", hours: "6", notes: "", clientSummary: "Installed the shower pan and waterproofing.", sharedWithClient: true, createdAt: new Date(), updatedAt: new Date() });
const parsedWeekly = A.draftWeeklyClientUpdate.response.safeParse(await A.draftWeeklyClientUpdate.handler(ctx, { jobId: jobRow.id, lang: "en" }));
check("weekly: survives safeParse", parsedWeekly.success, parsedWeekly.success ? "" : parsedWeekly.error.message);
const wk = parsedWeekly.success ? parsedWeekly.data : null;
check("weekly: dormant AI degrades to the template", wk?.source === "template", String(wk?.source));
check("weekly: draft carries the week's log line", !!wk && wk.text.includes("Installed the shower pan and waterproofing."), wk?.text.slice(0, 200));
check("weekly: draft looks ahead to the upcoming appointment", !!wk && wk.text.includes("Coming up next week:") && wk.text.includes("•"), wk?.text.slice(0, 300));
check("weekly: draft greets the client and signs the company", !!wk && wk.text.startsWith("Hi Casey Client,") && wk.text.endsWith("Batch5 Co"));
const parsedWeeklyEs = A.draftWeeklyClientUpdate.response.safeParse(await A.draftWeeklyClientUpdate.handler(ctx, { jobId: jobRow.id, lang: "es" }));
check("weekly: ES draft is Spanish end to end", parsedWeeklyEs.success && parsedWeeklyEs.data.text.includes("Esta semana:") && parsedWeeklyEs.data.text.includes("La próxima semana:") && parsedWeeklyEs.data.source === "template");

// --- 5/6. Item 4 exists (Batch 2) + classification -----------------------------
check("merge: mergeClients action exists (Batch 2)", typeof A.mergeClients?.handler === "function");
for (const name of ["bulkShiftAppointments", "attachJobMediaToDocument", "draftWeeklyClientUpdate"]) {
  check(`permissions: ${name} is in ALL_ROLE_ACTIONS`, ALL_ROLE_ACTIONS.has(name));
}
// Merge deletes the duplicate record, so Batch 2 classified it with
// the other deletes: Admin-only, by design.
check("permissions: mergeClients is classified (ADMIN_ACTIONS, it deletes)", ADMIN_ACTIONS.has("mergeClients"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
