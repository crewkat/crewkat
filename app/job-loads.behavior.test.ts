// Job loads / dump-run log (0095, SimplySub steals Item 2): hauling runs
// logged against a job, with the cost posting into the job's EXISTING
// expense data (business_expenses, category "hauling") in lockstep —
// the same bucket jobCosts (wave1) and getJobOperations sum, so job
// costing and budget-vs-actual include loads with no silo totals.
//
// Covers: migration 0095 + journal pins, create/list/update/delete,
// cost posting into business_expenses + getJobOperations profitability
// + getJobBudget (budget-vs-actual), proof-only cost (empty and "0"),
// lockstep transitions (costed → proof-only deletes the expense,
// proof-only → costed creates it), photo attach + replace + remove,
// logger attestation, company isolation, permission classification,
// deleting a job removes its loads + linked expenses, and the
// work-summaries integration (getJobLoadsInRange via createWorkSummary).
//
// Run from app/:  bun job-loads.behavior.test.ts   (script-style suite)
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import { ADMIN_ACTIONS, ALL_ROLE_ACTIONS, minRoleForAction } from "./server/src/permissions.ts";
import { getJobLoadsInRange } from "./server/src/workSummaries.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try { await fn(); failures++; console.error(`FAIL ${name} — expected an error but none was thrown`); }
  catch { console.log(`ok   ${name}`); }
}
const A = BaseActions as any;

// --- 1. Migration journal ---------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0101_price_book_description_cleanup", last.tag === "0101_price_book_description_cleanup", last.tag);
check("0101 journal idx is 100", last.idx === 100, String(last.idx));
check("0101 when is 1791739300000", last.when === 1791739300000, String(last.when));
check("newest journal when exceeds every earlier entry", last.when > Math.max(...entries.slice(0, -1).map((e) => e.when)), `last=${last.when}`);

