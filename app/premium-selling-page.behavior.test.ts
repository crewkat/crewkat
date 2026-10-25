// Premium selling-page tests (2026-10-14).
//
// Danny's field report: on the Crewkat Premium screen the "PREMIUM" eyebrow
// was nearly invisible on the dark hero, and the usage pill ("You're using
// 1 of 3 jobs…") rendered washed-out pale on white. Root causes pinned here:
//  (1) .premium-plan-mark used background: var(--orange), but --orange is
//      defined nowhere — the declaration is invalid at computed-value time,
//      so the chip background fell back to transparent and the near-black
//      #1d1710 text sat directly on the dark #17211d hero.
//  (2) The usage line is a <p> inside .upgrade-hero; theme.css
//      ".upgrade-hero p { color:#dce6e0 }" (specificity 0-1-1) beat app.css
//      ".usage-line { color: var(--dim) }" (0-1-0), painting near-white text
//      on the pill's white var(--surface) background.
// Fix: eyebrow chip uses var(--accent); a dedicated
// ".upgrade-hero .usage-line" rule (0-2-0) restores full-strength text.
//
// The rest pins the selling-page rebuild: per-day price framing, three
// outcome cards, a Free-vs-Premium comparison, the founder proof band, a
// 3-item FAQ, and the sticky bottom upgrade bar — presentation only, prices
// and the Stripe/Play checkout wiring untouched.
//
// Run from app/:  bun premium-selling-page.behavior.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const appTsx = await readFile(join("client", "src", "App.tsx"), "utf8");
const css = await readFile(join("client", "src", "theme.css"), "utf8");

// Slice out UpgradeScreen so checks can't be satisfied by unrelated code.
const fnStart = appTsx.indexOf("function UpgradeScreen");
check("UpgradeScreen exists", fnStart >= 0);
const fnEnd = appTsx.indexOf("function JobsScreen", fnStart);
const screen = appTsx.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 30000);

// CSS rule extractor (same anchored pattern as the sheet-scroll suite).
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  return m?.[1] ?? "";
};

// --- Contrast fix 1: the PREMIUM eyebrow chip ------------------------------
const markRule = rule(".premium-plan-mark");
check("eyebrow chip paints the accent background", markRule.includes("background:var(--accent)"), markRule.trim());
check("eyebrow chip no longer references the undefined --orange var", !markRule.includes("--orange"), markRule.trim());
check("eyebrow still renders in the hero", screen.includes('className="premium-plan-mark"'));

// --- Contrast fix 2: the usage pill -----------------------------------------
const usageRule = rule(".upgrade-hero .usage-line");
check("usage line has a hero-scoped override rule", usageRule.length > 0);
check("usage line text is full-strength", usageRule.includes("color:var(--text)"), usageRule.trim());
check("usage pill still rendered from usage data", screen.includes('className="usage-line"') && screen.includes("usageQuery.data.activeJobs"));

// --- Hero + plan cards kept, framing added ----------------------------------
check("hero headline kept", screen.includes("The whole operation. Less busywork."));
check("monthly per-day framing (en)", screen.includes("About 63¢ a day"));
check("monthly per-day framing (es)", screen.includes("Unos 63¢ al día"));
check("annual per-day framing (en)", screen.includes("About 52¢ a day"));
check("annual per-day framing (es)", screen.includes("Unos 52¢ al día"));
check("annual framing hangs off the $15.75/mo line", screen.includes('"$15.75/mo billed yearly"') && screen.includes("plan-option-perday"));
check("prices unchanged", screen.includes("<strong>$19</strong>") && screen.includes("$189"));
check("cancel anytime kept on plan cards", (screen.match(/Cancel anytime/g) ?? []).length >= 2);

// --- Outcome cards ------------------------------------------------------------
check("outcome cards render", screen.includes('className="upgrade-outcomes"') && screen.includes('className="outcome-card"'));
check("outcome cards reuse the app tool icon chip", screen.includes('className="tool-tile-icon"'));
check("outcome card: Get the work (en)", screen.includes('"Get the work"'));
check("outcome card: Run every job (en)", screen.includes('"Run every job"'));
check("outcome card: Get paid without the chase (en)", screen.includes('"Get paid without the chase"'));
check("outcome cards localized (es)", screen.includes('"Consigue el trabajo"') && screen.includes('"Lleva cada trabajo"') && screen.includes('"Cobra sin perseguir"'));
check("old flat checkmark wall removed", !appTsx.includes('className="upgrade-features"') && !css.includes(".upgrade-features"));

