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
