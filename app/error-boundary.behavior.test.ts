// Error boundary (2026-10-16, contract white-screen fix).
//
// Production had NO error boundary anywhere: main.tsx rendered <App /> bare
// inside StrictMode + QueryClientProvider, so any uncaught render/effect
// error unmounted the whole React root — a blank white page with the app
// chrome gone (first reported opening an uploaded-PDF contract).
//
// Fix pinned here:
//  - NEW client/src/ErrorBoundary.tsx with two class boundaries:
//    ScreenErrorBoundary (wraps the signed-in app's screen render; fallback
//    is a styled panel, EN/ES, whose recovery button clears the error state
//    and returns the user Home) and RootErrorBoundary (wraps <App /> in
//    main.tsx as the last resort; recovery reloads the app).
//  - The fallback headline stays generic; the caught error rides behind a
//    collapsed "Technical details" disclosure (2026-10-17 reversal — a
//    phone-only crash must be screenshot-able with its real cause).
//  - A resetKey change (navigation while the fallback is up) clears the
//    error so the user is never stranded on the fallback.
//
// Run from app/:  bun error-boundary.behavior.test.ts
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { RootErrorBoundary, ScreenErrorBoundary } from "./client/src/ErrorBoundary.tsx";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- Static pins: wiring -------------------------------------------------------
const mainSrc = await readFile("client/src/main.tsx", "utf8");
const appSrc = await readFile("client/src/App.tsx", "utf8");
const boundarySrc = await readFile("client/src/ErrorBoundary.tsx", "utf8");
const themeCss = await readFile("client/src/theme.css", "utf8");

check("main.tsx imports the root boundary",
  mainSrc.includes('import { RootErrorBoundary } from "./ErrorBoundary";'));
check("main.tsx wraps <App /> in the root boundary",
  mainSrc.includes("<RootErrorBoundary>") && mainSrc.includes("</RootErrorBoundary>")
  && mainSrc.indexOf("<RootErrorBoundary>") < mainSrc.indexOf("<App />"));
check("App.tsx imports the screen boundary",
  appSrc.includes('import { ScreenErrorBoundary } from "./ErrorBoundary";'));
check("the signed-in shell wraps its screens in the screen boundary",
  appSrc.includes("<ScreenErrorBoundary") && appSrc.includes("</ScreenErrorBoundary>"));
check("screen boundary recovery navigates Home via openRoot",
  appSrc.includes('onHome={() => openRoot("today")}'));
check("screen boundary resets when the active screen changes",
  appSrc.includes("resetKey={JSON.stringify(screen)}"));
check("both boundaries derive state from the caught error",
  (boundarySrc.match(/static getDerivedStateFromError/g) ?? []).length === 2);
check("fallback copy is bilingual and generic, error detail behind a disclosure",
  boundarySrc.includes("Something went wrong") && boundarySrc.includes("Algo salió mal")
  && boundarySrc.includes("Back to home") && boundarySrc.includes("Volver al inicio")
  && boundarySrc.includes("Reload the app") && boundarySrc.includes("Recargar la app")
  && boundarySrc.includes("Technical details") && boundarySrc.includes("Detalles técnicos")
  && boundarySrc.includes('className="error-boundary-details"') && boundarySrc.includes("componentStack"));
check("fallback is styled on-design (panel classes exist in theme.css)",
  themeCss.includes(".error-boundary-panel") && themeCss.includes(".error-boundary-page")
  && boundarySrc.includes('className="primary-button"'));

