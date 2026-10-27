// Office Track 1b behavior tests (feature parity: schedule, photos,
// money & billing visibility, marketplace, settings basics).
//
// Track 1b is a CLIENT-side track: it adds no server actions and no
// migrations. These checks prove the new Office surfaces run on the SAME
// actions the phone uses, by driving the exact payloads the Office views
// send (the Schedule editor's saveAppointment payload, the Jobs photo
// upload's addPhoto payload, the Money view's getBillingOverview /
// listInvoices reads, the Marketplace view's listing/inbox/thread reads
// and text reply, and the Settings basics full-record updateSettings
// round-trip) against a scratch database.
//
// Run from app/:  bun office-track1b.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. Migrations: Track 1b itself added none; Track 1c has since added
// 0090_office_wave1, which is now the journal's newest entry. ---------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("journal newest entry is 0090_office_wave1 (1b added no migration)", last.tag === "0090_office_wave1", last.tag);

// --- 2. Scratch DB + in-memory blob store --------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-office-1b-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, { buf: Buffer; contentType: string }>();
const ctx = {
  slug: "tradesign",
  invocationId: "office-track1b-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async (key: string, buf: Buffer, opts?: { contentType?: string }) => { blobStore.set(key, { buf, contentType: opts?.contentType ?? "application/octet-stream" }); },
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async (key: string) => blobStore.get(key)?.buf ?? Buffer.alloc(0),
    delete: async (key: string) => { blobStore.delete(key); },
    head: async (key: string) => ({ contentType: blobStore.get(key)?.contentType ?? "application/octet-stream", size: blobStore.get(key)?.buf.length ?? 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

const A = (BaseActions as any);

// --- 3. Schedule: create via the Office editor payload, read via the phone's
//        listAppointments; edit, On-My-Way share, delete -----------------------
const officeApptPayload = {
  id: null,
  jobId: null,
  clientId: null,
  clientName: "Office Created Client",
  clientPhone: "813-555-0199",
  startsAt: "2026-11-05T14:30:00",
  notes: "Booked from the Office schedule",
  exteriorWork: true,
  status: "scheduled",
  crewMember: "Danny",
  etaMinutes: null,
};
const savedAppt = await A.saveAppointment.handler(ctx, officeApptPayload);
check("saveAppointment (Office payload) returns an id", typeof savedAppt.id === "number");

const listedAppts = await A.listAppointments.handler(ctx, {});
const apptRow = listedAppts.appointments.find((a: any) => a.id === savedAppt.id);
check("listAppointments (phone read) returns the Office-created appointment",
  !!apptRow && apptRow.clientName === "Office Created Client" && apptRow.startsAt === "2026-11-05T14:30:00" && apptRow.crewMember === "Danny" && apptRow.exteriorWork === true,
  JSON.stringify(apptRow));

await A.saveAppointment.handler(ctx, { ...officeApptPayload, id: savedAppt.id, status: "on_my_way", etaMinutes: 25 });
const listedAppts2 = await A.listAppointments.handler(ctx, {});
const apptRow2 = listedAppts2.appointments.find((a: any) => a.id === savedAppt.id);
check("saveAppointment edit round-trips status + ETA", apptRow2?.status === "on_my_way" && apptRow2?.etaMinutes === 25, JSON.stringify(apptRow2));

const share = await A.shareOnMyWay.handler(ctx, { appointmentId: savedAppt.id });
check("shareOnMyWay returns a token for the Office-created appointment", typeof share.token === "string" && share.token.length > 10);
const listedAppts3 = await A.listAppointments.handler(ctx, {});
check("listAppointments reports hasShareLink after sharing", listedAppts3.appointments.find((a: any) => a.id === savedAppt.id)?.hasShareLink === true);

await A.deleteAppointment.handler(ctx, { id: savedAppt.id });
const listedAppts4 = await A.listAppointments.handler(ctx, {});
check("deleteAppointment removes the appointment", !listedAppts4.appointments.some((a: any) => a.id === savedAppt.id));

// --- 4. Photos: seed via the phone-side actions, read the way Office does -----
const job = await A.createJob.handler(ctx, {
  clientId: null, clientName: "Photo Client", clientPhone: "", clientEmail: "",
  jobAddress: "9 Photo Way", jobType: "Bathroom", notes: "", jobDate: "2026-11-06",
  appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "",
});
check("createJob returns an id", typeof job.id === "number");

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const beforePhoto = await A.addPhoto.handler(ctx, {
  jobId: job.id, stage: "before", caption: "Before tear-out", filename: "before.png",
  contentType: "image/png", capturedAt: new Date().toISOString(), dataBase64: PNG_1PX, annotatedFromId: null,
});
const afterPhoto = await A.addPhoto.handler(ctx, {
  jobId: job.id, stage: "after", caption: "Finished shower", filename: "after.png",
  contentType: "image/png", capturedAt: new Date().toISOString(), dataBase64: PNG_1PX, annotatedFromId: null,
});
check("addPhoto (phone-side action) stores both photos", typeof beforePhoto.id === "number" && typeof afterPhoto.id === "number");
check("addPhoto wrote the blobs", [...blobStore.keys()].filter((k) => k.startsWith(`jobs/${job.id}/`)).length === 2, [...blobStore.keys()].join(","));

const jobDetail = await A.getJob.handler(ctx, { id: job.id });
check("getJob (Office gallery read) returns the seeded photos with URLs",
  jobDetail.photos.length === 2 && jobDetail.photos.every((p: any) => p.url.startsWith("blob://test/")) && jobDetail.photos.some((p: any) => p.stage === "before") && jobDetail.photos.some((p: any) => p.stage === "after"),
  JSON.stringify(jobDetail.photos.map((p: any) => p.stage)));

const pair = await A.createPhotoPair.handler(ctx, { jobId: job.id, beforePhotoId: beforePhoto.id, afterPhotoId: afterPhoto.id, label: "Shower wall" });
const pairList = await A.listPhotoPairs.handler(ctx, { jobId: job.id });
check("listPhotoPairs (Office pairs read) returns the pair hydrated with both photos",
  pairList.pairs.length === 1 && pairList.pairs[0].id === pair.id && pairList.pairs[0].before.id === beforePhoto.id && pairList.pairs[0].after.id === afterPhoto.id && pairList.pairs[0].label === "Shower wall",
  JSON.stringify(pairList.pairs));

// --- 5. Money: billing overview + invoice payments across invoices ------------
await db.insert(schema.authUsers).values({ name: "Track1b Owner", email: "owner1b@example.com", passwordHash: "x", passwordSalt: "y" });
await db.insert(schema.marketplaceCreditPurchases).values({ companyId: 1, packSize: 5, amountCents: 900, status: "completed" });
const billing = await A.getBillingOverview.handler(ctx, {});
check("getBillingOverview returns the plan state", billing.plan.tier === "free" && billing.plan.provider === "none", JSON.stringify(billing.plan));
check("getBillingOverview merges local promotion payments with server amounts",
  billing.payments.some((p: any) => p.source === "promotion" && p.amountCents === 900 && p.description.includes("5 pack")),
  JSON.stringify(billing.payments));

const today = new Date().toISOString().slice(0, 10);
const inv = await db.insert(schema.invoices).values({ invoiceNumber: "INV-1B", clientName: "Photo Client", lineItemsJson: "[]", total: "2000", issueDate: today, dueDate: "2999-01-01", status: "sent", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.invoices.id });
await db.insert(schema.payments).values({ invoiceId: inv[0]!.id, amount: "500", paymentDate: today, method: "Zelle", createdAt: new Date() });
const invoiceList = await A.listInvoices.handler(ctx, {});
const invRow = invoiceList.invoices.find((i: any) => i.id === inv[0]!.id);
check("listInvoices carries the payment + server-derived paid/balance figures",
  !!invRow && invRow.payments.length === 1 && invRow.payments[0].method === "Zelle" && invRow.paidToDate === "500.00" && invRow.balanceRemaining === "1500.00",
  JSON.stringify(invRow && { paid: invRow.paidToDate, balance: invRow.balanceRemaining }));

// --- 6. Marketplace: own listing, inbox, thread, text reply, bookings ---------
const listing = await db.insert(schema.marketplaceListings).values({
  companyId: 1, title: "Tile crew available", category: "tile_flooring", intent: "offer",
  priceKind: "amount", price: "1200", serviceArea: "Tampa Bay", zipCode: "34691",
  companyName: "Track1b Co", companyPhone: "813-555-0100", moderationStatus: "active",
  createdAt: new Date(), updatedAt: new Date(),
}).returning({ id: schema.marketplaceListings.id });
const listingId = listing[0]!.id;

const marketList = await A.listMarketplaceListings.handler(ctx, { search: "", category: null, serviceArea: "" });
const myRow = marketList.listings.find((l: any) => l.id === listingId);
check("listMarketplaceListings returns my listing flagged isMine with my phone visible",
  !!myRow && myRow.isMine === true && myRow.companyPhone === "813-555-0100", JSON.stringify(myRow));

const convo = await db.insert(schema.marketplaceConversations).values({
  listingId, ownerCompanyId: 1, inquirerCompanyId: 2, lastMessageAt: new Date(), createdAt: new Date(),
}).returning({ id: schema.marketplaceConversations.id });
await db.insert(schema.marketplaceMessages).values({
  companyId: 1, listingId, conversationId: convo[0]!.id, body: "Can you start Monday?",
  sender: "other", senderCompanyId: 2, createdAt: new Date(),
});
const inbox = await A.marketplaceConversations.handler(ctx, {});
const inboxRow = inbox.conversations.find((c: any) => c.id === convo[0]!.id);
check("marketplaceConversations inbox lists the thread with an unread count",
  !!inboxRow && inboxRow.listingTitle === "Tile crew available" && inboxRow.unreadCount === 1 && inboxRow.isInquiry === false,
  JSON.stringify(inboxRow));

const thread = await A.marketplaceConversation.handler(ctx, { conversationId: convo[0]!.id });
check("marketplaceConversation returns the seeded message as incoming",
  thread.messages.length === 1 && thread.messages[0].body === "Can you start Monday?" && thread.messages[0].outgoing === false,
  JSON.stringify(thread.messages));

const reply = await A.sendMarketplaceMessage.handler(ctx, { conversationId: convo[0]!.id, body: "Yes — sending a quote today.", image: null });
check("sendMarketplaceMessage (Office text reply payload) returns an id", typeof reply.id === "number");
const thread2 = await A.marketplaceConversation.handler(ctx, { conversationId: convo[0]!.id });
check("the Office reply lands in the same thread as outgoing",
  thread2.messages.some((m: any) => m.id === reply.id && m.outgoing === true && m.body === "Yes — sending a quote today."),
  JSON.stringify(thread2.messages.map((m: any) => m.body)));

await db.insert(schema.marketplaceBookingRequests).values({ companyId: 1, listingId, startDate: "2026-11-10", endDate: "2026-11-12", note: "Guest bath", status: "requested", createdAt: new Date() });
const bookings = await A.listMarketplaceBookings.handler(ctx, { listingId });
check("listMarketplaceBookings returns the booking for my listing",
  bookings.bookings.length === 1 && bookings.bookings[0].startDate === "2026-11-10" && bookings.bookings[0].status === "requested",
  JSON.stringify(bookings.bookings));

// --- 7. Settings basics: full-record round-trip preserves other fields -------
const settings0 = await A.getSettings.handler(ctx, {});
check("getSettings returns defaults on a fresh account", settings0.companyName === "" && settings0.quoteFollowUpDays === 3, JSON.stringify({ companyName: settings0.companyName }));
const { logoUrl: _l, coverUrl: _c, ...settingsInput } = settings0;
await A.updateSettings.handler(ctx, { ...settingsInput, companyName: "Track1b Co", licenseNumber: "CRC-TEST" });
const settings1 = await A.getSettings.handler(ctx, {});
check("updateSettings (Office basics save) writes the company fields", settings1.companyName === "Track1b Co" && settings1.licenseNumber === "CRC-TEST");
check("updateSettings preserves untouched phone-side preferences",
  settings1.quoteFollowUpDays === settings0.quoteFollowUpDays && settings1.simpleMode === settings0.simpleMode && settings1.accentColor === settings0.accentColor,
  JSON.stringify({ followUp: settings1.quoteFollowUpDays, simpleMode: settings1.simpleMode }));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Office Track 1b behavior checks passed.");
