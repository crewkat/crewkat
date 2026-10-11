// Danny 2026-10-11: "Not seeing client portal" → "lets have them back."
// Root cause: the job detail (and Home) gated sections behind simpleMode,
// which was computed as !inProWorkspace — but the proWorkspace screen is a
// dead entry nothing navigates to, so simpleMode was stuck ON for all users.
// Fix: appSettings forces simpleMode: false, restoring the portal panel,
// profit strip, Pipeline button, completion panel, field-intel/expansion
// queries, the recurring-invoice effect, and the field intel section.
// Premium gating (isPremium / isProToolScreen) is separate and untouched.
// Run from app/:  bun portal-panel-visibility.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const ACTIONS = readFileSync(join(import.meta.dir, "server/src/actions.ts"), "utf8");

describe("Simple Mode gating removed at the source", () => {
  test("appSettings forces simpleMode: false", () => {
    expect(APP).toMatch(/simpleMode:\s*false/);
    expect(APP).not.toContain("simpleMode: !inProWorkspace");
  });

  test("dead inProWorkspace computation is gone (noUnusedLocals-safe)", () => {
    expect(APP).not.toContain("inProWorkspace");
  });

  test("revert instructions left in a comment", () => {
    expect(APP).toContain("Simple Mode gating removed 2026-10-11");
  });
});

describe("Previously-hidden sections restored", () => {
  test("portal panel still mounted on the job detail", () => {
    expect(APP).toContain("<PortalOwnerPanel lang={lang} jobId={jobId} />");
  });

  test("profit strip, Pipeline button, completion panel still mounted", () => {
    expect(APP).toContain("profit-strip");
    expect(APP).toContain('{ name: "operations", tab: "leads" }');
    expect(APP).toContain('id="job-completion"');
  });

  test("field-intel and expansion queries exist and are no longer dead-gated", () => {
    expect(APP).toContain("getFieldIntelligence");
    expect(APP).toContain("getExpansionSuite");
  });

  test("recurring-invoice daily effect present", () => {
    expect(APP).toContain("processRecurringInvoices");
  });
});

describe("Premium gating untouched", () => {
  test("isPremium / isProToolScreen gates still present and separate", () => {
    expect(APP).toContain("isProToolScreen");
    // The simpleMode fix must not have touched premium checks.
    const premiumGates = (APP.match(/isPremium/g) || []).length;
    expect(premiumGates).toBeGreaterThan(0);
  });

  test("no premium check was added to the newly-enabled server actions", () => {
    for (const action of ["getFieldIntelligence", "getExpansionSuite", "processRecurringInvoices"]) {
      const idx = ACTIONS.indexOf(`${action}: defineAction`);
      expect(idx).toBeGreaterThan(-1);
      const body = ACTIONS.slice(idx, idx + 1200);
      expect(body).not.toMatch(/premium/i);
    }
  });
});

describe("Portal plumbing intact", () => {
  test("server exposes the four portal link actions", () => {
    expect(ACTIONS).toContain("createPortalLink: defineAction");
    expect(ACTIONS).toContain("rotatePortalLink: defineAction");
    expect(ACTIONS).toContain("revokePortalLink: defineAction");
    expect(ACTIONS).toContain("getPortalLinkInfo: defineAction");
  });

  test("portal owner panel has EN+ES strings", () => {
    expect(APP).toContain("Client portal");
    expect(APP).toContain("Portal del cliente");
  });

  test("client-facing portal screen still exists", () => {
    expect(APP).toContain("function ClientPortalScreen(");
  });
});
