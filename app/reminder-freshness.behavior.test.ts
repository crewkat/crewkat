// Regression tests — 2026-09-29 batch from Danny's screenshots.
//
// Covers:
//  1. Client edit save goes back: tapping Save on the client edit screen
//     (ClientDetail's inline ClientForm) navigates back via onBack() after a
//     SUCCESSFUL save, with a "saved" celebration. Save failures keep the
//     user on the form with the error shown.
//  2. Stale "Ask for review" card: the Home reminder card said "Add the
//     client phone number first." even after the phone was added on the
//     client record. Two fixes: (a) every client/job save path invalidates
//     the ["automation-center"] query that feeds Home, and (b) the server
//     falls back to the live client phone when the job row's snapshot is
//     empty, so the card offers the next action ("Open text") immediately.
//  3. Pull-to-refresh on Home: TodayScreen wraps its content in the shared
//     PullToRefresh component with a refreshAll that refetches everything
//     Home renders; the gesture respects prefers-reduced-motion and only
//     arms when the scroll chain is at the top.
//
// Run from app/:  bun reminder-freshness.behavior.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const SERVER = readFileSync(
  join(import.meta.dir, "server/src/actions.ts"),
  "utf8",
);

function extractFunction(src: string, name: string): string {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (startIdx === -1) throw new Error(`function ${name} not found`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^function \w+\(/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

// --- 1. Client edit save goes back ------------------------------------------
describe("client edit save navigates back on success only", () => {
  const detail = extractFunction(APP, "ClientDetail");
  const form = extractFunction(APP, "ClientForm");

  test("ClientDetail onSaved celebrates, then calls onBack", () => {
    const onSavedIdx = detail.indexOf("onSaved={async () => {");
    expect(onSavedIdx).toBeGreaterThan(-1);
    const block = detail.slice(onSavedIdx, onSavedIdx + 600);
    expect(block).toContain('invalidateQueries({ queryKey: ["client", clientId] })');
    expect(block).toContain('invalidateQueries({ queryKey: ["clients"] })');
    expect(block).toContain("celebrate(");
    expect(block).toContain("onBack();");
  });

  test("ClientForm only fires onSaved on success; errors stay on the form", () => {
    // onSuccess is the only path that calls onSaved — failures render the
    // error paragraph and the user stays put.
    expect(form).toContain("onSuccess: (r) => onSaved(r.id)");
    expect(form).toContain('{save.error && <p className="status error">');
    expect(form).not.toContain("onError: (r) => onSaved");
  });

  test("NewClientScreen still goes back after save", () => {
    const screen = extractFunction(APP, "NewClientScreen");
    expect(screen).toContain("onBack();");
  });
});

// --- 2. Stale reminder card ---------------------------------------------------
describe("reminder queries invalidate on client/job saves", () => {
  const refreshJob = extractFunction(APP, "JobDetail").match(
    /const refreshJob = async \(\) => \{[\s\S]*?\n  \};/,
  )?.[0];
  expect(refreshJob).toBeTruthy();

  test("ClientDetail save invalidates automation-center", () => {
    const detail = extractFunction(APP, "ClientDetail");
    const onSavedIdx = detail.indexOf("onSaved={async () => {");
    const block = detail.slice(onSavedIdx, onSavedIdx + 600);
    expect(block).toContain('invalidateQueries({ queryKey: ["automation-center"] })');
  });

  test("NewClientScreen save invalidates automation-center", () => {
    const screen = extractFunction(APP, "NewClientScreen");
    expect(screen).toContain('invalidateQueries({ queryKey: ["automation-center"] })');
  });

  test("JobDetail refreshJob invalidates automation-center", () => {
    expect(refreshJob).toContain('invalidateQueries({ queryKey: ["automation-center"] })');
  });

  test("EditJobForm onDone invalidates automation-center", () => {
    const detail = extractFunction(APP, "JobDetail");
    const idx = detail.indexOf("onDone={() => {");
    expect(idx).toBeGreaterThan(-1);
    expect(detail.slice(idx, idx + 400)).toContain(
      'invalidateQueries({ queryKey: ["automation-center"] })',
    );
  });

  test("new job creation (goJob) invalidates automation-center", () => {
    const idx = APP.indexOf("const goJob = (jobId: number) => {");
    expect(idx).toBeGreaterThan(-1);
    expect(APP.slice(idx, idx + 500)).toContain(
      'invalidateQueries({ queryKey: ["automation-center"] })',
    );
  });

  test("server falls back to the live client phone for review cards", () => {
    expect(SERVER).toContain("liveClientPhone");
    expect(SERVER).toContain("jobClientPhone(job)");
  });
});

describe("review card reflects a phone added on the client (server behavior)", () => {
  let ctx: any;
  let getCenter: () => Promise<any>;
  let clientId: number;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "crewkat-reminder-fresh-"));
    const dbPath = join(dir, "app.db");
    const sqlite = createClient({ url: `file:${dbPath}` });
    const db = drizzle(sqlite);
    await migrate(db, { migrationsFolder: "./drizzle" });

    ctx = {
      slug: "tradesign",
      invocationId: "reminder-fresh-test",
      spaceDir: dir,
      db: () => db,
      blobs: {
        put: async () => {},
        getUrl: async (key: string) => `blob://test/${key}`,
        get: async () => Buffer.alloc(0),
        delete: async () => {},
        head: async () => ({ contentType: "application/octet-stream", size: 0 }),
      },
      executePrivileged: async () => {
        throw new Error("not stubbed");
      },
      emit: () => {},
      invalidateQueries: () => {},
      workspaceCompanyId: 1,
      workspaceUserId: 1,
      workspaceTier: "free",
    } as any;

    const now = new Date();
    // Client "Jhon" with NO phone, job snapshot also has no phone (the state
    // Danny was in when the card said "Add the client phone number first.").
    const made = await db
      .insert(schema.clients)
      .values({
        name: "Jhon",
        phone: "",
        email: "",
        address: "123 main street",
        notes: "",
        tags: JSON.stringify([]),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.clients.id });
    clientId = made[0]!.id;
    const jobRows = await db
      .insert(schema.jobs)
      .values({
        clientId,
        clientName: "Jhon",
        clientPhone: "",
        clientEmail: "",
        jobAddress: "123 main street",
        jobType: "Remodel",
        jobDate: "2026-09-10",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.jobs.id });
    const jobId = jobRows[0]!.id;
    await db.insert(schema.completionCertificates).values({
      jobId,
      completionDate: "2026-09-20",
      createdAt: now,
      updatedAt: now,
    });

    getCenter = () =>
      (BaseActions.getAutomationCenter as any).handler(ctx, {
        today: "2026-09-29",
      });
  });

  test("before the phone is added, the review entry has no phone", async () => {
    const center = await getCenter();
    expect(center.reviews.length).toBe(1);
    expect(center.reviews[0].clientPhone).toBe("");
    expect(center.reviews[0].clientId).toBe(clientId);
  });

  test("after saveClient adds the phone, the review entry carries it", async () => {
    await (BaseActions.saveClient as any).handler(ctx, {
      id: clientId,
      name: "Jhon",
      phone: "8135551234",
      email: "",
      address: "123 main street",
      notes: "",
      tags: [],
      referredByClientId: null,
    });
    const center = await getCenter();
    expect(center.reviews.length).toBe(1);
    // The card can now render the "Open text" next action instead of the
    // "add the phone" instruction, even though the job snapshot still lags.
    expect(center.reviews[0].clientPhone).toBe("8135551234");
  });
});

