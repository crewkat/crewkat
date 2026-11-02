// Wave 2 (Item 7): QuickBooks Online sync engine.
//
// Two-way sync of customers (clients), invoices, and payments between
// Crewkat and one QuickBooks Online company per Crewkat company.
// Transport is the privileged qbApiRequest op (tokens stay server-side
// in quickbooks_connections; no action ever returns them).
//
// CONFLICT RULE (chosen default): every mapped record snapshots both
// sides' updatedAt clocks at the last successful sync
// (qb_sync_records.crewkatUpdatedAt / qbUpdatedAt). On the next sync:
// - only Crewkat changed → Crewkat wins (push);
// - only QuickBooks changed → QuickBooks wins (pull);
// - BOTH changed → last-write-wins by updatedAt: the newer side is
//   applied over the older, and the record is flagged status
//   "conflict" with a plain-words message in the Sync Status centre —
//   never silently overwritten.
// Payments are append-only (no updates exist on either side), so they
// never conflict.
//
// Simplifications (deliberate, Crewkat-sized): no journal entries, no
// expenses, no tax sync; every invoice line posts to ONE default QB
// service item ("Services", created once and stored on the
// connection); QB payments pulled in are recorded with method
// "QuickBooks" and are not re-pushed (their sync record carries the
// QB id from birth).

import { and, eq } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import { privileged } from "@space/privileged";
import * as schema from "./schema";

type Db = ReturnType<Ctx["db"]>;
type Connection = typeof schema.quickbooksConnections.$inferSelect;
type SyncRecord = typeof schema.qbSyncRecords.$inferSelect;

export type QbSyncSummary = { pushed: number; pulled: number; conflicts: number; errors: number };

function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  return Number(String(value ?? "").replace(/[^0-9.-]/g, "")) || 0;
}

function qbErrorMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } };
    const first = parsed.Fault?.Error?.[0];
    if (first?.Message) return `${first.Message}${first.Detail ? ` — ${first.Detail}` : ""}`.slice(0, 280);
  } catch { /* fall through */ }
  return fallback;
}

class QbClient {
  constructor(private ctx: Ctx, private conn: Connection) {}

