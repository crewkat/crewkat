declare module "*.css";
declare module "*.webp";

// Google Identity Services (https://accounts.google.com/gsi/client),
// loaded dynamically by the Google sign-in button. Minimal surface: we only
// use the One-Tap/ID-token flow (initialize + prompt), never gapi.auth2.
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
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
  }): void;
  prompt(cb?: (notification: GooglePromptMomentNotification) => void): void;
  cancel(): void;
}
interface Window { google?: { accounts: { id: GoogleAccountsId } }; }