// --- 2. Scratch DB ------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-job-loads-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("table job_loads exists", tables.includes("job_loads"));
const loadCols = (await sqlite.execute("PRAGMA table_info(job_loads)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
for (const col of ["job_id", "company_id", "expense_id", "load_date", "kind", "quantity", "unit", "cost", "vendor", "notes", "photo_blob_key", "logged_by_user_id", "logged_by_name", "attested", "attested_at"]) {
  check(`job_loads.${col} exists`, loadCols.includes(col));
}

const blobStore = new Map<string, Buffer>();
function makeCtx(companyId: number, userId: number) {
  return {
    slug: "tradesign",
    invocationId: "job-loads-test",
    spaceDir: dir,
    db: () => db,
    unscopedDb: () => db,
    blobs: {
      put: async (key: string, bytes: Buffer) => { blobStore.set(key, Buffer.from(bytes)); },
      getUrl: async (key: string) => `blob://test/${key}`,
      get: async (key: string) => blobStore.get(key) ?? Buffer.alloc(0),
      delete: async (key: string) => { blobStore.delete(key); },
      head: async () => ({ contentType: "application/octet-stream", size: 0 }),
    },
    executePrivileged: async () => { throw new Error("no privileged calls expected"); },
    emit: () => {},
    invalidateQueries: () => {},
    workspaceCompanyId: companyId,
    workspaceUserId: userId,
    workspaceTier: "premium",
  } as any;
}
const ctx = makeCtx(1, 1);
const ctx2 = makeCtx(2, 2);

const now = new Date();
await db.insert(schema.authUsers).values({ id: 1, companyId: 1, name: "Danny Owner", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH", createdAt: now, updatedAt: now });
await db.insert(schema.authUsers).values({ id: 2, companyId: 2, name: "Other Owner", email: "other@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "HGFEDCBA", createdAt: now, updatedAt: now });
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Loads Test Co", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Other Co", updatedAt: now });

const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Load Larry", jobAddress: "44 Haul Rd", jobType: "Kitchen remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const job2Id = (await db.insert(schema.jobs).values({ companyId: 2, clientName: "Other Ollie", jobAddress: "99 Elsewhere Ave", jobType: "Bathroom remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

const photoB64 = Buffer.from("fake-jpeg-bytes").toString("base64");
async function expensesForJob(id: number) {
  return db.select().from(schema.businessExpenses).where(eq(schema.businessExpenses.jobId, id));
}

// --- 3. Create a costed load: expense posts through business_expenses --------
const created = await A.createJobLoad.handler(ctx, {
  jobId, date: "2026-10-27", kind: "debris_haul", quantity: "2", unit: "loads",
  cost: "185.50", vendor: "County Dump", notes: "Demo debris", attested: true,
  photoFilename: "dump.jpg", photoContentType: "image/jpeg", photoDataBase64: photoB64,
});
const load = created.load;
check("create returns the load", load.jobId === jobId && load.date === "2026-10-27" && load.kind === "debris_haul" && load.quantity === "2" && load.unit === "loads", JSON.stringify(load));
check("cost normalized on the load", load.cost === "185.50", String(load.cost));
check("logger attestation recorded", load.loggedByUserId === 1 && load.loggedByName === "Danny Owner" && load.attested === true && typeof load.attestedAt === "string", JSON.stringify({ by: load.loggedByName, at: load.attestedAt }));
check("photo attached via blob storage", typeof load.photoUrl === "string" && load.photoUrl.startsWith("blob://test/job-loads/") && load.photoFilename === "dump.jpg", String(load.photoUrl));
check("photo blob stored", [...blobStore.keys()].some((k) => k.startsWith("job-loads/")));
check("expense linked from the load", typeof load.expenseId === "number", String(load.expenseId));

const exps1 = await expensesForJob(jobId);
check("exactly one expense row for the job", exps1.length === 1, String(exps1.length));
const exp1 = exps1[0]!;
check("expense row is the load's cost, through the existing path", exp1.id === load.expenseId && exp1.amount === "185.50" && exp1.expenseDate === "2026-10-27" && exp1.vendor === "County Dump" && exp1.category === "hauling" && exp1.companyId === 1, JSON.stringify(exp1));
check("expense note identifies the load", exp1.note.includes(`Load #${load.id}`) && exp1.note.includes("Debris haul") && exp1.note.includes("Demo debris"), exp1.note);

// --- 4. Job costing surfaces include the load (no silo totals) ----------------
const ops1 = await A.getJobOperations.handler(ctx, { jobId });
check("getJobOperations expenses include the load cost", ops1.profitability.expenses === 185.5, String(ops1.profitability.expenses));
const budget1 = await A.getJobBudget.handler(ctx, { jobId });
check("budget-vs-actual expenses include the load cost", Number(budget1.budget.expenses) === 185.5 && Number(budget1.budget.costs) === 185.5, JSON.stringify(budget1.budget));

// --- 5. Proof-only loads (empty cost and "0") post NO expense ------------------
const proof = await A.createJobLoad.handler(ctx, {
  jobId, date: "2026-10-28", kind: "dirt", quantity: "12", unit: "yards",
  cost: "", vendor: "", notes: "Fill dirt from site", attested: false,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("empty cost is proof-only", proof.load.cost === null && proof.load.expenseId === null, JSON.stringify(proof.load));
check("unattested load has no attestation stamp", proof.load.attested === false && proof.load.attestedAt === null);
const zero = await A.createJobLoad.handler(ctx, {
  jobId, date: "2026-10-28", kind: "delivery", quantity: "1", unit: "loads",
  cost: "0", vendor: "Supplier", notes: "", attested: true,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("zero cost is proof-only", zero.load.cost === null && zero.load.expenseId === null, JSON.stringify(zero.load));
check("proof-only loads post no expenses", (await expensesForJob(jobId)).length === 1);

const list1 = await A.listJobLoads.handler(ctx, { jobId });
check("list returns all loads with count + total", list1.count === 3 && list1.loads.length === 3 && list1.totalCost === "185.50", JSON.stringify({ count: list1.count, total: list1.totalCost }));
check("list is newest-date first", list1.loads[0].date === "2026-10-28" && list1.loads[2].date === "2026-10-27");

// --- 6. Update: costed → bigger cost updates the SAME expense row --------------
const upd1 = await A.updateJobLoad.handler(ctx, {
  id: load.id, date: "2026-10-27", kind: "debris_haul", quantity: "3", unit: "loads",
  cost: "240", vendor: "County Dump", notes: "Demo debris + tile", attested: true, removePhoto: false,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("update keeps the same expense id", upd1.load.expenseId === load.expenseId, String(upd1.load.expenseId));
const exps2 = await expensesForJob(jobId);
check("update rewrote the expense in place", exps2.length === 1 && exps2[0]!.amount === "240.00" && exps2[0]!.note.includes("3 loads"), JSON.stringify(exps2[0]));
check("update kept the photo when none supplied", upd1.load.photoUrl === load.photoUrl, String(upd1.load.photoUrl));
check("update kept the original attestation stamp", upd1.load.attestedAt === load.attestedAt, `${upd1.load.attestedAt} vs ${load.attestedAt}`);

// --- 7. Update: costed → proof-only deletes the expense -------------------------
const upd2 = await A.updateJobLoad.handler(ctx, {
  id: load.id, date: "2026-10-27", kind: "debris_haul", quantity: "3", unit: "loads",
  cost: "", vendor: "County Dump", notes: "Demo debris + tile", attested: true, removePhoto: false,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("costed → proof-only clears the link", upd2.load.cost === null && upd2.load.expenseId === null);
check("costed → proof-only deletes the expense row", (await expensesForJob(jobId)).length === 0);
const ops2 = await A.getJobOperations.handler(ctx, { jobId });
check("job costing drops back to zero", ops2.profitability.expenses === 0, String(ops2.profitability.expenses));

// --- 8. Update: proof-only → costed creates the expense --------------------------
const upd3 = await A.updateJobLoad.handler(ctx, {
  id: proof.load.id, date: "2026-10-28", kind: "dirt", quantity: "12", unit: "yards",
  cost: "95.25", vendor: "Dirt Works", notes: "Fill dirt from site", attested: true, removePhoto: false,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("proof-only → costed links a new expense", typeof upd3.load.expenseId === "number" && upd3.load.cost === "95.25", JSON.stringify(upd3.load));
const exps3 = await expensesForJob(jobId);
check("new expense carries the load's fields", exps3.length === 1 && exps3[0]!.amount === "95.25" && exps3[0]!.vendor === "Dirt Works" && exps3[0]!.category === "hauling", JSON.stringify(exps3[0]));

// --- 9. Photo replace + remove ----------------------------------------------------
const photoB64b = Buffer.from("second-photo").toString("base64");
const upd4 = await A.updateJobLoad.handler(ctx, {
  id: proof.load.id, date: "2026-10-28", kind: "dirt", quantity: "12", unit: "yards",
  cost: "95.25", vendor: "Dirt Works", notes: "Fill dirt from site", attested: true, removePhoto: false,
  photoFilename: "dirt.jpg", photoContentType: "image/jpeg", photoDataBase64: photoB64b,
});
check("photo replace attaches a new blob url", typeof upd4.load.photoUrl === "string" && upd4.load.photoFilename === "dirt.jpg", String(upd4.load.photoUrl));
const upd5 = await A.updateJobLoad.handler(ctx, {
  id: proof.load.id, date: "2026-10-28", kind: "dirt", quantity: "12", unit: "yards",
  cost: "95.25", vendor: "Dirt Works", notes: "Fill dirt from site", attested: true, removePhoto: true,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("photo remove clears the attachment", upd5.load.photoUrl === null && upd5.load.photoFilename === "", JSON.stringify(upd5.load));

// --- 10. Delete removes the load AND its linked expense ---------------------------
await A.deleteJobLoad.handler(ctx, { id: proof.load.id });
check("delete removes the load row", (await db.select().from(schema.jobLoads).where(eq(schema.jobLoads.id, proof.load.id))).length === 0);
check("delete removes the linked expense", (await expensesForJob(jobId)).length === 0);
await checkThrows("deleting a missing load fails", () => A.deleteJobLoad.handler(ctx, { id: proof.load.id }));

// --- 11. Company isolation ----------------------------------------------------------
await checkThrows("other company cannot create on this job", () => A.createJobLoad.handler(ctx2, { jobId, date: "2026-10-27", kind: "other", quantity: "1", unit: "loads", cost: "10", vendor: "", notes: "", attested: false, photoFilename: "", photoContentType: "", photoDataBase64: "" }));
await checkThrows("other company cannot list this job's loads", () => A.listJobLoads.handler(ctx2, { jobId }));
await checkThrows("other company cannot update this load", () => A.updateJobLoad.handler(ctx2, { id: load.id, date: "2026-10-27", kind: "other", quantity: "1", unit: "loads", cost: "10", vendor: "", notes: "", attested: false, removePhoto: false, photoFilename: "", photoContentType: "", photoDataBase64: "" }));
await checkThrows("other company cannot delete this load", () => A.deleteJobLoad.handler(ctx2, { id: load.id }));
const listOther = await A.listJobLoads.handler(ctx2, { jobId: job2Id });
check("other company's own job lists empty", listOther.count === 0 && listOther.totalCost === "0.00");

// --- 12. Work summaries integration: in-range loads appear, out-of-range don't -----
const inRange = await A.createJobLoad.handler(ctx, {
  jobId, date: "2026-10-29", kind: "concrete", quantity: "8.5", unit: "yards",
  cost: "1320", vendor: "Ready Mix Co", notes: "Patio pour", attested: true,
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("summary-range load created with expense", typeof inRange.load.expenseId === "number");
const direct = await getJobLoadsInRange(db as any, { companyId: 1, jobId, rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
check("getJobLoadsInRange returns the real loads", direct.length === 3, JSON.stringify(direct.map((l: any) => l.date)));
const concrete = direct.find((l: any) => l.kind === "concrete");
check("range rows map to the documented contract shape", !!concrete && concrete.date === "2026-10-29" && concrete.quantity === "8.5" && concrete.unit === "yards" && concrete.cost === "1320.00" && concrete.vendor === "Ready Mix Co" && concrete.notes === "Patio pour", JSON.stringify(concrete));
const proofRow = direct.find((l: any) => l.date === "2026-10-27");
check("proof-only load maps cost as empty string", !!proofRow && proofRow.cost === "", JSON.stringify(proofRow));
const narrow = await getJobLoadsInRange(db as any, { companyId: 1, jobId, rangeStart: "2026-10-29", rangeEnd: "2026-10-29" });
check("out-of-range loads are excluded", narrow.length === 1 && narrow[0]!.kind === "concrete", JSON.stringify(narrow));
const wrongCompany = await getJobLoadsInRange(db as any, { companyId: 2, jobId, rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
check("range query is company-scoped", wrongCompany.length === 0);

const summary = await A.createWorkSummary.handler(ctx, { jobId, preset: "custom", rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
check("work summary includes the in-range loads", summary.content.loads.count === 3 && summary.content.loads.items.some((l: any) => l.kind === "concrete"), JSON.stringify(summary.content.loads));
check("work summary loads total sums costed loads only", summary.content.loads.totalCost === "1320.00", summary.content.loads.totalCost);
check("summary loadCount comes from the snapshot", summary.summary.loadCount === 3, String(summary.summary.loadCount));

// --- 13. Job delete removes loads + their linked expenses ---------------------------
const doomedJobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Doomed Dan", jobAddress: "1 Gone Way", jobType: "Demo", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const doomed = await A.createJobLoad.handler(ctx, {
  jobId: doomedJobId, date: "2026-10-27", kind: "debris_haul", quantity: "1", unit: "loads",
  cost: "75", vendor: "County Dump", notes: "", attested: true,
  photoFilename: "x.jpg", photoContentType: "image/jpeg", photoDataBase64: photoB64,
});
check("doomed job's load + expense exist", (await expensesForJob(doomedJobId)).length === 1);
await A.deleteJob.handler(ctx, { jobId: doomedJobId });
check("job delete removes the job's loads", (await db.select().from(schema.jobLoads).where(eq(schema.jobLoads.jobId, doomedJobId))).length === 0);
check("job delete removes the loads' linked expenses (no ghost costs)", (await db.select().from(schema.businessExpenses).where(eq(schema.businessExpenses.id, doomed.load.expenseId))).length === 0);

// --- 14. Permission classification ------------------------------------------------------
check("create/list/update are all-role actions", ["createJobLoad", "listJobLoads", "updateJobLoad"].every((n) => ALL_ROLE_ACTIONS.has(n) && minRoleForAction(n) === "field"));
check("deleteJobLoad is admin-only", ADMIN_ACTIONS.has("deleteJobLoad") && minRoleForAction("deleteJobLoad") === "admin");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
