// Invoice Fly → Crewkat import (Danny, 2026-10-27).
//
// The switching-cost killer: a contractor leaving Invoice Fly exports two
// spreadsheets (Clients, Invoices) and lands them here. The flow is
// preview-first — the server parses + classifies every row against the
// company's existing records and NOTHING writes until the user confirms
// a selection in the preview.
//
// Classification model:
// - Clients match by email (case-insensitive), then phone (digits-only),
//   then normalized name. A file row can also match an EARLIER row of the
//   same file (Invoice Fly happily exports the same person twice with
//   differently-cased emails), so classification runs sequentially over
//   a pool that grows with each NEW row.
// - Invoices keep their Invoice Fly number verbatim ("INV0021", no
//   dash). That is deliberate: Crewkat's native sequence derives from
//   max(invoice id) + 1 in nextInvoiceNumber, never from the stored
//   text, so imported numbers can neither advance nor collide with the
//   native sequence, and the undashed form stays visibly distinct from
//   native "INV-0021" numbers. The line item carries the IMPORT_MARKER
//   text, which is what idempotency keys on (number + marker): re-running
//   the same file classifies every previously-imported row "imported"
//   and writes nothing twice.
// - DUPLICATE-FLAG = same client + same total + issue date within 45
//   days of an existing Crewkat invoice (the same real-world job kept in
//   both systems). NUMBER-COLLISION = same normalized display number,
//   different job. Both default to excluded; the user can toggle them
//   on in the preview.
//
// Money representation: the file's Discount and Tax are absolute
// amounts, so imported invoices store discountType/taxType "fixed" with
// those amounts and the file's Total verbatim — totals reconcile to the
// cent with the export. Tips (zero across Danny's real file) are noted
// in the invoice footnote when nonzero rather than folded into any
// total, since Invoice Fly does not say whether its Total includes them.
//
// Gating is the exports family: OFFICE_ACTIONS in the role map plus the
// seeMoney switch family (MONEY_EXPORT_ACTIONS) in permissions.ts —
// full financials cross the app boundary in either direction.

import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { workspaceIdentity } from "./actions";
import { moneyString, parseMoneyLoose } from "./changeOrders";

type Db = ReturnType<Ctx["db"]>;
type ClientRow = typeof schema.clients.$inferSelect;
type InvoiceRow = typeof schema.invoices.$inferSelect;

export const IMPORT_MARKER = "Imported from Invoice Fly";
const MAX_CLIENT_ROWS = 1000;
const MAX_INVOICE_ROWS = 2000;
const DUPLICATE_WINDOW_DAYS = 45;
const MAX_ADDRESSES_PER_CLIENT = 20;

// ---------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, "" escapes, embedded commas and
// newlines — Invoice Fly client addresses contain both).
// ---------------------------------------------------------------------

export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); cell = ""; rows.push(row); row = []; }
    else if (c !== "\r") cell += c;
  }
  if (inQuotes) throw new Error("That file looks cut off — a quoted field never closes. Export it again and retry.");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

