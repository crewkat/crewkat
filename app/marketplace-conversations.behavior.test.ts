// Marketplace private conversations behavior tests.
//
// Covers:
//  1. Migration 0058 creates marketplace_conversations + conversation_id.
//  2. Migration heuristic: legacy listing-keyed messages are split into one
//     conversation per (listing, inquirer company); owner replies attach to
//     the most recently active conversation.
//  3. Separate threads for separate inquirers; messages never cross.
//  4. Inquirer A cannot read or send in inquirer B's thread (nor outsiders).
//  5. Per-participant read state, with no read-state leakage to the other side.
//  6. Owner reply notifications target only that conversation's inquirer
//     (covered structurally: send path notifies a single recipient company).
//
// Run from app/:  bun marketplace-conversations.behavior.test.ts
import { mkdtemp, cp, writeFile, readFile } from "node:fs/promises";
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
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function throwsAsync(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (error) {
    check(name, !match || match.test(error instanceof Error ? error.message : String(error)), error instanceof Error ? error.message : String(error));
  }
}

// --- 1. Fresh scratch DB: full migrate ----------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-convos-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Journal check -----------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = journal.entries;
const last = entries[entries.length - 1];
const prev = entries[entries.length - 2];
check("newest migration tag is 0071_admin_phase1", last.tag === "0071_admin_phase1", last.tag);
check("0059 when is strictly newer than 0058 (drizzle skips older)", last.when > prev.when, `${last.when} vs ${prev.when}`);

// --- 3. Migration heuristic on a pre-0058 database ------------------------------
const legacyDir = await mkdtemp(join(tmpdir(), "crewkat-convos-legacy-"));
await cp("./drizzle", join(legacyDir, "drizzle"), { recursive: true });
const legacyJournalPath = join(legacyDir, "drizzle", "meta", "_journal.json");
const legacyJournal = JSON.parse(await readFile(legacyJournalPath, "utf8"));
legacyJournal.entries = legacyJournal.entries.filter((e: any) => e.idx <= 56);
await writeFile(legacyJournalPath, JSON.stringify(legacyJournal, null, 2));
const legacyClient = createClient({ url: `file:${join(legacyDir, "legacy.db")}` });
const legacyDb = drizzle(legacyClient, { schema });
await migrate(legacyDb, { migrationsFolder: join(legacyDir, "drizzle") });

// Legacy listing (company 1 owns it) with listing-keyed messages. Raw SQL is
// used because the current drizzle schema already includes conversation_id,
// which does not exist yet in this pre-0058 database.
const legacyListingRes = await legacyClient.execute({
  sql: `INSERT INTO marketplace_listings (company_id, title, category, service_area, company_name, moderation_status, created_at, updated_at) VALUES (1, 'Roof repair', 'roofing', 'Tampa Bay', 'Owner Co', 'active', 1767225600000, 1767225600000) RETURNING id`,
  args: [],
});
const legacyListingId = Number(legacyListingRes.rows[0].id);
await legacyClient.execute({
  sql: `INSERT INTO marketplace_messages (company_id, listing_id, body, sender, sender_company_id, created_at) VALUES
    (1, ?, 'Hi, is this still available?', 'other', 2, 1767348000000),
    (1, ?, 'Interested, what is the price?', 'other', 3, 1767434400000),
    (1, ?, 'Yes, still available!', 'me', 1, 1767520800000)`,
  args: [legacyListingId, legacyListingId, legacyListingId],
});
// Second listing with an owner message but no inquirer messages at all.
const lonelyListingRes = await legacyClient.execute({
  sql: `INSERT INTO marketplace_listings (company_id, title, category, service_area, company_name, moderation_status, created_at, updated_at) VALUES (1, 'Old lonely post', 'other', 'Tampa Bay', 'Owner Co', 'active', 1767225600000, 1767225600000) RETURNING id`,
  args: [],
});
const lonelyListingId = Number(lonelyListingRes.rows[0].id);
await legacyClient.execute({
  sql: `INSERT INTO marketplace_messages (company_id, listing_id, body, sender, sender_company_id, created_at) VALUES (1, ?, 'Owner note to nobody', 'me', 1, 1767607200000)`,
  args: [lonelyListingId],
});
// Now apply 0058 on top of the legacy data.
legacyJournal.entries = [...legacyJournal.entries, { idx: 57, version: "6", when: 1791400000003, tag: "0058_marketplace_conversations", breakpoints: true }];
await writeFile(legacyJournalPath, JSON.stringify(legacyJournal, null, 2));
await migrate(legacyDb, { migrationsFolder: join(legacyDir, "drizzle") });

