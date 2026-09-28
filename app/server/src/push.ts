// Chunk D: Web Push (VAPID) plumbing, hand-rolled with node:crypto + fetch.
// No `web-push` dependency (offline installs are blocked), and keys are
// NEVER invented here — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
// are read from the environment at send time. When unset, sends are skipped
// silently (Danny does the Firebase console step himself).
import { createCipheriv, createECDH, createHmac, createPrivateKey, createSign, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

export interface PushMessage {
  titleEn: string;
  titleEs: string;
  bodyEn: string;
  bodyEs: string;
  /** Where the app should land when the notification is tapped (default "/app/"). */
  url?: string;
  /** Optional listing id carried in the payload for deep-linking. */
  listingId?: number;
}

function b64urlEncode(data: Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

interface VapidConfig {
  subject: string;
  privateJwk: { kty: string; crv: string; x: string; y: string; d: string };
  publicUncompressed: Buffer; // 65 bytes, 0x04 prefix
}

/** Reads and parses the VAPID env config. Returns null when not configured. */
export function getVapidConfig(): VapidConfig | null {
  const subject = (process.env.VAPID_SUBJECT ?? "").trim() || "mailto:support@crewkat.com";
  const rawPrivate = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const rawPublic = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  if (!rawPrivate || !rawPublic) return null;
  try {
    let d: Buffer;
    if (rawPrivate.startsWith("{")) {
      const jwk = JSON.parse(rawPrivate) as { d?: unknown };
      if (typeof jwk.d !== "string") return null;
      d = b64urlDecode(jwk.d);
    } else {
      d = b64urlDecode(rawPrivate);
    }
    if (d.length !== 32) return null;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(d);
    const publicUncompressed = ecdh.getPublicKey(); // 65 bytes
    if (publicUncompressed.length !== 65 || publicUncompressed[0] !== 0x04) return null;
    const x = publicUncompressed.subarray(1, 33);
    const y = publicUncompressed.subarray(33, 65);
    return {
      subject,
      privateJwk: { kty: "EC", crv: "P-256", x: b64urlEncode(x), y: b64urlEncode(y), d: b64urlEncode(d) },
      publicUncompressed,
    };
  } catch {
    return null;
  }
}

/** Public key returned to the client for PushManager.subscribe(). Null until configured. */
export function getVapidPublicKey(): string | null {
  const key = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  return key || null;
}

// RFC 5869 HKDF-Expand with SHA-256 (pure expand — the PRK is supplied).
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const n = Math.ceil(length / 32);
  let t = Buffer.alloc(0);
  let okm = Buffer.alloc(0);
  for (let i = 1; i <= n; i++) {
    t = createHmac("sha256", prk).update(Buffer.concat([t, info, Buffer.from([i])])).digest();
    okm = Buffer.concat([okm, t]);
  }
  return okm.subarray(0, length);
}

// RFC 8291 §3.4: aes128gcm content encoding for Web Push.
function encryptAes128Gcm(receiverPublicKey: Buffer, authSecret: Buffer, plaintext: Buffer): { salt: Buffer; serverPublicKey: Buffer; ciphertext: Buffer } {
  if (receiverPublicKey.length !== 65 || receiverPublicKey[0] !== 0x04) throw new Error("Invalid receiver public key.");
  if (authSecret.length !== 16) throw new Error("Invalid auth secret.");
  const server = createECDH("prime256v1");
  server.generateKeys();
  const serverPublicKey = server.getPublicKey();
  const sharedSecret = server.computeSecret(receiverPublicKey);
  // PRK = HKDF-Extract(auth_secret, ecdh_secret)
  const prk = createHmac("sha256", authSecret).update(sharedSecret).digest();
  const lenPrefixed = (key: Buffer) => Buffer.concat([Buffer.from([(key.length >> 8) & 0xff, key.length & 0xff]), key]);
  const context = Buffer.concat([Buffer.from("P-256\0", "utf8"), lenPrefixed(receiverPublicKey), lenPrefixed(serverPublicKey)]);
  const cekInfo = Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), context]);
  const nonceInfo = Buffer.concat([Buffer.from("Content-Encoding: nonce\0", "utf8"), context]);
  const cek = hkdfExpand(prk, cekInfo, 16);
  const nonce = hkdfExpand(prk, nonceInfo, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { salt: randomBytes(16), serverPublicKey, ciphertext };
}

function createVapidJwt(config: VapidConfig, endpoint: string): string {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"));
  const payload = b64urlEncode(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: config.subject,
  }), "utf8"));
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign("sha256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign({
    key: createPrivateKey({ key: config.privateJwk as unknown as Record<string, string>, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  } as never);
  return `${unsignedToken}.${b64urlEncode(signature)}`;
}

export interface PushSendResult { sent: number; removed: number; skipped: boolean }

/**
 * Sends a push message to every stored subscription of a user.
 * Never throws — failures are counted, dead (404/410) subscriptions are
 * removed, and a missing VAPID config skips silently.
 */
export async function sendPushToUser(db: any, userId: number, message: PushMessage): Promise<PushSendResult> {
  const config = getVapidConfig();
  if (!config) return { sent: 0, removed: 0, skipped: true };
  let subs: Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;
  try {
    subs = await db.select({
      id: schema.pushSubscriptions.id,
      endpoint: schema.pushSubscriptions.endpoint,
      p256dh: schema.pushSubscriptions.p256dh,
      auth: schema.pushSubscriptions.auth,
    }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
  } catch {
    return { sent: 0, removed: 0, skipped: true };
  }
  if (!subs.length) return { sent: 0, removed: 0, skipped: false };
  const plaintext = Buffer.from(JSON.stringify({
    titleEn: message.titleEn,
    titleEs: message.titleEs,
    bodyEn: message.bodyEn,
    bodyEs: message.bodyEs,
    url: message.url ?? "/app/",
    listingId: message.listingId ?? null,
  }), "utf8");
  let sent = 0;
  let removed = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      const receiverKey = b64urlDecode(sub.p256dh);
      const authSecret = b64urlDecode(sub.auth);
      const { salt, serverPublicKey, ciphertext } = encryptAes128Gcm(receiverKey, authSecret, Buffer.concat([plaintext, Buffer.from([0x02])]));
      const record = Buffer.concat([
        salt,
        Buffer.from([0x00, 0x00, 0x10, 0x00]), // rs = 4096
        Buffer.from([serverPublicKey.length]),
        serverPublicKey,
        ciphertext,
      ]);
      const jwt = createVapidJwt(config, sub.endpoint);
      const response = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${jwt}, k=${b64urlEncode(config.publicUncompressed)}`,
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
          TTL: "2419200",
          Urgency: "normal",
        },
        body: record,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404 || response.status === 410) {
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
        removed++;
      } else if (response.ok) {
        sent++;
      }
    } catch {
      // Per-subscription failure: counted as neither sent nor removed.
    }
  }));
  return { sent, removed, skipped: false };
}

/** Notify every user of a company (optionally excluding one user). Never throws. */
export async function sendPushToCompany(db: any, companyId: number, message: PushMessage, excludeUserId?: number): Promise<PushSendResult> {
  let users: Array<{ id: number }>;
  try {
    users = await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.companyId, companyId));
  } catch {
    return { sent: 0, removed: 0, skipped: true };
  }
  const total: PushSendResult = { sent: 0, removed: 0, skipped: false };
  for (const user of users) {
    if (excludeUserId !== undefined && user.id === excludeUserId) continue;
    const result = await sendPushToUser(db, user.id, message);
    total.sent += result.sent;
    total.removed += result.removed;
  }
  return total;
}
