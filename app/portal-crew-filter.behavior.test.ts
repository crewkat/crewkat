// Regression test: portalListJobMessages must never expose crew (contractor)
// messages to portal clients. Portal sees sender IN ('client','system') only.
// The contractor-side listJobMessages keeps returning the full thread.
// Run from app/:  bun portal-crew-filter.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
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

const dir = await mkdtemp(join(tmpdir(), "crewkat-portalfilter-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

function makeCtx(companyId: number) {
  return {
    slug: "tradesign",
    invocationId: `portalfilter-test-c${companyId}`,
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
    workspaceCompanyId: companyId,
    workspaceUserId: companyId,
    workspaceTier: "free",
  } as any;
}
const ctx = makeCtx(1);
const A = BaseActions as any;

await db.insert(schema.authUsers).values([
  { companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1 },
]);
await db.insert(schema.settings).values([
  { companyId: 1, companyName: "Test Co" },
] as any);

const job = await A.createJob.handler(ctx, {
  clientId: null, clientName: "Maria Lopez", clientPhone: "8135550100",
  clientEmail: "maria@example.com", jobAddress: "123 Main St", jobType: "Kitchen remodel",
  notes: "", jobDate: "2026-09-20", appointmentAt: "", amountDue: "", dueDate: "",
  depositAmount: "", paymentNotes: "",
});

// Seed one of each sender type directly.
await db.insert(schema.jobMessages).values([
  { jobId: job.id, sender: "contractor", body: "Crew-only: running 30 min late, don't tell the client", createdAt: new Date() },
  { jobId: job.id, sender: "client", body: "Thanks! See you Monday.", createdAt: new Date() },
  { jobId: job.id, sender: "system", body: "Job created / Trabajo creado", createdAt: new Date() },
]);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
const portalToken = "filter-test-token-" + "x".repeat(40);
await db.insert(schema.portalTokens).values({
  companyId: 1, jobId: job.id, tokenHash: hashToken(portalToken), tokenHint: "test",
});

// 1. Portal list excludes contractor messages.
const portalMsgs = await A.portalListJobMessages.handler(ctx, { token: portalToken });
check("portal list returns messages", portalMsgs.messages.length >= 2, `got ${portalMsgs.messages.length}`);
check(
  "portal list contains NO contractor messages",
  portalMsgs.messages.every((m: any) => m.sender !== "contractor"),
  portalMsgs.messages.map((m: any) => m.sender).join(","),
);
check("portal list keeps client messages", portalMsgs.messages.some((m: any) => m.sender === "client"));
check("portal list keeps system messages", portalMsgs.messages.some((m: any) => m.sender === "system"));

// 2. Contractor side still sees the full thread (read filter is portal-only).
const full = await A.listJobMessages.handler(ctx, { jobId: job.id });
check("contractor list still returns contractor messages", full.messages.some((m: any) => m.sender === "contractor"));
check("contractor list still returns all senders", ["contractor", "client", "system"].every((s) => full.messages.some((m: any) => m.sender === s)));

// 3. Inbound portal send still works and lands in the contractor thread.
const sent = await A.portalSendJobMessage.handler(ctx, { token: portalToken, body: "Can we move to Tuesday?" });
check("portalSendJobMessage returns an id", typeof sent.id === "number");
const fullAfter = await A.listJobMessages.handler(ctx, { jobId: job.id });
check(
  "portal-sent client message lands in contractor thread",
  fullAfter.messages.some((m: any) => m.sender === "client" && /Tuesday/.test(m.body)),
);
const portalAfter = await A.portalListJobMessages.handler(ctx, { token: portalToken });
check(
  "portal list still has no contractor messages after client send",
  portalAfter.messages.every((m: any) => m.sender !== "contractor"),
);

if (failures > 0) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("ALL PORTAL FILTER CHECKS PASSED");
