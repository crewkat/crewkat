// Phase 1 client list tests (migration 0037: tags, aggregates, sorting).
// Scratch DB via secure-login-harness + pure clientListUtils unit tests.
// Run: bun scripts/test-clients-phase1.mjs
import { createTestEnv } from "./secure-login-harness.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};
const expectThrow = async (name, fn, match) => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, String(e.message).includes(match), `got: ${e.message.slice(0, 80)}`);
  }
};

const env = await createTestEnv();
const { Actions, libsql, withMeta } = env;
const q = async (sql, args = []) => (await libsql.execute({ sql, args })).rows;

// Mirror production: server.mjs parses args with action.request before the handler.
const call = (action, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request for this action.");
  return action.handler(withMeta({ ...extra }), parsed.data);
};

try {
  // --- setup: migration 0037 applied -----------------------------------------
  const cols = await q("PRAGMA table_info(clients)");
  const tagsCol = cols.find((c) => c.name === "tags");
  check("migration 0037: clients.tags column exists", !!tagsCol, JSON.stringify(tagsCol ?? null));
  check(
    "migration 0037: tags NOT NULL DEFAULT '[]'",
    tagsCol?.notnull === 1 && tagsCol?.dflt_value === "'[]'",
    `notnull=${tagsCol?.notnull} default=${tagsCol?.dflt_value}`,
  );

  await env.createVerifiedUser("owner@test.com", "correct-horse-123");
  const login = await Actions.login.handler(
    withMeta({ userAgent: "t", clientIp: "10.9.0.1" }),
    { email: "owner@test.com", password: "correct-horse-123" },
  );
  const callOwn = (action, args, extra = {}) =>
    call(action, { _sessionToken: login.sessionToken, ...args }, extra);

  // --- saveClient persists + normalizes tags -----------------------------------
  const c1 = await callOwn(Actions.saveClient, {
    id: null, name: "Zoe Alvarez", phone: "", email: "", address: "", notes: "",
    tags: [" VIP ", "vip", "Repeat"],
  });
  const row1 = (await q("SELECT tags FROM clients WHERE id = ?", [c1.id]))[0];
  check(
    "saveClient: tags normalized (trim, dedupe)",
    row1.tags === JSON.stringify(["VIP", "Repeat"]),
    row1.tags,
  );
  await expectThrow(
    "saveClient: empty tag rejected by request validation",
    () => callOwn(Actions.saveClient, { id: null, name: "Bad", phone: "", email: "", address: "", notes: "", tags: [""] }),
    "Invalid request",
  );

  const c2 = await callOwn(Actions.saveClient, {
    id: null, name: "amy chen", phone: "", email: "", address: "", notes: "",
    tags: ["vip"],
  });
  const c3 = await callOwn(Actions.saveClient, {
    id: null, name: "Miguel Torres", phone: "", email: "", address: "", notes: "",
    tags: [],
  });
  const row3 = (await q("SELECT tags FROM clients WHERE id = ?", [c3.id]))[0];
  check("saveClient: empty tags persist as []", row3.tags === "[]", row3.tags);

  // Legacy rows (pre-0037) get the default.
  await q("INSERT INTO clients (company_id, name, created_at, updated_at) VALUES (1, 'Legacy Lou', 1, 1)");
  const legacy = (await q("SELECT tags FROM clients WHERE name = 'Legacy Lou'"))[0];
  check("migration default: legacy rows read as []", legacy.tags === "[]", legacy.tags);

  // --- aggregates from invoices/payments --------------------------------------
  const now = Date.now();
  const inv1 = Number((await q(
    "INSERT INTO invoices (company_id, client_id, client_name, line_items_json, total, status, created_at, updated_at) VALUES (1, ?, 'Zoe Alvarez', '[]', '1875.00', 'sent', ?, ?) RETURNING id",
    [c1.id, now, now],
  ))[0].id);
  const inv2 = Number((await q(
    "INSERT INTO invoices (company_id, client_id, client_name, line_items_json, total, status, created_at, updated_at) VALUES (1, ?, 'Zoe Alvarez', '[]', '125.00', 'sent', ?, ?) RETURNING id",
    [c1.id, now, now],
  ))[0].id);
  await q("INSERT INTO payments (company_id, invoice_id, amount, payment_date, method, created_at) VALUES (1, ?, '500.00', '2026-09-27', 'cash', ?)", [inv1, now]);

  const list = await callOwn(Actions.listClients, { search: "" });
  const byId = Object.fromEntries(list.clients.map((c) => [c.id, c]));
  const zoe = byId[c1.id];
  check("listClients: invoiceCount", zoe.invoiceCount === 2, String(zoe.invoiceCount));
  check("listClients: totalInvoiced", zoe.totalInvoiced === 2000, String(zoe.totalInvoiced));
  check("listClients: totalPaid", zoe.totalPaid === 500, String(zoe.totalPaid));
  check("listClients: balanceDue", zoe.balanceDue === 1500, String(zoe.balanceDue));
  check("listClients: paymentPercent", zoe.paymentPercent === 25, String(zoe.paymentPercent));
  check("listClients: tags round-trip", JSON.stringify(zoe.tags) === JSON.stringify(["VIP", "Repeat"]), JSON.stringify(zoe.tags));
  const miguel = byId[c3.id];
  check("listClients: no invoices -> zeros", miguel.invoiceCount === 0 && miguel.balanceDue === 0 && miguel.paymentPercent === 0);
  // Overpayment never yields a negative balance.
  await q("INSERT INTO payments (company_id, invoice_id, amount, payment_date, method, created_at) VALUES (1, ?, '2000.00', '2026-09-27', 'cash', ?)", [inv2, now]);
  const zoe2 = (await callOwn(Actions.listClients, { search: "" })).clients.find((c) => c.id === c1.id);
  check("listClients: balanceDue floors at 0 on overpayment", zoe2.balanceDue === 0, String(zoe2.balanceDue));

  // --- alphabetical default (case-insensitive) ---------------------------------
  const names = (await callOwn(Actions.listClients, { search: "" })).clients.map((c) => c.name);
  check(
    "listClients: alphabetical case-insensitive default",
    JSON.stringify(names) === JSON.stringify(["amy chen", "Legacy Lou", "Miguel Torres", "Zoe Alvarez"]),
    JSON.stringify(names),
  );

  // --- search matches tags -----------------------------------------------------
  const vipSearch = await callOwn(Actions.listClients, { search: "vip" });
  check(
    "listClients: search matches tags",
    vipSearch.clients.length === 2 && vipSearch.clients.every((c) => c.tags.some((t) => t.toLowerCase() === "vip")),
    vipSearch.clients.map((c) => c.name).join(","),
  );

  // --- getClient includes the new fields ---------------------------------------
  const got = await callOwn(Actions.getClient, { id: c1.id });
  check("getClient: tags", JSON.stringify(got.client.tags) === JSON.stringify(["VIP", "Repeat"]));
  check("getClient: invoiceCount", got.client.invoiceCount === 2, String(got.client.invoiceCount));
  check("getClient: balanceDue", got.client.balanceDue === 0, String(got.client.balanceDue));

  // --- edit persists tags --------------------------------------------------------
  await callOwn(Actions.saveClient, {
    id: c1.id, name: "Zoe Alvarez", phone: "", email: "", address: "", notes: "",
    tags: ["VIP", "Commercial"],
  });
  const edited = await callOwn(Actions.getClient, { id: c1.id });
  check("saveClient edit: tags replaced", JSON.stringify(edited.client.tags) === JSON.stringify(["VIP", "Commercial"]));
  await expectThrow(
    "saveClient: >12 tags rejected",
    () => callOwn(Actions.saveClient, { id: null, name: "X", phone: "", email: "", address: "", notes: "", tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }),
    "Invalid request",
  );

  // --- client list logic (mirrors ClientsScreen/ClientForm in app/client/src/App.tsx) --------
  // These pure functions are copied verbatim from the shipped source so the
  // tests track the real implementation, not a parallel utils module.
  function clientInitials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
  }
  function sortClients(list, sortBy, direction) {
    return [...list].sort((a, b) => {
      let value = sortBy === "alphabetical" ? a.name.localeCompare(b.name) : sortBy === "balance" ? a.balanceDue - b.balanceDue : sortBy === "paid" ? a.totalPaid - b.totalPaid : a.invoiceCount - b.invoiceCount;
      if (value === 0 && sortBy !== "alphabetical") value = a.name.localeCompare(b.name);
      return direction === "asc" ? value : -value;
    });
  }
  function filterByTags(list, selectedTags) {
    return list.filter((client) => selectedTags.length === 0 || selectedTags.every((tag) => client.tags.includes(tag)));
  }
  function tagCounts(list) {
    return Array.from(new Set(list.flatMap((client) => client.tags)))
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ tag, count: list.filter((client) => client.tags.includes(tag)).length }));
  }
  function addTag(existing, draft) {
    const tag = draft.trim();
    if (!tag || existing.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) return existing;
    return [...existing, tag];
  }
  check("initials: two words", clientInitials("Danny Rivera") === "DR");
  check("initials: one word", clientInitials("Madonna") === "M");
  check("initials: blank", clientInitials("  ") === "?");
  check("initials: extra spaces", clientInitials("  Ana  María  López ") === "AM");

  const mk = (id, name, tags, invoiceCount, totalInvoiced, totalPaid, balanceDue, paymentPercent) => ({
    id, name, tags, invoiceCount, totalInvoiced, totalPaid, balanceDue, paymentPercent,
  });
  const sample = [
    mk(1, "Zoe Alvarez", ["VIP"], 2, 2000, 500, 1500, 25),
    mk(2, "amy chen", ["vip", "Repeat"], 1, 500, 500, 0, 100),
    mk(3, "Miguel Torres", [], 3, 9000, 1000, 8000, 11),
  ];
  const namesOf = (arr) => arr.map((c) => c.name);
  check("sort: name asc", JSON.stringify(namesOf(sortClients(sample, "alphabetical", "asc"))) === JSON.stringify(["amy chen", "Miguel Torres", "Zoe Alvarez"]));
  check("sort: name desc", JSON.stringify(namesOf(sortClients(sample, "alphabetical", "desc"))) === JSON.stringify(["Zoe Alvarez", "Miguel Torres", "amy chen"]));
  check("sort: balanceDue desc", JSON.stringify(namesOf(sortClients(sample, "balance", "desc"))) === JSON.stringify(["Miguel Torres", "Zoe Alvarez", "amy chen"]));
  check("sort: balanceDue asc", JSON.stringify(namesOf(sortClients(sample, "balance", "asc"))) === JSON.stringify(["amy chen", "Zoe Alvarez", "Miguel Torres"]));
  check("sort: totalPaid desc", JSON.stringify(namesOf(sortClients(sample, "paid", "desc"))) === JSON.stringify(["Miguel Torres", "Zoe Alvarez", "amy chen"]));
  check("sort: invoiceCount desc", JSON.stringify(namesOf(sortClients(sample, "invoices", "desc"))) === JSON.stringify(["Miguel Torres", "Zoe Alvarez", "amy chen"]));
  check("sort: invoiceCount asc", JSON.stringify(namesOf(sortClients(sample, "invoices", "asc"))) === JSON.stringify(["amy chen", "Zoe Alvarez", "Miguel Torres"]));
  check("sort: ties fall back to name", (() => {
    const tied = [mk(1, "Zoe", [], 1, 0, 0, 0, 0), mk(2, "amy", [], 1, 0, 0, 0, 0)];
    return JSON.stringify(namesOf(sortClients(tied, "balance", "asc"))) === JSON.stringify(["amy", "Zoe"]);
  })());
  check("sort: does not mutate input", (() => {
    const before = sample.map((c) => c.id);
    sortClients(sample, "alphabetical", "desc");
    return JSON.stringify(sample.map((c) => c.id)) === JSON.stringify(before);
  })());
  check("filter: AND across tags", JSON.stringify(namesOf(filterByTags(sample, ["vip", "Repeat"]))) === JSON.stringify(["amy chen"]));
  check("filter: empty selection returns all", filterByTags(sample, []).length === 3);
  check("filter: no match", filterByTags(sample, ["nope"]).length === 0);
  const counts = tagCounts(sample);
  check("tagCounts: three distinct tags", counts.length === 3, JSON.stringify(counts));
  check("tagCounts: VIP count 1", counts.find((x) => x.tag === "VIP")?.count === 1);
  check("tagCounts: sorted by localeCompare", counts.every((x, i, a) => i === 0 || a[i - 1].tag.localeCompare(x.tag) <= 0));
  check("addTag: trims", JSON.stringify(addTag([], "  big spender ")) === JSON.stringify(["big spender"]));
  check("addTag: case-insensitive dedupe", JSON.stringify(addTag(["VIP"], "vip")) === JSON.stringify(["VIP"]));
  check("addTag: blank ignored", JSON.stringify(addTag(["a"], "   ")) === JSON.stringify(["a"]));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
} finally {
  await env.cleanup();
}
