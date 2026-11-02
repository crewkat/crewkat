// Marketing Phase 1 feature pages (Danny 2026-10-18): Invoice Fly-style SEO
// pages served as static HTML from app/client/marketing/ via explicit routes
// in server.mjs (unknown paths fall back to the homepage, so the routes are
// load-bearing). Pins: routes exist, each page has a distinct title/H1/meta/
// canonical, real prices on /pricing, FAQPage JSON-LD matches the visible FAQ,
// sitemap lists everything, shared chrome interlinks all pages.
// Run from app/:  bun test marketing-pages.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MKT = join(import.meta.dir, "client", "marketing");
const SERVER = readFileSync(join(import.meta.dir, "..", "server.mjs"), "utf8");
const CSS = readFileSync(join(MKT, "styles.css"), "utf8");
const SITEMAP = readFileSync(join(MKT, "sitemap.xml"), "utf8");
const HOME = readFileSync(join(MKT, "index.html"), "utf8");

const PAGES: Record<string, { title: string; h1: string }> = {
  pricing: {
    title: "Contractor App Pricing — Free, $19/mo Premium | Crewkat",
    h1: "Pricing a small crew can actually justify.",
  },
  invoicing: {
    title: "Invoice Software for Contractors | Crewkat",
    h1: "Invoice software built for contractors in the field.",
  },
  estimates: {
    title: "Estimate &amp; Quote Software for Contractors | Crewkat",
    h1: "Estimates your clients can approve line by line.",
  },
  contracts: {
    title: "Contract e-Signatures for Contractors | Crewkat",
    h1: "Contracts signed from a link — no printing, no scanning.",
  },
  jobs: {
    title: "Job Management Software for Contractors | Crewkat",
    h1: "Every job, organized in one place.",
  },
  clients: {
    title: "Client Portal for Contractors | Crewkat",
    h1: "One link for everything your client needs.",
  },
  marketplace: {
    title: "Contractor Marketplace — Find Work &amp; Hire Pros | Crewkat",
    h1: "Find work. Get found. Free.",
  },
};
const SLUGS = Object.keys(PAGES);
const html = (slug: string) => readFileSync(join(MKT, `${slug}.html`), "utf8");

function wordCount(page: string): number {
  const text = page
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.split(" ").length;
}

describe("server.mjs routes the phase-1 pages", () => {
  test("explicit route pattern covers all 7 slugs and serves <slug>.html", () => {
    for (const slug of SLUGS) expect(SERVER).toContain(slug);
    expect(SERVER).toMatch(/\(pricing\|invoicing\|estimates\|contracts\|jobs\|clients\|marketplace\)/);
    expect(SERVER).toContain("`${marketingPage[1]}.html`");
  });
});

describe("each page is a real, distinct, crawlable document", () => {
  for (const slug of SLUGS) {
    test(`/${slug}: title, single H1, meta, canonical, OG`, () => {
      const page = html(slug);
      expect(page).toContain(`<title>${PAGES[slug].title}</title>`);
      expect(page.match(/<h1[\s>]/g)?.length).toBe(1);
      expect(page).toContain(`<h1>${PAGES[slug].h1}</h1>`);
      const desc = /<meta name="description" content="([^"]+)"/.exec(page)?.[1] ?? "";
      expect(desc.length).toBeGreaterThanOrEqual(80);
      expect(desc.length).toBeLessThanOrEqual(170);
      expect(page).toContain(`<link rel="canonical" href="https://crewkat.com/${slug}">`);
      expect(page).toContain('property="og:title"');
      expect(page).toContain('property="og:image" content="https://crewkat.com/marketing/og-image.jpg"');
      expect(page).toContain('href="/marketing/styles.css"');
    });

    test(`/${slug}: substantial copy and shared chrome interlinks everything`, () => {
      const page = html(slug);
      expect(wordCount(page)).toBeGreaterThanOrEqual(520);
      for (const other of SLUGS) expect(page).toContain(`href="/${other}"`);
      expect(page).toContain('href="/privacy"');
      expect(page).toContain('href="/tools"');
      expect(page).toContain('href="/app"');
      expect(page).toContain("Start free");
    });

    test(`/${slug}: no unbuilt-feature or store claims`, () => {
      const page = html(slug);
      expect(page).not.toContain("AI receptionist");
      expect(page).not.toContain("Google Play");
      expect(page).not.toContain("App Store");
      expect(page).not.toContain("accept card payments");
      expect(page).not.toContain("Pay now");
    });
  }

  test("all 7 titles are distinct", () => {
    const titles = SLUGS.map((s) => PAGES[s].title);
    expect(new Set(titles).size).toBe(7);
  });
});