function headerIndex(header: string[], names: string[]): number {
  const normalized = header.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const idx = normalized.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

// Invoice Fly escapes a leading "+" (phone numbers) with an apostrophe.
function cleanCell(value: string): string {
  return value.trim().replace(/^'/, "").trim();
}

// ---------------------------------------------------------------------
// Normalization + matching primitives.
// ---------------------------------------------------------------------

export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function phoneDigitsKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeInvoiceNumberKey(number: string): string {
  return number.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const STREET_SUFFIX = /\b(ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|hwy|highway|ln|lane|loop|pl|place|rd|road|st|street|ter|terrace|trl|trail|way)\b/i;

/** True when a "name" is really a street address (the file's Shaw row:
 *  Name = "13842 Rudi Loop, Spring Hill, FL 34609", Address empty). */
export function looksLikeStreetAddress(value: string): boolean {
  const v = value.trim();
  if (!/^\d{1,6}\s+\S/.test(v)) return false;
  return STREET_SUFFIX.test(v) && (/\b(FL|Florida)\b/i.test(v) || /\b\d{5}(-\d{4})?\b/.test(v));
}

function validDateKey(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Invoice Fly dates are M/D/YYYY; ISO passes through. "" when invalid. */
export function parseImportDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return validDateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) return validDateKey(Number(us[3]), Number(us[1]), Number(us[2]));
  return "";
}

function daysBetweenKeys(a: string, b: string): number {
  const ms = new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime();
  return Math.abs(Math.round(ms / 86_400_000));
}

// ---------------------------------------------------------------------
// Parsed file rows.
// ---------------------------------------------------------------------

export interface ParsedClientRow {
  index: number;
  name: string;
  company: string;
  email: string;
  email2: string;
  email3: string;
  phone: string;
  phone2: string;
  fax: string;
  address: string;
  notes: string;
}

export function parseInvoiceFlyClients(csvText: string): ParsedClientRow[] {
  const rows = parseCsvText(csvText);
  if (rows.length === 0) throw new Error("That clients file is empty.");
  const header = rows[0]!;
  const col = {
    name: headerIndex(header, ["name"]),
    company: headerIndex(header, ["company name", "company"]),
    email: headerIndex(header, ["email", "e-mail"]),
    email2: headerIndex(header, ["2nd email"]),
    email3: headerIndex(header, ["3rd email"]),
    phone: headerIndex(header, ["phone"]),
    phone2: headerIndex(header, ["2nd phone"]),
    fax: headerIndex(header, ["fax"]),
    address: headerIndex(header, ["address"]),
    notes: headerIndex(header, ["additional notes", "notes"]),
  };
  if (col.name < 0 && col.email < 0) {
    throw new Error("That doesn't look like an Invoice Fly clients export — its Name/Email columns are missing.");
  }
  const get = (r: string[], i: number) => (i >= 0 ? cleanCell(r[i] ?? "") : "");
  const parsed = rows.slice(1).map((r, i): ParsedClientRow => ({
    index: i,
    name: get(r, col.name),
    company: get(r, col.company),
    email: get(r, col.email),
    email2: get(r, col.email2),
    email3: get(r, col.email3),
    phone: get(r, col.phone),
    phone2: get(r, col.phone2),
    fax: get(r, col.fax),
    address: get(r, col.address),
    notes: get(r, col.notes),
  }));
  if (parsed.length > MAX_CLIENT_ROWS) {
    throw new Error(`That clients file has ${parsed.length} rows — imports cap at ${MAX_CLIENT_ROWS} per file. Split it and run the rest after.`);
  }
  return parsed;
}

export interface ParsedInvoiceRow {
  index: number;
  number: string;
  issueDate: string;
  dueDate: string;
  dateValid: boolean;
  clientName: string;
  clientEmail: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  totalValid: boolean;
  paid: number;
  paidDate: string;
  balanceDue: number;
  tips: number;
}

export function parseInvoiceFlyInvoices(csvText: string): ParsedInvoiceRow[] {
  const rows = parseCsvText(csvText);
  if (rows.length === 0) throw new Error("That invoices file is empty.");
  const header = rows[0]!;
  const col = {
    number: headerIndex(header, ["invoice", "invoice number", "invoice #"]),
    date: headerIndex(header, ["date", "issue date", "invoice date"]),
    due: headerIndex(header, ["due", "due date"]),
    client: headerIndex(header, ["client", "client name"]),
    clientEmail: headerIndex(header, ["client email", "email"]),
    subtotal: headerIndex(header, ["subtotal"]),
    discount: headerIndex(header, ["discount"]),
    tax: headerIndex(header, ["tax"]),
    total: headerIndex(header, ["total"]),
    paid: headerIndex(header, ["paid", "paid amount", "amount paid"]),
    paidDate: headerIndex(header, ["paid date", "payment date"]),
    balanceDue: headerIndex(header, ["balance due", "balance"]),
    tips: headerIndex(header, ["tips", "tip"]),
  };
  if (col.number < 0 || col.total < 0 || col.client < 0) {
    throw new Error("That doesn't look like an Invoice Fly invoices export — its Invoice/Client/Total columns are missing.");
  }
  const get = (r: string[], i: number) => (i >= 0 ? cleanCell(r[i] ?? "") : "");
  const parsed = rows.slice(1).map((r, i): ParsedInvoiceRow => {
    const issueDate = parseImportDate(get(r, col.date));
    const totalRaw = get(r, col.total);
    return {
      index: i,
      number: get(r, col.number),
      issueDate,
      dueDate: parseImportDate(get(r, col.due)),
      dateValid: issueDate !== "",
      clientName: get(r, col.client),
      clientEmail: get(r, col.clientEmail),
      subtotal: parseMoneyLoose(get(r, col.subtotal)),
      discount: parseMoneyLoose(get(r, col.discount)),
      tax: parseMoneyLoose(get(r, col.tax)),
      total: parseMoneyLoose(totalRaw),
      totalValid: totalRaw !== "" && Number.isFinite(Number(totalRaw.replace(/[^0-9.-]/g, ""))),
      paid: parseMoneyLoose(get(r, col.paid)),
      paidDate: parseImportDate(get(r, col.paidDate)),
      balanceDue: parseMoneyLoose(get(r, col.balanceDue)),
      tips: parseMoneyLoose(get(r, col.tips)),
    };
  });
  if (parsed.length > MAX_INVOICE_ROWS) {
    throw new Error(`That invoices file has ${parsed.length} rows — imports cap at ${MAX_INVOICE_ROWS} per file. Split it and run the rest after.`);
  }
  return parsed;
}

// ---------------------------------------------------------------------
// Client identity resolution (the file's messy rows).
// ---------------------------------------------------------------------

export interface ResolvedClientIdentity {
  name: string;
  email: string;
  phone: string;
  address: string;
  nameFromAddress: boolean;
  addressAsName: boolean;
}

export function resolveClientIdentity(row: ParsedClientRow): ResolvedClientIdentity {
  let address = row.address.trim();
  let name = row.name.trim();
  let nameFromAddress = false;
  if (name && looksLikeStreetAddress(name)) {
    if (!address) address = name;
    nameFromAddress = true;
    name = "";
  }
  if (!name) name = row.company.trim();
  if (!name && row.email) {
    const prefix = row.email.split("@")[0]!.replace(/[._-]+/g, " ").trim();
    if (prefix) name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }
  // Last resort (spec): a row whose only identifier is the street
  // address keeps it as the name, flagged so the preview can say so.
  let addressAsName = false;
  if (!name && nameFromAddress) {
    name = address;
    addressAsName = true;
  }
  // Invoice Fly sometimes packs two numbers into the Phone cell —
  // the first is the primary; the rest are preserved in notes at write
  // time (see clientNotesFor).
  const phone = (row.phone.split(",")[0] ?? "").trim();
  return { name, email: row.email.trim(), phone, address, nameFromAddress, addressAsName };
}

function clientNotesFor(row: ParsedClientRow): string {
  const parts: string[] = [];
  if (row.notes) parts.push(row.notes);
  const extras: string[] = [];
  if (row.email2) extras.push(`2nd email: ${row.email2}`);
  if (row.email3) extras.push(`3rd email: ${row.email3}`);
  const extraPhones = [...row.phone.split(",").slice(1).map((s) => s.trim()), row.phone2].filter(Boolean);
  for (const p of extraPhones) extras.push(`Other phone: ${p}`);
  if (row.fax) extras.push(`Fax: ${row.fax}`);
  if (extras.length) parts.push(extras.join("\n"));
  return parts.join("\n").slice(0, 3000);
}

// ---------------------------------------------------------------------
// Matching pool: existing clients + virtual entries for file rows
// already classified NEW (so a repeated person in one file matches the
// earlier row instead of duplicating).
// ---------------------------------------------------------------------

interface PoolEntry {
  id: number | null;
  rowIndex: number | null;
  name: string;
  email: string;
  phone: string;
}

interface Probe { emailKey: string; phoneKey: string; nameKey: string }

function probeOf(name: string, email: string, phone: string): Probe {
  return { emailKey: normalizeEmailKey(email), phoneKey: phoneDigitsKey(phone), nameKey: normalizeNameKey(name) };
}

function matchInPool(pool: PoolEntry[], probe: Probe): { entry: PoolEntry; by: "email" | "phone" | "name" } | null {
  if (probe.emailKey) {
    const hit = pool.find((c) => normalizeEmailKey(c.email) === probe.emailKey);
    if (hit) return { entry: hit, by: "email" };
  }
  if (probe.phoneKey) {
    const hit = pool.find((c) => phoneDigitsKey(c.phone) === probe.phoneKey);
    if (hit) return { entry: hit, by: "phone" };
  }
  if (probe.nameKey) {
    const hit = pool.find((c) => normalizeNameKey(c.name) === probe.nameKey);
    if (hit) return { entry: hit, by: "name" };
  }
  return null;
}

// ---------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------

export type ClientImportStatus = "new" | "matched" | "invalid";
export interface ClientClassification {
  row: ParsedClientRow;
  identity: ResolvedClientIdentity;
  status: ClientImportStatus;
  matchedClientId: number | null;
  matchedRowIndex: number | null;
  matchedName: string;
  note: string;
  included: boolean;
}

export function classifyClients(existing: ClientRow[], rows: ParsedClientRow[]): ClientClassification[] {
  const pool: PoolEntry[] = existing.map((c) => ({ id: c.id, rowIndex: null, name: c.name, email: c.email, phone: c.phone }));
  const out: ClientClassification[] = [];
  for (const row of rows) {
    const identity = resolveClientIdentity(row);
    if (!identity.name && !row.company.trim() && !row.email.trim()) {
      out.push({ row, identity, status: "invalid", matchedClientId: null, matchedRowIndex: null, matchedName: "", note: "No name, company, or email in the file — nothing to import.", included: false });
      continue;
    }
    const hit = matchInPool(pool, probeOf(identity.name, identity.email, identity.phone));
    if (hit) {
      const note = hit.entry.rowIndex != null
        ? `Same client as row ${hit.entry.rowIndex + 1} of this file — imported once.`
        : `Already in Crewkat — matched by ${hit.by}. Only a new address is added.`;
      out.push({ row, identity, status: "matched", matchedClientId: hit.entry.id, matchedRowIndex: hit.entry.rowIndex, matchedName: hit.entry.name, note, included: true });
      continue;
    }
    let note = "";
    if (identity.addressAsName) note = "The Name field held a street address and there's no other name — rename this client when you can.";
    else if (identity.nameFromAddress) note = "The Name field held a street address — it's imported as the address; the client is named from the file's other fields.";
    out.push({ row, identity, status: "new", matchedClientId: null, matchedRowIndex: null, matchedName: "", note, included: true });
    pool.push({ id: null, rowIndex: row.index, name: identity.name, email: identity.email, phone: identity.phone });
  }
  return out;
}

export type InvoiceImportStatus = "new" | "duplicate" | "collision" | "imported" | "invalid";
export interface InvoiceClassification {
  row: ParsedInvoiceRow;
  status: InvoiceImportStatus;
  matchedInvoiceId: number | null;
  matchedInvoiceNumber: string;
  clientId: number | null;
  clientFromFile: number | null;
  willCreateClient: boolean;
  note: string;
  included: boolean;
}

function displayNumberOf(inv: InvoiceRow): string {
  return inv.invoiceNumber || `INV-${String(inv.id).padStart(4, "0")}`;
}

function isImportedInvoice(inv: InvoiceRow, number: string): boolean {
  return inv.invoiceNumber === number && inv.lineItemsJson.includes(IMPORT_MARKER);
}

interface InvoiceClientResolution {
  clientId: number | null;
  clientFromFile: number | null;
  willCreateClient: boolean;
}

function resolveInvoiceClient(
  row: ParsedInvoiceRow,
  existing: ClientRow[],
  clientClasses: ClientClassification[],
): InvoiceClientResolution {
  const emailKey = normalizeEmailKey(row.clientEmail);
  const nameKey = normalizeNameKey(row.clientName);
  // 1. A clients-file row (matched or new) claims this invoice's client.
  for (const cc of clientClasses) {
    if (cc.status === "invalid") continue;
    const idn = cc.identity;
    const emailHit = emailKey !== "" && normalizeEmailKey(idn.email) === emailKey;
    const nameHit = nameKey !== "" && normalizeNameKey(idn.name) === nameKey;
    if (emailHit || nameHit) {
      if (cc.status === "matched" && cc.matchedClientId != null) return { clientId: cc.matchedClientId, clientFromFile: cc.row.index, willCreateClient: false };
      if (cc.status === "matched" && cc.matchedRowIndex != null) return { clientId: null, clientFromFile: cc.matchedRowIndex, willCreateClient: false };
      return { clientId: null, clientFromFile: cc.row.index, willCreateClient: false };
    }
  }
  // 2. An existing Crewkat client.
  const pool: PoolEntry[] = existing.map((c) => ({ id: c.id, rowIndex: null, name: c.name, email: c.email, phone: c.phone }));
  const hit = matchInPool(pool, probeOf(row.clientName, row.clientEmail, ""));
  if (hit && hit.entry.id != null) return { clientId: hit.entry.id, clientFromFile: null, willCreateClient: false };
  // 3. Nobody knows this client — the run creates a minimal record.
  return { clientId: null, clientFromFile: null, willCreateClient: true };
}

export function classifyInvoices(
  existingInvoices: InvoiceRow[],
  existingClients: ClientRow[],
  clientClasses: ClientClassification[],
  rows: ParsedInvoiceRow[],
): InvoiceClassification[] {
  return rows.map((row): InvoiceClassification => {
    const base = { row, matchedInvoiceId: null, matchedInvoiceNumber: "", clientId: null, clientFromFile: null, willCreateClient: false };
    if (!row.number || !row.dateValid || !row.totalValid) {
      const why = !row.number ? "no invoice number" : !row.dateValid ? "an unreadable date" : "an unreadable total";
      return { ...base, status: "invalid", note: `Skipped — this row has ${why}.`, included: false };
    }
    const already = existingInvoices.find((inv) => isImportedInvoice(inv, row.number));
    if (already) {
      return { ...base, status: "imported", matchedInvoiceId: already.id, matchedInvoiceNumber: displayNumberOf(already), note: "Already imported — Crewkat has this Invoice Fly invoice.", included: false };
    }
    const resolution = resolveInvoiceClient(row, existingClients, clientClasses);
    const nameKey = normalizeNameKey(row.clientName);
    const duplicate = existingInvoices.find((inv) => {
      const sameClient = (resolution.clientId != null && inv.clientId === resolution.clientId)
        || (nameKey !== "" && normalizeNameKey(inv.clientName) === nameKey);
      if (!sameClient) return false;
      if (Math.abs(parseMoneyLoose(inv.total) - row.total) >= 0.005) return false;
      if (!inv.issueDate) return false;
      return daysBetweenKeys(inv.issueDate, row.issueDate) <= DUPLICATE_WINDOW_DAYS;
    });
    if (duplicate) {
      return {
        ...base, status: "duplicate", matchedInvoiceId: duplicate.id, matchedInvoiceNumber: displayNumberOf(duplicate),
        clientId: resolution.clientId, clientFromFile: resolution.clientFromFile, willCreateClient: resolution.willCreateClient,
        note: `Looks like the same job as ${displayNumberOf(duplicate)} in Crewkat — same client and total, close date.`, included: false,
      };
    }
    const numberKey = normalizeInvoiceNumberKey(row.number);
    const collision = existingInvoices.find((inv) => normalizeInvoiceNumberKey(displayNumberOf(inv)) === numberKey);
    if (collision) {
      return {
        ...base, status: "collision", matchedInvoiceId: collision.id, matchedInvoiceNumber: displayNumberOf(collision),
        clientId: resolution.clientId, clientFromFile: resolution.clientFromFile, willCreateClient: resolution.willCreateClient,
        note: `Crewkat already has a ${displayNumberOf(collision)} — a different client or amount.`, included: false,
      };
    }
    const note = resolution.willCreateClient
      ? "New client — a Crewkat client record is created from the invoice."
      : "";
    return {
      ...base, status: "new",
      clientId: resolution.clientId, clientFromFile: resolution.clientFromFile, willCreateClient: resolution.willCreateClient,
      note, included: true,
    };
  });
}

// ---------------------------------------------------------------------
// Preview assembly (shared by the preview action and, fresh, the run).
// ---------------------------------------------------------------------

export interface ImportPreviewData {
  clients: ClientClassification[];
  invoices: InvoiceClassification[];
}

async function loadCompanyRows(db: Db, companyId: number): Promise<{ clients: ClientRow[]; invoices: InvoiceRow[] }> {
  const [clients, invoices] = await Promise.all([
    db.select().from(schema.clients).where(eq(schema.clients.companyId, companyId)),
    db.select().from(schema.invoices).where(eq(schema.invoices.companyId, companyId)),
  ]);
  return { clients, invoices };
}

function buildPreview(clientsCsv: string, invoicesCsv: string, existingClients: ClientRow[], existingInvoices: InvoiceRow[]): ImportPreviewData {
  if (!clientsCsv.trim() && !invoicesCsv.trim()) {
    throw new Error("Choose a Clients or Invoices CSV first.");
  }
  const clientRows = clientsCsv.trim() ? parseInvoiceFlyClients(clientsCsv) : [];
  const invoiceRows = invoicesCsv.trim() ? parseInvoiceFlyInvoices(invoicesCsv) : [];
  const clients = classifyClients(existingClients, clientRows);
  const invoices = classifyInvoices(existingInvoices, existingClients, clients, invoiceRows);
  return { clients, invoices };
}

// ---------------------------------------------------------------------
// Writes (run only — the preview never touches the DB).
// ---------------------------------------------------------------------

interface SavedAddress { label: string; address: string; primary: boolean }

function addressKeyOf(address: string): string {
  return address.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseSavedAddresses(raw: string | null, legacyAddress: string): SavedAddress[] {
  let parsed: unknown = null;
  if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }
  const list: SavedAddress[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { label?: unknown; address?: unknown; primary?: unknown };
      const address = typeof e.address === "string" ? e.address.trim() : "";
      if (!address) continue;
      list.push({ label: typeof e.label === "string" ? e.label : "", address, primary: e.primary === true });
    }
  }
  if (list.length === 0 && legacyAddress.trim()) {
    list.push({ label: "", address: legacyAddress.trim(), primary: true });
  }
  return list;
}

/** Append-never-replace, same model as appendClientAddress: returns
 *  true when the address was new and got appended. Mutates the passed
 *  row's address fields so later steps in the same run see the result. */
async function appendAddressIfNew(db: Db, client: ClientRow, addressRaw: string, now: Date): Promise<boolean> {
  const address = addressRaw.trim().slice(0, 240);
  if (!address) return false;
  const current = parseSavedAddresses(client.addressesJson, client.address);
  if (current.some((e) => addressKeyOf(e.address) === addressKeyOf(address))) return false;
  if (current.length >= MAX_ADDRESSES_PER_CLIENT) return false;
  const next = [...current, { label: "", address, primary: current.length === 0 }];
  if (!next.some((e) => e.primary)) next[0]!.primary = true;
  const primaryAddress = next.find((e) => e.primary)?.address ?? client.address;
  const addressesJson = JSON.stringify(next);
  await db.update(schema.clients).set({ addressesJson, address: primaryAddress, updatedAt: now }).where(eq(schema.clients.id, client.id));
  client.addressesJson = addressesJson;
  client.address = primaryAddress;
  return true;
}

async function insertImportedClient(
  db: Db,
  companyId: number,
  name: string,
  email: string,
  phone: string,
  address: string,
  notes: string,
  now: Date,
): Promise<ClientRow> {
  const cleanAddress = address.trim().slice(0, 240);
  const rows = await db.insert(schema.clients).values({
    companyId,
    name: name.trim().slice(0, 160) || "Client",
    phone: phone.trim().slice(0, 80),
    email: email.trim().slice(0, 200),
    address: cleanAddress,
    addressesJson: cleanAddress ? JSON.stringify([{ label: "", address: cleanAddress, primary: true }]) : "[]",
    notes: notes.slice(0, 3000),
    tags: "[]",
    createdAt: now,
    updatedAt: now,
  }).returning();
  const made = rows[0];
  if (!made) throw new Error("Could not create a client during import.");
  return made;
}

// ---------------------------------------------------------------------
// Actions.
// ---------------------------------------------------------------------

const csvArgsSchema = z.object({
  clientsCsv: z.string().max(2_000_000).default(""),
  invoicesCsv: z.string().max(4_000_000).default(""),
});

const clientPreviewRowSchema = z.object({
  index: z.number(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  status: z.enum(["new", "matched", "invalid"]),
  matchedClientId: z.number().nullable(),
  matchedName: z.string(),
  note: z.string(),
  included: z.boolean(),
});

const invoicePreviewRowSchema = z.object({
  index: z.number(),
  number: z.string(),
  clientName: z.string(),
  clientEmail: z.string(),
  issueDate: z.string(),
  dueDate: z.string(),
  total: z.string(),
  paid: z.string(),
  balanceDue: z.string(),
  status: z.enum(["new", "duplicate", "collision", "imported", "invalid"]),
  matchedInvoiceNumber: z.string(),
  note: z.string(),
  included: z.boolean(),
});

const previewResponseSchema = z.object({
  clients: z.array(clientPreviewRowSchema),
  invoices: z.array(invoicePreviewRowSchema),
  counts: z.object({
    clientsTotal: z.number(), clientsNew: z.number(), clientsMatched: z.number(), clientsInvalid: z.number(),
    invoicesTotal: z.number(), invoicesNew: z.number(), invoicesDuplicate: z.number(), invoicesCollision: z.number(),
    invoicesImported: z.number(), invoicesInvalid: z.number(),
  }),
});

function toPreviewResponse(preview: ImportPreviewData) {
  const count = <T extends string>(rows: { status: T }[], status: T) => rows.filter((r) => r.status === status).length;
  return {
    clients: preview.clients.map((cc) => ({
      index: cc.row.index,
      name: cc.identity.name,
      email: cc.identity.email,
      phone: cc.identity.phone,
      address: cc.identity.address,
      status: cc.status,
      matchedClientId: cc.matchedClientId,
      matchedName: cc.matchedName,
      note: cc.note,
      included: cc.included,
    })),
    invoices: preview.invoices.map((ic) => ({
      index: ic.row.index,
      number: ic.row.number,
      clientName: ic.row.clientName,
      clientEmail: ic.row.clientEmail,
      issueDate: ic.row.issueDate,
      dueDate: ic.row.dueDate,
      total: moneyString(ic.row.total),
      paid: moneyString(ic.row.paid),
      balanceDue: moneyString(ic.row.balanceDue),
      status: ic.status,
      matchedInvoiceNumber: ic.matchedInvoiceNumber,
      note: ic.note,
      included: ic.included,
    })),
    counts: {
      clientsTotal: preview.clients.length,
      clientsNew: count(preview.clients, "new"),
      clientsMatched: count(preview.clients, "matched"),
      clientsInvalid: count(preview.clients, "invalid"),
      invoicesTotal: preview.invoices.length,
      invoicesNew: count(preview.invoices, "new"),
      invoicesDuplicate: count(preview.invoices, "duplicate"),
      invoicesCollision: count(preview.invoices, "collision"),
      invoicesImported: count(preview.invoices, "imported"),
      invoicesInvalid: count(preview.invoices, "invalid"),
    },
  };
}

const runResponseSchema = z.object({
  clientsCreated: z.number(),
  clientsMatched: z.number(),
  addressesAppended: z.number(),
  invoicesCreated: z.number(),
  invoicesSkipped: z.number(),
  paymentsCreated: z.number(),
});

export const invoiceFlyImportActions = {
  previewInvoiceFlyImport: defineAction({
    request: csvArgsSchema,
    response: previewResponseSchema,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const companyId = workspaceIdentity(ctx).workspaceCompanyId;
      const { clients, invoices } = await loadCompanyRows(db, companyId);
      return toPreviewResponse(buildPreview(args.clientsCsv, args.invoicesCsv, clients, invoices));
    },
  }),

  runInvoiceFlyImport: defineAction({
    request: csvArgsSchema.extend({
      clientIndexes: z.array(z.number().int().min(0)).max(MAX_CLIENT_ROWS).default([]),
      invoiceIndexes: z.array(z.number().int().min(0)).max(MAX_INVOICE_ROWS).default([]),
    }),
    response: runResponseSchema,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const companyId = workspaceIdentity(ctx).workspaceCompanyId;
      const { clients: existingClients, invoices: existingInvoices } = await loadCompanyRows(db, companyId);
      // Re-classify against the CURRENT database: a row whose state
      // changed since the preview (already imported by a twin row, a
      // teammate's run) is honored as it stands now, never as it was.
      const preview = buildPreview(args.clientsCsv, args.invoicesCsv, existingClients, existingInvoices);
      const now = new Date();
      const selectedClients = new Set(args.clientIndexes);
      const selectedInvoices = new Set(args.invoiceIndexes);
      const liveClients: ClientRow[] = [...existingClients];
      const clientIdByRow = new Map<number, number>();
      let clientsCreated = 0;
      let clientsMatched = 0;
      let addressesAppended = 0;

      // Matched rows resolve for invoice linking whether or not the
      // user selected them (the client exists either way).
      for (const cc of preview.clients) {
        if (cc.status !== "matched") continue;
        if (cc.matchedClientId != null) clientIdByRow.set(cc.row.index, cc.matchedClientId);
        else if (cc.matchedRowIndex != null && clientIdByRow.has(cc.matchedRowIndex)) {
          clientIdByRow.set(cc.row.index, clientIdByRow.get(cc.matchedRowIndex)!);
        }
      }
      for (const cc of preview.clients) {
        if (!selectedClients.has(cc.row.index)) continue;
        if (cc.status === "new") {
          const made = await insertImportedClient(db, companyId, cc.identity.name, cc.identity.email, cc.identity.phone, cc.identity.address, clientNotesFor(cc.row), now);
          clientIdByRow.set(cc.row.index, made.id);
          liveClients.push(made);
          clientsCreated++;
        } else if (cc.status === "matched") {
          clientsMatched++;
          const targetId = cc.matchedClientId ?? (cc.matchedRowIndex != null ? clientIdByRow.get(cc.matchedRowIndex) : undefined);
          const target = targetId != null ? liveClients.find((c) => c.id === targetId) : undefined;
          if (target && await appendAddressIfNew(db, target, cc.identity.address, now)) addressesAppended++;
        }
      }

      let invoicesCreated = 0;
      let invoicesSkipped = 0;
      let paymentsCreated = 0;
      const importedNumbersThisRun = new Set<string>();
      const createdClientByProbe = new Map<string, ClientRow>();

      for (const ic of preview.invoices) {
        if (!selectedInvoices.has(ic.row.index)) continue;
        const row = ic.row;
        if (ic.status === "invalid" || ic.status === "imported" || importedNumbersThisRun.has(row.number)) {
          invoicesSkipped++;
          continue;
        }
        // Resolve the invoice's client: clients-file row first, then
        // the preview's existing-client match, then a minimal record
        // created from the invoice itself (deduped within the run).
        let client: ClientRow | undefined;
        if (ic.clientFromFile != null && clientIdByRow.has(ic.clientFromFile)) {
          client = liveClients.find((c) => c.id === clientIdByRow.get(ic.clientFromFile));
        }
        if (!client && ic.clientId != null) {
          client = liveClients.find((c) => c.id === ic.clientId);
        }
        if (!client) {
          const key = `${normalizeEmailKey(row.clientEmail)}|${normalizeNameKey(row.clientName)}`;
          client = createdClientByProbe.get(key);
          if (!client) {
            client = await insertImportedClient(db, companyId, row.clientName || row.clientEmail, row.clientEmail, "", "", "", now);
            createdClientByProbe.set(key, client);
            liveClients.push(client);
            clientsCreated++;
          }
        }
        const balance = Math.round((row.total - row.paid) * 100) / 100;
        const status = balance <= 0.005 ? "paid" : "sent";
        const lineItems = [{
          name: "",
          description: `${IMPORT_MARKER} — ${row.number}`,
          amount: moneyString(row.subtotal),
          quantity: 1,
          discount: "0.00",
          unit: "none",
        }];
        const madeRows = await db.insert(schema.invoices).values({
          companyId,
          invoiceNumber: row.number,
          clientId: client.id,
          clientName: client.name,
          clientPhone: client.phone,
          clientEmail: client.email || row.clientEmail,
          jobAddress: client.address,
          jobType: "",
          lineItemsJson: JSON.stringify(lineItems),
          subtotal: moneyString(row.subtotal),
          discountType: "fixed",
          discountValue: moneyString(row.discount),
          taxType: "fixed",
          taxValue: moneyString(row.tax),
          total: moneyString(row.total),
          footnote: row.tips > 0.004 ? `Tip on the original Invoice Fly invoice: $${moneyString(row.tips)}.` : "",
          issueDate: row.issueDate,
          dueDate: row.dueDate,
          status,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: schema.invoices.id });
        const made = madeRows[0];
        if (!made) throw new Error("Could not create an invoice during import.");
        importedNumbersThisRun.add(row.number);
        invoicesCreated++;
        if (row.paid > 0.004) {
          await db.insert(schema.payments).values({
            companyId,
            invoiceId: made.id,
            amount: moneyString(row.paid),
            paymentDate: row.paidDate || row.dueDate || row.issueDate,
            method: "Imported",
            note: "",
            createdAt: now,
          });
          paymentsCreated++;
        }
      }

      ctx.invalidateQueries();
      return { clientsCreated, clientsMatched, addressesAppended, invoicesCreated, invoicesSkipped, paymentsCreated };
    },
  }),
};