  async call(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    const result = await this.ctx.executePrivileged(privileged.qbApiRequest, {
      accessToken: this.conn.accessToken,
      realmId: this.conn.realmId,
      method,
      path,
      body: body ? JSON.stringify(body) : "",
    });
    if (!result.configured) throw new Error("QuickBooks is not configured on the platform yet.");
    if (result.status === 401) throw new Error("The QuickBooks connection has expired. Reconnect in Settings.");
    if (result.status < 200 || result.status >= 300) throw new Error(qbErrorMessage(result.body, `QuickBooks returned HTTP ${result.status}.`));
    try {
      return JSON.parse(result.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async query<T>(entity: string, where = ""): Promise<T[]> {
    const out: T[] = [];
    let start = 1;
    for (;;) {
      const q = `select * from ${entity}${where ? ` where ${where}` : ""} startposition ${start} maxresults 200`;
      const res = await this.call("GET", `/query?query=${encodeURIComponent(q)}`);
      const qr = (res.QueryResponse ?? {}) as Record<string, unknown>;
      const rows = (qr[entity] as T[] | undefined) ?? [];
      out.push(...rows);
      if (rows.length < 200) break;
      start += 200;
    }
    return out;
  }
}

type QbCustomer = { Id: string; SyncToken?: string; DisplayName?: string; PrimaryEmailAddr?: { Address?: string }; PrimaryPhone?: { FreeFormNumber?: string }; BillAddr?: { Line1?: string }; MetaData?: { LastUpdatedTime?: string } };
type QbInvoice = { Id: string; SyncToken?: string; DocNumber?: string; CustomerRef?: { value: string; name?: string }; TxnDate?: string; TotalAmt?: number; Balance?: number; Line?: Array<Record<string, unknown>>; MetaData?: { LastUpdatedTime?: string } };
type QbPayment = { Id: string; TotalAmt?: number; TxnDate?: string; CustomerRef?: { value: string }; Line?: Array<{ Amount?: number; LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }>; MetaData?: { LastUpdatedTime?: string } };

async function upsertRecord(db: Db, companyId: number, entityType: SyncRecord["entityType"], entityId: number, patch: Partial<SyncRecord>): Promise<void> {
  const existing = (await db.select().from(schema.qbSyncRecords).where(and(eq(schema.qbSyncRecords.companyId, companyId), eq(schema.qbSyncRecords.entityType, entityType), eq(schema.qbSyncRecords.entityId, entityId))).limit(1))[0];
  if (existing) {
    await db.update(schema.qbSyncRecords).set({ ...patch, updatedAt: new Date() }).where(eq(schema.qbSyncRecords.id, existing.id));
  } else {
    await db.insert(schema.qbSyncRecords).values({ companyId, entityType, entityId, crewkatUpdatedAt: patch.crewkatUpdatedAt ?? new Date(0), ...patch });
  }
}

export async function getQbConnection(db: Db, companyId: number): Promise<Connection | undefined> {
  return (await db.select().from(schema.quickbooksConnections).where(eq(schema.quickbooksConnections.companyId, companyId)).limit(1))[0];
}

async function ensureFreshToken(ctx: Ctx, db: Db, conn: Connection): Promise<Connection> {
  const expiresAt = conn.accessTokenExpiresAt?.getTime() ?? 0;
  if (conn.accessToken && expiresAt > Date.now() + 5 * 60_000) return conn;
  const refreshed = await ctx.executePrivileged(privileged.qbRefreshToken, { refreshToken: conn.refreshToken });
  if (!refreshed.configured || !refreshed.accessToken) throw new Error("The QuickBooks connection has expired. Reconnect in Settings.");
  const next: Connection = { ...conn, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken ?? conn.refreshToken, accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000) };
  await db.update(schema.quickbooksConnections).set({ accessToken: next.accessToken, refreshToken: next.refreshToken, accessTokenExpiresAt: next.accessTokenExpiresAt, updatedAt: new Date() }).where(eq(schema.quickbooksConnections.id, conn.id));
  return next;
}

async function ensureDefaultItem(db: Db, client: QbClient, conn: Connection): Promise<string> {
  if (conn.defaultItemId) return conn.defaultItemId;
  const items = await client.query<{ Id: string; Name?: string }>("Item", "Name = 'Services'");
  let itemId = items[0]?.Id ?? "";
  if (!itemId) {
    const accounts = await client.query<{ Id: string }>("Account", "AccountType = 'Income'");
    if (!accounts[0]) throw new Error("QuickBooks has no income account to post services to.");
    const created = await client.call("POST", "/item", { Name: "Services", Type: "Service", IncomeAccountRef: { value: accounts[0].Id } });
    itemId = String(created.Id ?? "");
    if (!itemId) throw new Error("QuickBooks did not create the default service item.");
  }
  await db.update(schema.quickbooksConnections).set({ defaultItemId: itemId, updatedAt: new Date() }).where(eq(schema.quickbooksConnections.id, conn.id));
  return itemId;
}

function customerPayload(clientRow: typeof schema.clients.$inferSelect) {
  return {
    DisplayName: clientRow.name,
    ...(clientRow.email ? { PrimaryEmailAddr: { Address: clientRow.email } } : {}),
    ...(clientRow.phone ? { PrimaryPhone: { FreeFormNumber: clientRow.phone } } : {}),
    ...(clientRow.address ? { BillAddr: { Line1: clientRow.address } } : {}),
  };
}

export async function runQuickBooksSync(ctx: Ctx, db: Db, companyId: number): Promise<QbSyncSummary> {
  const summary: QbSyncSummary = { pushed: 0, pulled: 0, conflicts: 0, errors: 0 };
  let conn = await getQbConnection(db, companyId);
  if (!conn || conn.status !== "connected" || !conn.realmId) throw new Error("QuickBooks is not connected.");
  conn = await ensureFreshToken(ctx, db, conn);
  const client = new QbClient(ctx, conn);
  const itemId = await ensureDefaultItem(db, client, conn);

  const records = await db.select().from(schema.qbSyncRecords).where(eq(schema.qbSyncRecords.companyId, companyId));
  const byKey = new Map(records.map((r) => [`${r.entityType}:${r.entityId}`, r]));
  const byQbId = new Map(records.filter((r) => r.qbId).map((r) => [`${r.entityType}:${r.qbId}`, r]));
  const markError = async (entityType: SyncRecord["entityType"], entityId: number, err: unknown) => {
    summary.errors++;
    await upsertRecord(db, companyId, entityType, entityId, { status: "error", error: err instanceof Error ? err.message.slice(0, 280) : "Sync failed." });
  };

  // ---------------- Customers ----------------
  const qbCustomers = await client.query<QbCustomer>("Customer");
  const qbCustomerById = new Map(qbCustomers.map((c) => [c.Id, c]));
  const crewClients = await db.select().from(schema.clients).where(eq(schema.clients.companyId, companyId));
  const qbCustomerIdForClient = new Map<number, string>();

  for (const crew of crewClients) {
    try {
      const record = byKey.get(`customer:${crew.id}`);
      let qb = record?.qbId ? qbCustomerById.get(record.qbId) : undefined;
      if (!qb) {
        qb = qbCustomers.find((c) => (crew.email && c.PrimaryEmailAddr?.Address?.toLowerCase() === crew.email.toLowerCase()) || c.DisplayName === crew.name);
      }
      if (!qb) {
        const created = await client.call("POST", "/customer", customerPayload(crew)) as unknown as QbCustomer;
        if (!created.Id) throw new Error("QuickBooks did not return the new customer.");
        qbCustomerIdForClient.set(crew.id, created.Id);
        qbCustomerById.set(created.Id, created);
        await upsertRecord(db, companyId, "customer", crew.id, { qbId: created.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: crew.updatedAt, qbUpdatedAt: created.MetaData?.LastUpdatedTime ? new Date(created.MetaData.LastUpdatedTime) : new Date() });
        summary.pushed++;
        continue;
      }
      qbCustomerIdForClient.set(crew.id, qb.Id);
      const qbTime = qb.MetaData?.LastUpdatedTime ? new Date(qb.MetaData.LastUpdatedTime) : null;
      const crewChanged = record?.qbId ? crew.updatedAt.getTime() > record.crewkatUpdatedAt.getTime() : true;
      const qbChanged = record?.qbId && qbTime && record.qbUpdatedAt ? qbTime.getTime() > record.qbUpdatedAt.getTime() : false;
      if (crewChanged && qbChanged) {
        // Both sides moved: last-write-wins, surfaced as a conflict.
        const crewWins = !qbTime || crew.updatedAt.getTime() >= qbTime.getTime();
        if (crewWins) {
          const updated = await client.call("POST", "/customer", { ...customerPayload(crew), Id: qb.Id, SyncToken: qb.SyncToken ?? "0", sparse: true }) as unknown as QbCustomer;
          await upsertRecord(db, companyId, "customer", crew.id, { qbId: qb.Id, status: "conflict", error: "Both sides changed since the last sync — Crewkat was newer and won; the QuickBooks edit was overwritten.", lastSyncedAt: new Date(), crewkatUpdatedAt: crew.updatedAt, qbUpdatedAt: updated.MetaData?.LastUpdatedTime ? new Date(updated.MetaData.LastUpdatedTime) : new Date() });
        } else {
          await db.update(schema.clients).set({ name: qb.DisplayName || crew.name, email: qb.PrimaryEmailAddr?.Address ?? crew.email, phone: qb.PrimaryPhone?.FreeFormNumber ?? crew.phone, address: qb.BillAddr?.Line1 ?? crew.address, updatedAt: new Date() }).where(eq(schema.clients.id, crew.id));
          await upsertRecord(db, companyId, "customer", crew.id, { qbId: qb.Id, status: "conflict", error: "Both sides changed since the last sync — QuickBooks was newer and won; the Crewkat edit was overwritten.", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qbTime ?? new Date() });
        }
        summary.conflicts++;
      } else if (crewChanged) {
        const updated = await client.call("POST", "/customer", { ...customerPayload(crew), Id: qb.Id, SyncToken: qb.SyncToken ?? "0", sparse: true }) as unknown as QbCustomer;
        await upsertRecord(db, companyId, "customer", crew.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: crew.updatedAt, qbUpdatedAt: updated.MetaData?.LastUpdatedTime ? new Date(updated.MetaData.LastUpdatedTime) : qbTime ?? new Date() });
        summary.pushed++;
      } else if (qbChanged) {
        await db.update(schema.clients).set({ name: qb.DisplayName || crew.name, email: qb.PrimaryEmailAddr?.Address ?? crew.email, phone: qb.PrimaryPhone?.FreeFormNumber ?? crew.phone, address: qb.BillAddr?.Line1 ?? crew.address, updatedAt: new Date() }).where(eq(schema.clients.id, crew.id));
        await upsertRecord(db, companyId, "customer", crew.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qbTime ?? new Date() });
        summary.pulled++;
      } else if (!record?.qbId) {
        // Adopted an existing QB customer that matches — mapping only.
        await upsertRecord(db, companyId, "customer", crew.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: crew.updatedAt, qbUpdatedAt: qbTime ?? new Date() });
      } else {
        await upsertRecord(db, companyId, "customer", crew.id, { status: "synced", error: "", lastSyncedAt: new Date() });
      }
    } catch (err) {
      await markError("customer", crew.id, err);
    }
  }
  // Pull: QB customers nobody in Crewkat maps to become clients.
  for (const qb of qbCustomers) {
    if (byQbId.has(`customer:${qb.Id}`)) continue;
    if (crewClients.some((c) => qbCustomerIdForClient.get(c.id) === qb.Id)) continue;
    try {
      const rows = await db.insert(schema.clients).values({ companyId, name: qb.DisplayName || "QuickBooks customer", email: qb.PrimaryEmailAddr?.Address ?? "", phone: qb.PrimaryPhone?.FreeFormNumber ?? "", address: qb.BillAddr?.Line1 ?? "" }).returning({ id: schema.clients.id });
      const made = rows[0];
      if (!made) continue;
      crewClients.push({ ...(await db.select().from(schema.clients).where(eq(schema.clients.id, made.id)).limit(1))[0]! });
      qbCustomerIdForClient.set(made.id, qb.Id);
      await upsertRecord(db, companyId, "customer", made.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qb.MetaData?.LastUpdatedTime ? new Date(qb.MetaData.LastUpdatedTime) : new Date() });
      summary.pulled++;
    } catch (err) {
      summary.errors++;
      void err;
    }
  }

  // ---------------- Invoices ----------------
  const qbInvoices = await client.query<QbInvoice>("Invoice");
  const qbInvoiceById = new Map(qbInvoices.map((i) => [i.Id, i]));
  const crewInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, companyId));
  const qbInvoiceIdForInvoice = new Map<number, string>();
  for (const [key, r] of byKey) if (key.startsWith("invoice:") && r.qbId) qbInvoiceIdForInvoice.set(r.entityId, r.qbId);
  const clientIdForQbCustomer = new Map([...qbCustomerIdForClient.entries()].map(([k, v]) => [v, k]));

  const invoiceLines = (inv: typeof schema.invoices.$inferSelect) => {
    let items: Array<{ description?: string; amount?: string | number; quantity?: number }> = [];
    try { items = JSON.parse(inv.lineItemsJson) as typeof items; } catch { items = []; }
    if (!items.length) items = [{ description: inv.jobType || "Services", amount: inv.total, quantity: 1 }];
    return items.map((item) => {
      const amount = parseMoney(item.amount ?? "0");
      const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
      return { DetailType: "SalesItemLineDetail", Amount: amount, Description: String(item.description ?? ""), SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: qty, UnitPrice: qty > 0 ? amount / qty : amount } };
    });
  };

  for (const inv of crewInvoices) {
    const qbCustomerId = inv.clientId != null ? qbCustomerIdForClient.get(inv.clientId) : undefined;
    try {
      if (!qbCustomerId) throw new Error("The invoice's client is not synced to QuickBooks yet.");
      const record = byKey.get(`invoice:${inv.id}`);
      let qb = record?.qbId ? qbInvoiceById.get(record.qbId) : undefined;
      if (!qb && inv.invoiceNumber) qb = qbInvoices.find((i) => i.DocNumber === inv.invoiceNumber);
      if (!qb) {
        const created = await client.call("POST", "/invoice", { CustomerRef: { value: qbCustomerId }, ...(inv.invoiceNumber ? { DocNumber: inv.invoiceNumber } : {}), ...(inv.issueDate ? { TxnDate: inv.issueDate } : {}), Line: invoiceLines(inv) }) as unknown as QbInvoice;
        if (!created.Id) throw new Error("QuickBooks did not return the new invoice.");
        qbInvoiceIdForInvoice.set(inv.id, created.Id);
        await upsertRecord(db, companyId, "invoice", inv.id, { qbId: created.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: inv.updatedAt, qbUpdatedAt: created.MetaData?.LastUpdatedTime ? new Date(created.MetaData.LastUpdatedTime) : new Date() });
        summary.pushed++;
        continue;
      }
      qbInvoiceIdForInvoice.set(inv.id, qb.Id);
      const qbTime = qb.MetaData?.LastUpdatedTime ? new Date(qb.MetaData.LastUpdatedTime) : null;
      const crewChanged = record?.qbId ? inv.updatedAt.getTime() > record.crewkatUpdatedAt.getTime() : true;
      const qbChanged = record?.qbId && qbTime && record.qbUpdatedAt ? qbTime.getTime() > record.qbUpdatedAt.getTime() : false;
      const pushUpdate = async () => {
        const current = await client.call("GET", `/invoice/${qb!.Id}`) as unknown as QbInvoice;
        const updated = await client.call("POST", "/invoice", { Id: qb!.Id, SyncToken: current.SyncToken ?? qb!.SyncToken ?? "0", CustomerRef: { value: qbCustomerId }, ...(inv.invoiceNumber ? { DocNumber: inv.invoiceNumber } : {}), Line: invoiceLines(inv) }) as unknown as QbInvoice;
        return updated;
      };
      if (crewChanged && qbChanged) {
        const crewWins = !qbTime || inv.updatedAt.getTime() >= qbTime.getTime();
        if (crewWins) {
          const updated = await pushUpdate();
          await upsertRecord(db, companyId, "invoice", inv.id, { qbId: qb.Id, status: "conflict", error: "Both sides changed since the last sync — Crewkat was newer and won; the QuickBooks edit was overwritten.", lastSyncedAt: new Date(), crewkatUpdatedAt: inv.updatedAt, qbUpdatedAt: updated.MetaData?.LastUpdatedTime ? new Date(updated.MetaData.LastUpdatedTime) : new Date() });
        } else {
          await db.update(schema.invoices).set({ total: (qb.TotalAmt ?? 0).toFixed(2), status: (qb.Balance ?? 1) <= 0 ? "paid" : inv.status, updatedAt: new Date() }).where(eq(schema.invoices.id, inv.id));
          await upsertRecord(db, companyId, "invoice", inv.id, { qbId: qb.Id, status: "conflict", error: "Both sides changed since the last sync — QuickBooks was newer and won; the Crewkat edit was overwritten.", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qbTime ?? new Date() });
        }
        summary.conflicts++;
      } else if (crewChanged) {
        const updated = record?.qbId ? await pushUpdate() : qb;
        await upsertRecord(db, companyId, "invoice", inv.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: inv.updatedAt, qbUpdatedAt: updated.MetaData?.LastUpdatedTime ? new Date(updated.MetaData.LastUpdatedTime) : qbTime ?? new Date() });
        if (record?.qbId) summary.pushed++;
      } else if (qbChanged) {
        await db.update(schema.invoices).set({ total: (qb.TotalAmt ?? 0).toFixed(2), status: (qb.Balance ?? 1) <= 0 ? "paid" : inv.status, updatedAt: new Date() }).where(eq(schema.invoices.id, inv.id));
        await upsertRecord(db, companyId, "invoice", inv.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qbTime ?? new Date() });
        summary.pulled++;
      } else if (!record?.qbId) {
        await upsertRecord(db, companyId, "invoice", inv.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: inv.updatedAt, qbUpdatedAt: qbTime ?? new Date() });
      } else {
        await upsertRecord(db, companyId, "invoice", inv.id, { status: "synced", error: "", lastSyncedAt: new Date() });
      }
    } catch (err) {
      await markError("invoice", inv.id, err);
    }
  }
  // Pull: QB invoices unknown to Crewkat become invoices (or map by number).
  for (const qb of qbInvoices) {
    if (byQbId.has(`invoice:${qb.Id}`)) continue;
    if ([...qbInvoiceIdForInvoice.values()].includes(qb.Id)) continue;
    try {
      const clientId = qb.CustomerRef?.value ? clientIdForQbCustomer.get(qb.CustomerRef.value) ?? null : null;
      const lines = (qb.Line ?? []).filter((l) => l.DetailType === "SalesItemLineDetail").map((l) => {
        const detail = (l.SalesItemLineDetail ?? {}) as { Qty?: number };
        return { description: String(l.Description ?? ""), amount: String(l.Amount ?? "0"), quantity: detail.Qty ?? 1 };
      });
      const rows = await db.insert(schema.invoices).values({
        companyId,
        invoiceNumber: qb.DocNumber ?? "",
        clientId,
        clientName: qb.CustomerRef?.name ?? "",
        lineItemsJson: JSON.stringify(lines.length ? lines : [{ description: "Services", amount: String(qb.TotalAmt ?? "0"), quantity: 1 }]),
        subtotal: (qb.TotalAmt ?? 0).toFixed(2),
        total: (qb.TotalAmt ?? 0).toFixed(2),
        issueDate: qb.TxnDate ?? "",
        dueDate: "",
        status: (qb.Balance ?? 1) <= 0 ? "paid" : "sent",
      }).returning({ id: schema.invoices.id });
      const made = rows[0];
      if (!made) continue;
      qbInvoiceIdForInvoice.set(made.id, qb.Id);
      await upsertRecord(db, companyId, "invoice", made.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qb.MetaData?.LastUpdatedTime ? new Date(qb.MetaData.LastUpdatedTime) : new Date() });
      summary.pulled++;
    } catch {
      summary.errors++;
    }
  }

  // ---------------- Payments (append-only) ----------------
  const crewPayments = await db.select().from(schema.payments).where(eq(schema.payments.companyId, companyId));
  for (const pay of crewPayments) {
    const record = byKey.get(`payment:${pay.id}`);
    if (record?.qbId) continue;
    try {
      const qbInvoiceId = qbInvoiceIdForInvoice.get(pay.invoiceId);
      if (!qbInvoiceId) throw new Error("The payment's invoice is not synced to QuickBooks yet.");
      const inv = crewInvoices.find((i) => i.id === pay.invoiceId);
      const qbCustomerId = inv?.clientId != null ? qbCustomerIdForClient.get(inv.clientId) : undefined;
      if (!qbCustomerId) throw new Error("The payment's client is not synced to QuickBooks yet.");
      const created = await client.call("POST", "/payment", { CustomerRef: { value: qbCustomerId }, TotalAmt: parseMoney(pay.amount), ...(pay.paymentDate ? { TxnDate: pay.paymentDate } : {}), Line: [{ Amount: parseMoney(pay.amount), LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }] }] }) as unknown as QbPayment;
      if (!created.Id) throw new Error("QuickBooks did not return the new payment.");
      await upsertRecord(db, companyId, "payment", pay.id, { qbId: created.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: pay.createdAt, qbUpdatedAt: created.MetaData?.LastUpdatedTime ? new Date(created.MetaData.LastUpdatedTime) : new Date() });
      summary.pushed++;
    } catch (err) {
      await markError("payment", pay.id, err);
    }
  }
  const qbPayments = await client.query<QbPayment>("Payment");
  const invoiceIdForQbInvoice = new Map([...qbInvoiceIdForInvoice.entries()].map(([k, v]) => [v, k]));
  for (const qb of qbPayments) {
    if (byQbId.has(`payment:${qb.Id}`)) continue;
    const linkedInvoiceQbId = qb.Line?.flatMap((l) => l.LinkedTxn ?? []).find((t) => t.TxnType === "Invoice")?.TxnId;
    const invoiceId = linkedInvoiceQbId ? invoiceIdForQbInvoice.get(linkedInvoiceQbId) : undefined;
    if (!invoiceId) continue;
    try {
      const rows = await db.insert(schema.payments).values({ companyId, invoiceId, amount: (qb.TotalAmt ?? 0).toFixed(2), paymentDate: qb.TxnDate ?? "", method: "QuickBooks", note: "Synced from QuickBooks" }).returning({ id: schema.payments.id });
      const made = rows[0];
      if (!made) continue;
      await upsertRecord(db, companyId, "payment", made.id, { qbId: qb.Id, status: "synced", error: "", lastSyncedAt: new Date(), crewkatUpdatedAt: new Date(), qbUpdatedAt: qb.MetaData?.LastUpdatedTime ? new Date(qb.MetaData.LastUpdatedTime) : new Date() });
      summary.pulled++;
    } catch {
      summary.errors++;
    }
  }

  await db.update(schema.quickbooksConnections).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(schema.quickbooksConnections.id, conn.id));
  return summary;
}