// --- Behavior: fallback renders + recovers --------------------------------------
// Walk a React element tree collecting rendered text and button elements.
function collect(node: unknown, texts: string[], buttons: Array<{ props: Record<string, unknown> }>) {
  if (typeof node === "string") { texts.push(node); return; }
  if (Array.isArray(node)) { node.forEach((n) => collect(n, texts, buttons)); return; }
  if (node && typeof node === "object") {
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (el.type === "button") buttons.push({ props: el.props ?? {} });
    if (el.props) collect(el.props.children, texts, buttons);
  }
}
function renderFallback(boundary: ScreenErrorBoundary | RootErrorBoundary) {
  const tree = boundary.render() as { type: (props: never) => unknown; props: Record<string, unknown> };
  // The render returns the shared fallback component; invoke it to inspect
  // the panel it produces.
  const panel = tree.type(tree.props as never);
  const texts: string[] = [];
  const buttons: Array<{ props: Record<string, unknown> }> = [];
  collect(panel, texts, buttons);
  return { actionLabel: tree.props.actionLabel as string, texts, buttons };
}

let homeCalls = 0;
const child = createElement("div", null, "screen body");
const boundary = new ScreenErrorBoundary({
  lang: "en",
  onHome: () => { homeCalls++; },
  resetKey: "today",
  children: child,
});
check("healthy boundary renders its children untouched", boundary.render() === child);
check("a caught error flips the boundary into fallback state",
  ScreenErrorBoundary.getDerivedStateFromError().hasError === true);

// Simulate React applying the derived state, then render the fallback.
(boundary as unknown as { state: { hasError: boolean } }).state = { hasError: true };
const en = renderFallback(boundary);
check("fallback shows the generic EN title, not the error", en.texts.some((t) => t.includes("Something went wrong")));
check("fallback action is the EN home recovery", en.actionLabel === "Back to home" && en.buttons.length === 1);

// Recovery: the button clears the error state and navigates Home.
(boundary as unknown as { setState: (s: { hasError: boolean }) => void }).setState = (s) => {
  (boundary as unknown as { state: { hasError: boolean } }).state = { hasError: s.hasError };
};
(en.buttons[0]!.props.onClick as () => void)();
check("recovery clears the error state", (boundary as unknown as { state: { hasError: boolean } }).state.hasError === false);
check("recovery returns the user Home", homeCalls === 1);
check("after recovery the boundary renders the screen again", boundary.render() === child);

// Spanish fallback.
const boundaryEs = new ScreenErrorBoundary({ lang: "es", onHome: () => {}, resetKey: "today", children: child });
(boundaryEs as unknown as { state: { hasError: boolean } }).state = { hasError: true };
const es = renderFallback(boundaryEs);
check("fallback shows the ES title", es.texts.some((t) => t.includes("Algo salió mal")));
check("fallback action is the ES home recovery", es.actionLabel === "Volver al inicio");

// resetKey: navigating while the fallback is up clears it.
const stranded = new ScreenErrorBoundary({ lang: "en", onHome: () => {}, resetKey: "document", children: child });
(stranded as unknown as { setState: (s: { hasError: boolean }) => void }).setState = (s) => {
  (stranded as unknown as { state: { hasError: boolean } }).state = { hasError: s.hasError };
};
(stranded as unknown as { state: { hasError: boolean } }).state = { hasError: true };
const prevProps = { ...(stranded as unknown as { props: object }).props } as never;
(stranded as unknown as { props: { resetKey: string } }).props = { ...(stranded as unknown as { props: object }).props, resetKey: "today" } as never;
stranded.componentDidUpdate(prevProps);
check("a resetKey change clears a stranded fallback", (stranded as unknown as { state: { hasError: boolean } }).state.hasError === false);

// Root boundary: same fallback shape, reload action.
const root = new RootErrorBoundary({ children: child });
check("root boundary renders children while healthy", root.render() === child);
check("root boundary derives fallback state from an error", RootErrorBoundary.getDerivedStateFromError().hasError === true);
(root as unknown as { state: { hasError: boolean } }).state = { hasError: true, lang: "en" };
const rootFallback = renderFallback(root);
check("root fallback offers the reload recovery", rootFallback.actionLabel === "Reload the app");

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll error-boundary checks passed.");
