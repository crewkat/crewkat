// Home-screen pinned tools verification: pin -> list order -> unpin,
// per-user isolation, unknown-tool rejection, idempotent re-pin.
// Run: bun scripts/test-home-pins.mjs  (or node)
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const REPO = "/home/hatch/workspace/crewkat-app";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};
const expectErr = async (name, fn, want) => {
  try { await fn(); check(name, false, "expected an error but succeeded"); }
  catch (e) { check(name, String(e.message).includes(want), `got: ${String(e.message).slice(0, 120)}`); }
};

const workRoot = await mkdtemp(join(tmpdir(), "crewkat-pins-test-"));
const DATA_DIR = join(workRoot, "data");
await mkdir(join(DATA_DIR, "blobs"), { recursive: true });
const libsql = createClient({ url: `file:${join(DATA_DIR, "app.db")}` });
await libsql.execute("PRAGMA journal_mode = WAL");
const db = drizzle(libsql);
await migrate(db, { migrationsFolder: join(REPO, "app/drizzle") });

const sentEmails = [];
const ctx = {
  spaceDir: DATA_DIR,
  db: () => db,
  blobs: { put: async () => {}, delete: async () => {} },
  invalidateQueries: () => {},
  executePrivileged: async (contract, args) => {
    if (contract.name === "sendAuthEmail") { sentEmails.push({ kind: "auth", ...args }); return { delivery: "sent" }; }
    throw new Error(`unexpected privileged call: ${contract.name}`);
  },
};
const { Actions } = await import(join(REPO, "app/server/dist/actions.js"));
const call = (action, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request: " + JSON.stringify(parsed.error.issues).slice(0, 300));
  return action.handler({ ...ctx, ...extra }, parsed.data);
};

async function createVerifiedUser(email, password, name = "Test Owner") {
  await call(Actions.signUp, { name, email, password, marketplaceTermsAccepted: true }, {});
  const code = sentEmails.find((e) => e.kind === "auth" && e.to === email)?.code;
  if (!code) throw new Error("no verification code captured for " + email);
  await call(Actions.verifyEmail, { email, code });
  const login = await call(Actions.login, { email, password }, { userAgent: "t", clientIp: "10.0.0.1" });
  return login.sessionToken;
}

try {
  const tokenA = await createVerifiedUser("a@test.com", "correct-horse-123", "User A");
  const tokenB = await createVerifiedUser("b@test.com", "correct-horse-123", "User B");
  const A = (a, args) => call(a, { _sessionToken: tokenA, ...args });
  const B = (a, args) => call(a, { _sessionToken: tokenB, ...args });

  // --- 1. empty list, unknown tool rejected ---------------------------------
  const empty = await A(Actions.listPinnedTools, {});
  check("list starts empty", Array.isArray(empty.tools) && empty.tools.length === 0);
  await expectErr("pin rejects unknown tool", () => A(Actions.pinTool, { toolId: "nope:missing" }), "cannot be pinned");

  // --- 2. pin three tools, check order + registry join ----------------------
  const p1 = await A(Actions.pinTool, { toolId: "toolbox:loan" });
  const p2 = await A(Actions.pinTool, { toolId: "operations:calendar" });
  const p3 = await A(Actions.pinTool, { toolId: "reports" });
  check("positions increase", p1.position === 0 && p2.position === 1 && p3.position === 2, JSON.stringify([p1.position, p2.position, p3.position]));
  const listed = await A(Actions.listPinnedTools, {});
  const ids = listed.tools.map((t) => t.toolId);
  check("list order is position order", JSON.stringify(ids) === JSON.stringify(["toolbox:loan", "operations:calendar", "reports"]), ids.join(","));
  const loan = listed.tools[0];
  check("registry join fields", loan.titleEn === "Loan payment" && loan.titleEs === "Pago de préstamo" && loan.screen === "toolbox" && loan.tab === "loan" && typeof loan.iconPath === "string" && loan.iconPath.length > 10, JSON.stringify({ en: loan.titleEn, es: loan.titleEs, screen: loan.screen, tab: loan.tab }));
  const reports = listed.tools[2];
  check("tool without tab has null tab", reports.screen === "reports" && reports.tab === null);

  // --- 3. re-pin is idempotent ----------------------------------------------
  const again = await A(Actions.pinTool, { toolId: "toolbox:loan" });
  const listed2 = await A(Actions.listPinnedTools, {});
  check("re-pin keeps position and count", again.position === 0 && listed2.tools.length === 3);

  // --- 4. unpin -------------------------------------------------------------
  await A(Actions.unpinTool, { toolId: "operations:calendar" });
  const listed3 = await A(Actions.listPinnedTools, {});
  check("unpin removes from list", JSON.stringify(listed3.tools.map((t) => t.toolId)) === JSON.stringify(["toolbox:loan", "reports"]));
  await A(Actions.unpinTool, { toolId: "operations:calendar" });
  check("unpin of missing pin is a no-op", (await A(Actions.listPinnedTools, {})).tools.length === 2);

  // --- 5. per-user isolation --------------------------------------------------
  const bEmpty = await B(Actions.listPinnedTools, {});
  check("second user sees empty list", bEmpty.tools.length === 0);
  await B(Actions.pinTool, { toolId: "toolbox:yards" });
  const bListed = await B(Actions.listPinnedTools, {});
  check("second user pins independently", bListed.tools.length === 1 && bListed.tools[0].toolId === "toolbox:yards");
  check("first user unaffected", (await A(Actions.listPinnedTools, {})).tools.length === 2);

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
