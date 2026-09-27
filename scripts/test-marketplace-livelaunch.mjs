// Marketplace soft-launch verification: free-tier listing create, cross-user
// visibility, inquiry messaging, owner unread badge.
// Run: bun scripts/test-marketplace-livelaunch.mjs
// Soft-launch verification: marketplace end-to-end for regular (free-tier) users.
import { createTestEnv } from "/home/hatch/workspace/crewkat-hosting/scripts/secure-login-harness.mjs";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};
const env = await createTestEnv();
const { Actions, withMeta } = env;
const call = (action, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request: " + JSON.stringify(parsed.error.issues).slice(0,200));
  return action.handler(withMeta({ ...extra }), parsed.data);
};
try {
  // two free-tier users: a business posting, a customer browsing
  await env.createVerifiedUser("biz@test.com", "correct-horse-123");
  await env.createVerifiedUser("cust@test.com", "correct-horse-123");
  const bizLogin = await Actions.login.handler(withMeta({ userAgent: "t", clientIp: "10.9.0.1" }), { email: "biz@test.com", password: "correct-horse-123" });
  const custLogin = await Actions.login.handler(withMeta({ userAgent: "t", clientIp: "10.9.0.2" }), { email: "cust@test.com", password: "correct-horse-123" });
  const biz = (a, args) => call(a, { _sessionToken: bizLogin.sessionToken, ...args });
  const cust = (a, args) => call(a, { _sessionToken: custLogin.sessionToken, ...args });

  const listing = await biz(Actions.createMarketplaceListing, {
    title: "Kitchen remodels", category: "kitchens", listingType: "project",
    employmentType: "full_time", payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "",
    description: "Full kitchen remodels in Tampa Bay.", serviceArea: "Tampa Bay",
    companyName: "Test Build Co", companyPhone: "8135550100", bookable: false, dailyRate: "", photos: [],
  });
  check("free user creates listing", listing.id > 0);

  const browse = await cust(Actions.listMarketplaceListings, {});
  check("listing visible to another user", browse.listings.some(l => l.id === listing.id));

  const thread = await cust(Actions.sendMarketplaceMessage, { listingId: listing.id, body: "Hi, need a quote!", image: null });
  check("customer messages business", !!thread);
  const inbox = await biz(Actions.getMarketplaceInbox, {});
  check("business sees unread message", (inbox.unreadCount ?? 0) > 0);
} catch (e) { check("no exceptions", false, e.message); process.exitCode = 1; }
const p = results.filter(r => r.ok).length;
console.log(`\n${p}/${results.length} passed`);