describe("pricing page: real prices + schema that matches the page", () => {
  const page = html("pricing");

  test("shows the three real prices and the free-tier document limit", () => {
    expect(page).toContain("<strong>$0</strong>");
    expect(page).toContain("<strong>$19</strong>");
    expect(page).toContain("<strong>$149</strong>");
    expect(page).toContain("3 documents a month");
    expect(page).toContain("first 100");
    expect(page).toContain("compare-table");
  });

  test("SoftwareApplication JSON-LD parses with the 3 real offers", () => {
    const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
    expect(app).toBeTruthy();
    const prices = app.offers.map((o: any) => `${o.name}:${o.price}`);
    expect(prices).toEqual(["Free:0", "Premium:19", "Founding Member:149"]);
  });

  test("FAQPage JSON-LD matches the visible FAQ exactly", () => {
    const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(faq).toBeTruthy();
    const visibleQ = [...page.matchAll(/data-faq-button>([^<]+)<span/g)].map((m) => m[1].trim());
    const visibleA = [...page.matchAll(/faq-answer" id="faq-\d+" hidden><p>([^<]+)<\/p>/g)].map((m) => m[1].trim());
    expect(faq.mainEntity.map((q: any) => q.name)).toEqual(visibleQ);
    expect(faq.mainEntity.map((q: any) => q.acceptedAnswer.text)).toEqual(visibleA);
    expect(visibleQ.length).toBeGreaterThanOrEqual(5);
  });
});

describe("sitemap + homepage chrome", () => {
  test("sitemap lists all 7 new pages plus existing entries", () => {
    for (const slug of SLUGS) expect(SITEMAP).toContain(`<loc>https://crewkat.com/${slug}</loc>`);
    expect(SITEMAP).toContain("<loc>https://crewkat.com/</loc>");
    expect(SITEMAP).toContain("<loc>https://crewkat.com/tools</loc>");
    expect(SITEMAP).toContain("<loc>https://crewkat.com/privacy</loc>");
  });

  test("homepage nav and footer use the shared chrome", () => {
    for (const slug of SLUGS) expect(HOME).toContain(`href="/${slug}"`);
    expect(HOME).toContain('href="/tools"');
    expect(HOME).not.toContain('href="#features"');
    expect(HOME).not.toContain('href="#pricing"');
  });

  test("phase-1 component styles exist", () => {
    for (const cls of [".page-hero", ".check-list", ".step-card", ".compare-table", ".related-card", ".faq-lite", ".pricing-grid-3"]) {
      expect(CSS).toContain(cls);
    }
  });
});

describe("brand mascot placements (2026-10-25)", () => {
  test("homepage hero carries the phone cat beside the app phone mock", () => {
    const img = /<img class="hero-mascot"[^>]*>/.exec(HOME)?.[0] ?? "";
    expect(img).toContain('src="/marketing/mascot-phone.webp"');
    expect(img).toContain('alt="Crewkat cat mascot');
    // Anchored inside the phone stage, after the phone itself.
    const stage = HOME.indexOf('class="phone-stage"');
    const phone = HOME.indexOf('class="phone"', stage);
    const cat = HOME.indexOf('class="hero-mascot"', stage);
    expect(stage).toBeGreaterThan(-1);
    expect(phone).toBeGreaterThan(stage);
    expect(cat).toBeGreaterThan(phone);
    expect(existsSync(join(MKT, "mascot-phone.webp"))).toBe(true);
    expect(CSS).toContain(".hero-mascot");
  });

  test("estimates page carries the clipboard cat in the what-it-does section", () => {
    const page = html("estimates");
    const img = /<img class="mascot-float"[^>]*>/.exec(page)?.[0] ?? "";
    expect(img).toContain('src="/marketing/mascot-clipboard.webp"');
    expect(img).toContain('alt="Crewkat cat mascot holding a clipboard');
    expect(img).toContain('loading="lazy"');
    expect(existsSync(join(MKT, "mascot-clipboard.webp"))).toBe(true);
    expect(CSS).toContain(".mascot-float");
  });

  test("no other marketing page carries a mascot image", () => {
    for (const slug of SLUGS) {
      if (slug === "estimates") continue;
      expect(html(slug)).not.toContain("mascot");
    }
    expect(HOME).not.toContain("mascot-premium");
    expect(HOME).not.toContain("mascot-ipad");
  });
});

describe("office marketing page (2026-11-01)", () => {
  const OFFICE = readFileSync(join(MKT, "office.html"), "utf8");
  const PRICING = html("pricing");

  test("route: /office-tour serves office.html; /office stays the desktop app", () => {
    expect(SERVER).toContain('urlPath === "/office-tour"');
    expect(SERVER).toContain('join(MARKETING_DIST, "office.html")');
    // The desktop CRM keeps /office (OFFICE_DIST) — the showcase route is an
    // exact match on /office-tour only, matched before the app block, and
    // "office" must never join the marketing slug alternation (which runs
    // earlier and would shadow the app at its root).
    expect(SERVER).toContain('urlPath === "/office" || urlPath.startsWith("/office/")');
    expect(SERVER.indexOf('"/office-tour"')).toBeLessThan(SERVER.indexOf('urlPath === "/office"'));
    expect(SERVER).not.toMatch(/\(pricing\|invoicing\|estimates\|contracts\|jobs\|clients\|marketplace\|office\)/);
  });

  test("/office-tour: title, single H1, meta, canonical, OG", () => {
    expect(OFFICE).toContain("<title>Contractor Office Software &amp; CRM for Contractors | Crewkat</title>");
    expect(OFFICE.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(OFFICE).toContain("<h1>Your whole business, on the big screen.</h1>");
    const desc = /<meta name="description" content="([^"]+)"/.exec(OFFICE)?.[1] ?? "";
    expect(desc.length).toBeGreaterThanOrEqual(80);
    expect(desc.length).toBeLessThanOrEqual(170);
    expect(OFFICE).toContain('<link rel="canonical" href="https://crewkat.com/office-tour">');
    expect(OFFICE).toContain('property="og:title"');
    expect(OFFICE).toContain('property="og:image" content="https://crewkat.com/marketing/og-image.jpg"');
    expect(OFFICE).toContain('href="/marketing/styles.css"');
  });

  test("/office-tour: substantial copy, approved wording, shared chrome", () => {
    expect(wordCount(OFFICE)).toBeGreaterThanOrEqual(520);
    for (const slug of SLUGS) expect(OFFICE).toContain(`href="/${slug}"`);
    expect(OFFICE).toContain('href="/office-tour"');
    expect(OFFICE).toContain('href="/privacy"');
    expect(OFFICE).toContain('href="/tools"');
    expect(OFFICE).toContain('href="/app"');
    expect(OFFICE).toContain("Start free");
    // Approved copy anchors (office-webpage-home-promo-copy-2026-11-01.md §3).
    expect(OFFICE).toContain("Crewkat on your phone runs the job.");
    expect(OFFICE).toContain("For whoever runs the office");
    expect(OFFICE).toContain("One business, two screens");
    expect(OFFICE).toContain("Less admin. More building — now with a bigger screen.");
    for (const h of ["Pipeline", "Production Board", "Money dashboard", "Follow-ups that don't slip", "Promotions", "Proposals that report back", "QuickBooks sync", "Get paid from the invoice", "Your crew, their logins"]) {
      expect(OFFICE).toContain(`<h3>${h}</h3>`);
    }
    for (const stage of ["Scheduled", "In Progress", "Punch List", "Complete", "Paid in Full"]) {
      expect(OFFICE).toContain(stage);
    }
    // Pay Now shipped 2026-11-01 and is sold here as the Pro feature it is —
    // but the phase-1 claim guards still hold verbatim on this page too.
    expect(OFFICE).toContain("(Pro feature, connects through Stripe.)");
    expect(OFFICE).not.toContain("AI receptionist");
    expect(OFFICE).not.toContain("Google Play");
    expect(OFFICE).not.toContain("App Store");
  });

  test("founding-rate treatment is identical on the office page, home, and /pricing", () => {
    for (const page of [OFFICE, HOME, PRICING]) {
      expect(page).toContain("Crewkat Office");
      expect(page).toContain("<strong>$39</strong>");
      expect(page).toContain("first 100 companies (regular $49/mo)");
      expect(page).toContain("Free while the founding period lasts — no card to start.");
      expect(page).toContain("Everything in Premium");
      expect(page).toContain("Admin + 5 team logins included");
      expect(page).toContain("Promotions, QuickBooks sync, and review tools");
    }
  });

  test("home promo section sits between the feature grid and Pricing, CTA to the office page", () => {
    const promo = HOME.indexOf("The office side of Crewkat, on a real screen.");
    expect(promo).toBeGreaterThan(HOME.indexOf('id="features"'));
    expect(promo).toBeLessThan(HOME.indexOf('id="pricing"'));
    expect(HOME).toContain("New — Crewkat Office");
    expect(HOME).toContain('href="/office-tour">See Crewkat Office');
    for (const point of [
      "Every lead in one board, from first call to signed job",
      "what's still owed — by month or by week",
      "with the stuck ones flagged before they cost you",
      "Email past clients and old estimates in a couple of clicks",
    ]) {
      expect(HOME).toContain(point);
    }
  });

  test("every marketing page's chrome links to the office page", () => {
    for (const slug of SLUGS) expect(html(slug)).toContain('href="/office-tour"');
    expect(HOME).toContain('href="/office-tour"');
    const privacy = readFileSync(join(MKT, "privacy.html"), "utf8");
    expect(privacy).toContain('href="/office-tour"');
    const paperwork = readFileSync(join(MKT, "paperwork.html"), "utf8");
    expect(paperwork).toContain('href="/office-tour"');
  });

  test("sitemap lists the office page", () => {
    expect(SITEMAP).toContain("<loc>https://crewkat.com/office-tour</loc>");
  });

  test("office visuals: CSS panels + clipboard cat in the hero stage", () => {
    expect(OFFICE).toContain('class="office-window"');
    expect(OFFICE).toContain("Collected this year");
    expect(OFFICE).toContain('class="board"');
    const img = /<img class="office-mascot"[^>]*>/.exec(OFFICE)?.[0] ?? "";
    expect(img).toContain('src="/marketing/mascot-clipboard.webp"');
    expect(img).toContain('alt="Crewkat cat mascot');
    const stage = OFFICE.indexOf('class="office-stage"');
    const cat = OFFICE.indexOf('class="office-mascot"', stage);
    expect(stage).toBeGreaterThan(-1);
    expect(cat).toBeGreaterThan(stage);
    for (const cls of [".office-window", ".office-features", ".board-col", ".office-promo-panel", ".office-point", ".price-card-office", ".office-mascot"]) {
      expect(CSS).toContain(cls);
    }
  });
});
