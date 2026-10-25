// Boot splash (Danny approved 2026-10-24; mockup:
// brand-assets/loading-screen-mockup.png). Rendered by main.tsx next to
// <App /> so it is in the very first paint and never remounts across the
// app's internal auth/app tree swaps. It covers the boot window — session
// restore (AuthScreen) plus the signed-in app's initial settings load
// (CrewkatApplication) — then fades out over the destination surface.
//
// Ready signaling is a one-way module latch: App-side boot milestones call
// signalBootReady() exactly when their surface becomes the destination.
// The latch never resets, so the splash can never reappear mid-session
// (sign-out, session invalidation, impersonation).
//
// Failsafe: if no milestone ever fires (a load hangs, an unforeseen gate
// path), the splash force-dismisses itself after SPLASH_MAX_MS — it must
// never trap the user on a loading screen.
//
// Public link surfaces (client document/portal links, /tools calculators,
// booking links) are NOT app boot: App renders PublicEntry for them and
// nothing there signals ready. The splash therefore never arms on those
// URLs — the check below mirrors App's public-entry detection.
import { useEffect, useState, useSyncExternalStore } from "react";
import splashLogo from "./assets/crewkat-c-chevron.png";
import splashCat from "./assets/mascot-peek.webp";

export const SPLASH_MAX_MS = 6000;
const SPLASH_FADE_MS = 480;

let bootReady = false;
const bootListeners = new Set<() => void>();

export function signalBootReady(): void {
  if (bootReady) return;
  bootReady = true;
  bootListeners.forEach((listener) => listener());
}

function subscribeBootReady(listener: () => void): () => void {
  bootListeners.add(listener);
  return () => {
    bootListeners.delete(listener);
  };
}

function bootReadySnapshot(): boolean {
  return bootReady;
}

// Mirrors the public-entry branches at the top of App(): hash "doc" /
// "portal" tokens, /tools calculator pages, and ?booking links.
export function isPublicEntryLocation(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("doc") || hash.get("portal")) return true;
    if (window.location.pathname.startsWith("/tools")) return true;
    if (new URLSearchParams(window.location.search).has("booking")) return true;
  } catch {
    // Unparseable URL: treat as app boot (the failsafe still applies).
    return false;
  }
  return false;
}

export function BootSplash() {
  const [armed] = useState(() => !isPublicEntryLocation());
  const ready = useSyncExternalStore(subscribeBootReady, bootReadySnapshot, bootReadySnapshot);
  const [failsafeDone, setFailsafeDone] = useState(false);
  const [gone, setGone] = useState(false);
  const done = ready || failsafeDone;

  // Failsafe: auto-dismiss after ~6s regardless of the ready signal.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setFailsafeDone(true), SPLASH_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  // Once done (ready or failsafe), run the fade, then unmount.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setGone(true), SPLASH_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [done]);

  if (!armed || gone) return null;
  return (
    <div className={`boot-splash${done ? " leaving" : ""}`} role="status" aria-label="Loading Crewkat">
      <div className="boot-splash-haze" aria-hidden="true" />
      <div className="boot-splash-haze is-b" aria-hidden="true" />
      <div className="boot-splash-center">
        <img className="boot-splash-logo" src={splashLogo} alt="" aria-hidden="true" />
        <div className="boot-splash-spinner" aria-hidden="true" />
        <p className="boot-splash-word">CREWKAT</p>
      </div>
      <img className="boot-splash-cat" src={splashCat} alt="" aria-hidden="true" />
    </div>
  );
}
