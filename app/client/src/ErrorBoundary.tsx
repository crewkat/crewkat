// Error boundaries (2026-10-16, contract white-screen fix).
//
// Production had NO error boundary anywhere: main.tsx rendered <App /> bare,
// so any uncaught render/effect error unmounted the whole React root and the
// user got a blank white page (first seen opening an uploaded-PDF contract —
// see DocumentPdfPages). Two nets now:
//  - ScreenErrorBoundary wraps the signed-in app's screen render. A failing
//    screen is swapped for a styled fallback whose recovery button returns
//    the user Home and clears the failed screen state.
//  - RootErrorBoundary wraps <App /> in main.tsx as the last resort for
//    errors outside the signed-in shell (auth, public link screens); its
//    recovery is a full reload.
// The fallback never dumps raw error text — just a generic message, in the
// app's two languages.
import { Component, type ReactNode } from "react";

export type BoundaryLang = "en" | "es";

const STRINGS: Record<BoundaryLang, { title: string; body: string; home: string; reload: string }> = {
  en: {
    title: "Something went wrong",
    body: "This screen couldn't load. Your data is safe — head back home and try again.",
    home: "Back to home",
    reload: "Reload the app",
  },
  es: {
    title: "Algo salió mal",
    body: "Esta pantalla no pudo cargarse. Tus datos están a salvo — vuelve al inicio e inténtalo de nuevo.",
    home: "Volver al inicio",
    reload: "Recargar la app",
  },
};

function BoundaryFallback({ lang, actionLabel, onAction }: { lang: BoundaryLang; actionLabel: string; onAction: () => void }) {
  const t = STRINGS[lang];
  return (
    <section className="page error-boundary-page">
      <div className="error-boundary-panel" role="alert">
        <span className="error-boundary-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        <button type="button" className="primary-button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </section>
  );
}

type ScreenBoundaryProps = {
  lang: BoundaryLang;
  // Recovery navigation (returns the user Home). Called after the boundary
  // clears its own error state, so the failed screen unmounts clean.
  onHome: () => void;
  // When this changes while the fallback is showing (e.g. the bottom nav
  // navigated elsewhere), the boundary clears the error and renders the new
  // screen instead of stranding the user on the fallback.
  resetKey?: string;
  children: ReactNode;
};

export class ScreenErrorBoundary extends Component<ScreenBoundaryProps, { hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    // Keep the failure diagnosable in the console without ever showing raw
    // error text to the user.
    console.error("Screen render failed:", error);
  }

  override componentDidUpdate(prevProps: ScreenBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  recover = () => {
    this.setState({ hasError: false });
    this.props.onHome();
  };

  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <BoundaryFallback
        lang={this.props.lang}
        actionLabel={STRINGS[this.props.lang].home}
        onAction={this.recover}
      />
    );
  }
}

function detectLang(): BoundaryLang {
  try {
    const saved = window.localStorage.getItem("crewkat-lang");
    if (saved === "es" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== "undefined" && (navigator.language ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

export class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; lang: BoundaryLang }> {
  override state = { hasError: false, lang: detectLang() };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("App render failed:", error);
  }

  reload = () => {
    window.location.reload();
  };

  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <BoundaryFallback
        lang={this.state.lang}
        actionLabel={STRINGS[this.state.lang].reload}
        onAction={this.reload}
      />
    );
  }
}