// --- Free vs Premium comparison ----------------------------------------------
check("comparison renders", screen.includes('className="upgrade-compare"') && screen.includes('className="upgrade-compare-row"'));
check("comparison title (en)", screen.includes('"Free vs Premium"') || screen.includes("Free vs Premium"));
for (const label of ["Active jobs", "Invoices per month", "Marketplace listings", "Pro tools"]) {
  check(`comparison row: ${label}`, screen.includes(`label: "${label}"`));
}
check("comparison keeps free limits truthful", screen.includes('free: "3"') && screen.includes('free: "5"') && screen.includes('free: "Locked"'));

// --- Founder proof band ---------------------------------------------------------
check("founder band renders with the brand mark", screen.includes('className="founder-band"') && screen.includes("crewkatLogo"));
check("founder band carries the true line (en)", screen.includes("Built by a working Florida GC who runs his own jobs on Crewkat every day."));
check("founder band localized (es)", screen.includes("Creado por un contratista general de Florida que trabaja sus propios trabajos en Crewkat todos los días."));

// --- FAQ ------------------------------------------------------------------------
check("faq renders", screen.includes('className="upgrade-faq"'));
check("faq: cancel keeps data (en)", screen.includes("What happens to my jobs and invoices if I cancel?") && screen.includes("Nothing is deleted."));
check("faq: plan switching (en)", screen.includes("Can I switch between monthly and annual?"));
check("faq: no contract (en)", screen.includes("Is there a contract?") && screen.includes("No contract, no lock-in."));
check("faq localized (es)", screen.includes("¿Hay contrato?") && screen.includes("¿Puedo cambiar entre mensual y anual?"));

// --- Sticky upgrade bar ---------------------------------------------------------
check("sticky bar renders behind the flag", screen.includes("showStickyBar") && screen.includes('className="upgrade-sticky-bar"'));
check("page reserves room for the bar", screen.includes('has-sticky-bar'));
const barRule = rule(".upgrade-sticky-bar");
check("sticky bar is fixed", barRule.includes("position:fixed"), barRule.trim());
check("sticky bar respects the safe area", barRule.includes("env(safe-area-inset-bottom)"), barRule.trim());
const pageBarRule = rule(".upgrade-page.has-sticky-bar");
check("page bottom padding grows when the bar shows", pageBarRule.includes("padding-bottom"), pageBarRule.trim());
check("sticky bar reuses the Stripe checkout (no new wiring)", screen.includes("onClick={() => void startCheckout()}") && screen.includes("api.startPremiumCheckout"));

// --- Premium mascot in the hero (2026-10-25) -----------------------------------
// The gold-trim premium cat tops the dark hero card, right of the badge +
// headline. Decorative layer: absolutely positioned, click-through, and
// hidden on very narrow screens instead of squeezing the copy.
import { existsSync } from "node:fs";
check("premium cat asset copied into client assets", existsSync(join("client", "src", "assets", "mascot-premium.webp")));
check("premium cat imported", appTsx.includes('import mascotPremium from "./assets/mascot-premium.webp";'));
const mascotImgAt = screen.indexOf('className="upgrade-hero-mascot"');
check("premium cat renders in the hero", mascotImgAt >= 0 && screen.includes("src={mascotPremium}"));
check("premium cat sits above the PREMIUM badge in the hero", mascotImgAt >= 0 && mascotImgAt < screen.indexOf('className="premium-plan-mark"'));
check("premium cat has localized alt text", screen.includes("Crewkat cat in gold-trim gear pointing up") && screen.includes("El gato de Crewkat con detalles dorados"));
const mascotRule = rule(".upgrade-hero-mascot");
check("premium cat is an absolute decorative layer", mascotRule.includes("position:absolute") && mascotRule.includes("pointer-events:none"), mascotRule.trim());
check("hero clips the cat layer", rule(".upgrade-hero").includes("overflow:hidden"));
check("premium cat yields on very narrow screens", css.includes("@media (max-width:379px)") && css.includes(".upgrade-hero-mascot { display:none; }"));

// --- No invented features --------------------------------------------------------
check("no card-payments claim (roadmap, not shipped)", !screen.includes("Pay now") && !screen.includes("Accept card payments"));

console.log(failures === 0 ? "\nALL PREMIUM SELLING-PAGE CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
