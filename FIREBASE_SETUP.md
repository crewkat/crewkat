# Crewkat Web Push setup (Firebase Console)

Crewkat uses **plain VAPID Web Push** — no FCM server keys, no FCM API calls
from our server. Firebase is only needed as a *convenient way to generate a
VAPID key pair* (any VAPID pair works; Firebase Console's Cloud Messaging
settings page happens to mint one for the project). Nothing else in Firebase
is used: no FCM topics, no firebase-messaging SDK, no google-services files.

Do these five steps once, in the Firebase Console, as the project owner:

## 1. Create (or open) the Crewkat Firebase project
- Go to https://console.firebase.google.com → **Add project**
- Name it `Crewkat` (or reuse the existing project if one was already made).
- Google Analytics is optional — either choice works for push.

## 2. Register the web app
- In Project Overview, click the **Web** (`</>`) icon → **Register app**.
- Nickname: `Crewkat web`.
- Firebase Hosting setup: **not needed** (skip / decline).

## 3. Copy the VAPID key pair
- Go to **Project settings → Cloud Messaging → Web Push certificates**.
- Under **Web configuration**, click **Generate key pair** (or reveal the
  existing one).
- Copy the **public key** and the **private key**. Keep the private key
  secret — it signs every push we send.

## 4. Add the keys to Render environment variables
- Render dashboard → `crewkat` service → **Environment**.
- Add:
  - `VAPID_PUBLIC_KEY` = the public key from step 3
  - `VAPID_PRIVATE_KEY` = the private key from step 3
  - `VAPID_SUBJECT` = `mailto:crewkat.app@gmail.com`
- Save. (Render redeploys with the new env.)

## 5. Verify on a real device
- Open https://crewkat.com/app on the phone, sign in.
- Go to **Settings → More options → Notifications → Push notifications**,
  turn the switch on, and accept the browser permission prompt.
- Trigger a test: have another account message one of your Marketplace
  listings (or view your portal link). The push should arrive even with the
  browser closed.

## Notes
- The client calls the server's `getVapidPublicKey()` action; if it returns
  `null` (keys not configured), the app silently skips push — nothing breaks.
- Subscriptions live in the `push_subscriptions` table. Endpoints that return
  HTTP 404/410 are deleted automatically.
- Push triggers: portal viewed (throttled to 1/hour per link), invoice paid,
  new marketplace inquiry/reply, marketplace alert match. All are best-effort:
  if push fails, the in-app notification (and email for alerts) still works.
- Android (TWA/Play build): push works the same via the installed PWA.
  iOS: web push works on iOS 16.4+ only when the app is added to the Home
  Screen; plain Safari tabs cannot receive pushes (Apple limitation).
