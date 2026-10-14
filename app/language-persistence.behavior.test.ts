// Behavior checks: the signed-in app's language choice must survive closing
// and reopening (Danny's field report 2026-10-14: set ES, reopen, back to EN).
// Static wiring checks run against the client source.
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures += 1;
};
const src = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");

check("lang boots from the on-device crewkat-lang mirror",
  src.includes('window.localStorage.getItem("crewkat-lang")'));
check("applyLanguage writes the mirror on every choice",
  src.includes("const applyLanguage = (next: Lang)") && src.includes('window.localStorage.setItem("crewkat-lang", next)'));
check("session intent guards the settings sync from stomping the choice",
  src.includes("langIntentRef") && src.includes("langIntentRef.current !== settings.data.language) return;"));
check("a toggle tapped before settings load still gets its save landed",
  src.includes("langSaveAttemptedRef") && src.includes("language: intent"));
check("header toggles route through applyLanguage",
  (src.match(/toggleLanguage=\{\(\) => applyLanguage\(lang === "en" \? "es" : "en"\)\}/g) ?? []).length >= 2);

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