// --- 3. Pull-to-refresh on Home -----------------------------------------------
describe("Home pull-to-refresh", () => {
  const today = extractFunction(APP, "TodayScreen");
  const ptr = extractFunction(APP, "PullToRefresh");

  test("TodayScreen wraps its content in PullToRefresh with refreshAll", () => {
    expect(today).toContain("<PullToRefresh");
    expect(today).toContain("onRefresh={refreshAll}");
    expect(today).toContain("refreshing={homeRefreshing}");
  });

  test("refreshAll refetches everything Home renders", () => {
    const idx = today.indexOf("const refreshAll = async () => {");
    expect(idx).toBeGreaterThan(-1);
    const block = today.slice(idx, idx + 900);
    for (const key of [
      "automation-center",
      "quotes",
      "jobs",
      "invoices",
      "dashboard",
      "appointments",
      "home-pins",
      "field-intelligence-today",
      "expansion-suite",
    ]) {
      expect(block).toContain(`"${key}"`);
    }
  });

  test("PullToRefresh respects prefers-reduced-motion", () => {
    expect(ptr).toContain("useReducedMotion()");
    expect(ptr).toContain("if (!el || reduced) return;");
  });

  test("PullToRefresh renders the top spinner indicator", () => {
    expect(ptr).toContain("ptr-indicator");
    expect(ptr).toContain('aria-hidden="true"');
  });

  test("gesture only arms when the scroll chain is at the top", () => {
    // On long screens the .app-shell scrolls, so a downward drag mid-content
    // must keep scrolling instead of hijacking into a refresh.
    expect(ptr).toContain("chainAtTop");
    expect(ptr).toContain('contains("app-shell")');
  });

  test("host/browser pull-to-refresh is blocked at the app shell", () => {
    expect(APP).toContain("useBlockHostPullToRefresh(");
  });
});