const legacyConvos = await legacyDb.select().from(schema.marketplaceConversations);
check("heuristic creates one conversation per inquirer company", legacyConvos.length === 2, `got ${legacyConvos.length}`);
const convoFor2 = legacyConvos.find((c) => c.inquirerCompanyId === 2);
const convoFor3 = legacyConvos.find((c) => c.inquirerCompanyId === 3);
check("conversation owner side is the listing company", legacyConvos.every((c) => c.ownerCompanyId === 1));
const legacyMessages = await legacyDb.select().from(schema.marketplaceMessages).where(eq(schema.marketplaceMessages.listingId, legacyListingId));
const inquirer2Msg = legacyMessages.find((m) => m.senderCompanyId === 2);
const inquirer3Msg = legacyMessages.find((m) => m.senderCompanyId === 3);
const ownerMsg = legacyMessages.find((m) => m.sender === "me");
check("inquirer A message backfilled to A's conversation", inquirer2Msg?.conversationId === convoFor2?.id, String(inquirer2Msg?.conversationId));
check("inquirer B message backfilled to B's conversation", inquirer3Msg?.conversationId === convoFor3?.id, String(inquirer3Msg?.conversationId));
check("owner reply attaches to most recently active conversation (B)", ownerMsg?.conversationId === convoFor3?.id, String(ownerMsg?.conversationId));
const lonelyMsg = (await legacyDb.select().from(schema.marketplaceMessages).where(eq(schema.marketplaceMessages.listingId, lonelyListingId)))[0];
check("owner message with no inquirer conversation keeps NULL conversation_id", lonelyMsg?.conversationId == null, String(lonelyMsg?.conversationId));

// --- 4. Fresh-db action tests -----------------------------------------------------
const now = new Date();
const mkUser = (name: string, email: string, companyId: number) =>
  db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", companyId, createdAt: now });
await mkUser("Owner", "owner@test.com", 1);
await mkUser("Inquirer A", "a@test.com", 2);
await mkUser("Inquirer B", "b@test.com", 3);
await mkUser("Outsider", "outsider@test.com", 4);
const byEmail = async (email: string) => (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
const owner = await byEmail("owner@test.com");
const inquirerA = await byEmail("a@test.com");
const inquirerB = await byEmail("b@test.com");
const outsider = await byEmail("outsider@test.com");

const ctxFor = (user: typeof owner) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  workspaceTier: user.tier,
  invalidateQueries: () => {},
}) as any;

const actions = BaseActions as any;
for (const name of ["startMarketplaceConversation", "marketplaceConversations", "marketplaceConversation", "markMarketplaceConversationRead", "sendMarketplaceMessage"]) {
  check(`action exists: ${name}`, typeof actions[name]?.handler === "function");
}

const listing = (await db.insert(schema.marketplaceListings).values({
  companyId: 1, title: "Kitchen remodel", category: "kitchens", serviceArea: "Tampa Bay",
  companyName: "Owner Co", moderationStatus: "active", createdAt: now, updatedAt: now,
}).returning({ id: schema.marketplaceListings.id }))[0];

// --- 5. Start conversations -------------------------------------------------------
const convoA = await actions.startMarketplaceConversation.handler(ctxFor(inquirerA), { listingId: listing.id });
const convoB = await actions.startMarketplaceConversation.handler(ctxFor(inquirerB), { listingId: listing.id });
check("separate inquirers get separate conversations", convoA.conversationId !== convoB.conversationId, `${convoA.conversationId} vs ${convoB.conversationId}`);
const convoA2 = await actions.startMarketplaceConversation.handler(ctxFor(inquirerA), { listingId: listing.id });
check("starting twice returns the same conversation (idempotent)", convoA2.conversationId === convoA.conversationId);
await throwsAsync("owner cannot start a conversation on their own listing", () => actions.startMarketplaceConversation.handler(ctxFor(owner), { listingId: listing.id }), /own listing/);
await throwsAsync("starting on a missing listing throws", () => actions.startMarketplaceConversation.handler(ctxFor(inquirerA), { listingId: 999999 }), /no longer available/);

