declare module "*.css";
declare module "*.webp";
declare module "*.png";

// Google Identity Services (https://accounts.google.com/gsi/client),
// loaded dynamically by the Google sign-in button. We use the rendered
// button in redirect mode (full-page account chooser, ID token POSTed to
// our /auth/google/callback) — the One Tap/popup flow is blocked by
// third-party sign-in restrictions in a growing set of browsers.
interface GoogleCredentialResponse { credential: string; select_by?: string; }
interface GooglePromptMomentNotification {
  isNotDisplayed(): boolean;
  isSkippedMoment(): boolean;
  getNotDisplayedReason(): string;
  getSkippedReason(): string;
}
interface GoogleAccountsId {
  initialize(opts: {
    client_id: string;
    callback?: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    ux_mode?: "popup" | "redirect";
    login_uri?: string;
    context?: "signin" | "signup" | "use";
  }): void;
  renderButton(parent: HTMLElement, opts: {
    theme?: "outline" | "filled_blue" | "filled_black";
    size?: "large" | "medium" | "small";
    text?: "signin_with" | "signup_with" | "continue_with" | "signin";
    shape?: "rectangular" | "pill" | "circle" | "square";
    logo_alignment?: "left" | "center";
    width?: number;
    locale?: string;
  }): void;
  prompt(cb?: (notification: GooglePromptMomentNotification) => void): void;
  cancel(): void;
}
interface Window { google?: { accounts: { id: GoogleAccountsId } }; }

// Tesseract.js OCR (receipt scanning), loaded on demand from the static
// /app/ocr/tesseract.min.js by client/src/receiptOcr.ts — never bundled.
// Only the slice of the API the receipt flow uses is typed here.
interface TesseractWorker {
  recognize(image: Blob): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}
interface TesseractStatic {
  createWorker(
    langs: string,
    oem: string,
    options: {
      workerPath: string;
      corePath: string;
      langPath: string;
      cacheMethod?: string;
    },
  ): Promise<TesseractWorker>;
}
interface Window { Tesseract?: TesseractStatic; }