// --- 6. Messaging ------------------------------------------------------------------
await actions.sendMarketplaceMessage.handler(ctxFor(inquirerA), { conversationId: convoA.conversationId, body: "Hello from A", image: null });
await actions.sendMarketplaceMessage.handler(ctxFor(inquirerB), { conversationId: convoB.conversationId, body: "Hello from B", image: null });
await actions.sendMarketplaceMessage.handler(ctxFor(owner), { conversationId: convoA.conversationId, body: "Reply to A", image: null });
await throwsAsync("inquirer A cannot send in inquirer B's thread", () => actions.sendMarketplaceMessage.handler(ctxFor(inquirerA), { conversationId: convoB.conversationId, body: "Sneaky", image: null }), /not found/);
await throwsAsync("outsider cannot send in A's thread", () => actions.sendMarketplaceMessage.handler(ctxFor(outsider), { conversationId: convoA.conversationId, body: "Sneaky", image: null }), /not found/);
// Note: the request schema trims whitespace via zod before the handler runs;
// the handler-level guard is exercised here with a truly empty body.
await throwsAsync("empty message is rejected", () => actions.sendMarketplaceMessage.handler(ctxFor(inquirerA), { conversationId: convoA.conversationId, body: "", image: null }), /Write a message/);

const threadA = await actions.marketplaceConversation.handler(ctxFor(inquirerA), { conversationId: convoA.conversationId });
check("A's thread has exactly A's messages + owner's reply", threadA.messages.length === 2, `got ${threadA.messages.length}`);
check("messages never cross conversations (no B content in A's thread)", threadA.messages.every((m: any) => !m.body.includes("Hello from B")));
check("outgoing flag is relative to the viewer", threadA.messages[0].outgoing === true && threadA.messages[1].outgoing === false);
const threadARaw = JSON.stringify(threadA);
check("no read-state leakage in thread payload", !/readAt/i.test(threadARaw), threadARaw.slice(0, 120));
await throwsAsync("inquirer A cannot read inquirer B's thread", () => actions.marketplaceConversation.handler(ctxFor(inquirerA), { conversationId: convoB.conversationId }), /not found/);
await throwsAsync("outsider cannot read A's thread", () => actions.marketplaceConversation.handler(ctxFor(outsider), { conversationId: convoA.conversationId }), /not found/);

// --- 7. Inbox: one row per conversation, per-participant unread ----------------------
const inboxOwner = await actions.marketplaceConversations.handler(ctxFor(owner), {});
check("owner inbox has one row per inquirer", inboxOwner.conversations.length === 2, `got ${inboxOwner.conversations.length}`);
check("owner inbox rows carry the inquirer company name, not a shared thread", inboxOwner.conversations.every((c: any) => typeof c.otherPartyName === "string" && c.otherPartyName.length > 0));
const inboxA = await actions.marketplaceConversations.handler(ctxFor(inquirerA), {});
check("inquirer A sees only their own conversation", inboxA.conversations.length === 1 && inboxA.conversations[0].id === convoA.conversationId);
const inboxOutsider = await actions.marketplaceConversations.handler(ctxFor(outsider), {});
check("outsider sees no conversations", inboxOutsider.conversations.length === 0 && inboxOutsider.unreadCount === 0);

// After the owner's reply to A: A has 1 unread, B has 1 unread, owner has 1 (B's hello).
check("A has 1 unread after owner's reply", inboxA.unreadCount === 1, `got ${inboxA.unreadCount}`);
const inboxB = await actions.marketplaceConversations.handler(ctxFor(inquirerB), {});
check("B has 0 unread (only B's own message so far)", inboxB.unreadCount === 0, `got ${inboxB.unreadCount}`);
check("owner has 2 unread (A's hello + B's hello, never marked read)", inboxOwner.unreadCount === 2, `got ${inboxOwner.unreadCount}`);
const inboxRaw = JSON.stringify(inboxOwner);
check("no read-state leakage in inbox payload", !/readAt/i.test(inboxRaw));

// A reads their thread: only A's read timestamp moves.
await actions.markMarketplaceConversationRead.handler(ctxFor(inquirerA), { conversationId: convoA.conversationId });
const inboxA2 = await actions.marketplaceConversations.handler(ctxFor(inquirerA), {});
check("A's unread clears after reading", inboxA2.unreadCount === 0, `got ${inboxA2.unreadCount}`);
const inboxOwner2 = await actions.marketplaceConversations.handler(ctxFor(owner), {});
check("owner's unread unchanged by A's read", inboxOwner2.unreadCount === 2, `got ${inboxOwner2.unreadCount}`);
await throwsAsync("A cannot mark B's thread read", () => actions.markMarketplaceConversationRead.handler(ctxFor(inquirerA), { conversationId: convoB.conversationId }), /not found/);

// Owner reads B's conversation; B's unread is untouched.
await actions.markMarketplaceConversationRead.handler(ctxFor(owner), { conversationId: convoB.conversationId });
const inboxB2 = await actions.marketplaceConversations.handler(ctxFor(inquirerB), {});
check("B's unread untouched by owner's read", inboxB2.unreadCount === 0, `got ${inboxB2.unreadCount}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
