// Platform admin Phase 2 — Settings workstream (2026-10-09): maintenance
// mode, platform branding, policy versions, and admin TOTP 2FA.
//
// Convention: this module exports platformAdminPhase2SettingsActions,
// spread into BaseActions in actions.ts. Public actions
// (getMaintenanceStatus, getPlatformBranding, getPolicyVersion,
// verifyTotpLogin) are listed in PUBLIC_ACTIONS in actions.ts.
//
// TOTP is implemented with node:crypto only (HMAC-SHA1 + base32 decode,
// dynamic truncation, 30s step, ±1 step verification window). No new deps.
import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as schema from "./schema";
import {
  authUserShape,
  getPlatformSetting,
  issueSession,
  logAdminAction,
  platformDb,
  requirePlatformAdmin,
} from "./actions";
import { requireTeamRole } from "./platform-admin";

type Db = ReturnType<Ctx["db"]>;

// ---------------------------------------------------------------------------
// TOTP (RFC 6238): HMAC-SHA1, 30-second steps, 6 digits.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.trim().replace(/=+$/, "").toUpperCase();
  if (!clean) throw new Error("Invalid authenticator secret.");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid authenticator secret.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotpCode(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(buf).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const b0 = mac[offset] as number;
  const b1 = mac[offset + 1] as number;
  const b2 = mac[offset + 2] as number;
  const b3 = mac[offset + 3] as number;
  const truncated = ((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3;
  return String(truncated % 1_000_000).padStart(6, "0");
}

/** 6-digit TOTP for a base32 secret at a given time (ms). */
export function totpCode(secret: string, atMs: number = Date.now(), stepSeconds = 30): string {
  return hotpCode(base32Decode(secret), Math.floor(atMs / 1000 / stepSeconds));
}

/** Verifies a 6-digit code within ±`window` time steps. */
export function verifyTotpCode(secret: string, code: string, atMs: number = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  const step = Math.floor(atMs / 1000 / 30);
  for (let delta = -window; delta <= window; delta++) {
    if (hotpCode(key, step + delta) === code) return true;
  }
  return false;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function upsertPlatformSetting(db: Db, key: string, value: string): Promise<void> {
  const now = new Date();
  const existing = (await db.select({ key: schema.platformSettings.key }).from(schema.platformSettings).where(eq(schema.platformSettings.key, key)).limit(1))[0];
  if (existing) await db.update(schema.platformSettings).set({ value, updatedAt: now }).where(eq(schema.platformSettings.key, key));
  else await db.insert(schema.platformSettings).values({ key, value, updatedAt: now });
}

const policyKindSchema = z.enum(["terms", "privacy"]);
const policyVersionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  version: z.string(),
  url: z.string(),
  effectiveAt: z.string().nullable(),
  publishedBy: z.number().nullable(),
  createdAt: z.string(),
});

export const platformAdminPhase2SettingsActions = {
  // -----------------------------------------------------------------------
  // Maintenance mode
  // -----------------------------------------------------------------------

  /** Public: whether the platform is in maintenance mode and the message. */
  getMaintenanceStatus: defineAction({
    request: z.object({}),
    response: z.object({ enabled: z.boolean(), message: z.string() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [enabledRaw, message] = await Promise.all([
        getPlatformSetting(db, "maintenance_mode", "0"),
        getPlatformSetting(db, "maintenance_message", ""),
      ]);
      return { enabled: enabledRaw === "1", message };
    },
  }),

  /** Admin-only: flip maintenance mode. When on, signUp refuses new accounts. */
  adminMaintenanceSet: defineAction({
    request: z.object({ enabled: z.boolean(), message: z.string().trim().max(300).default("") }),
    response: z.object({ ok: z.literal(true), enabled: z.boolean(), message: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; enabled: boolean; message: string }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      if (args.message.length > 300) throw new Error("Keep the maintenance message under 300 characters.");
      await upsertPlatformSetting(db, "maintenance_mode", args.enabled ? "1" : "0");
      await upsertPlatformSetting(db, "maintenance_message", args.message);
      await logAdminAction(db, admin.id, "settings.maintenance", "platform_setting", "maintenance_mode",
        `maintenance ${args.enabled ? "ON" : "OFF"}${args.message ? ` — "${args.message}"` : ""}`);
      ctx.invalidateQueries();
      return { ok: true, enabled: args.enabled, message: args.message };
    },
  }),

  // -----------------------------------------------------------------------
  // Platform branding
  // -----------------------------------------------------------------------

  /** Public: logo URL (if set) and the admin-panel accent color. */
  getPlatformBranding: defineAction({
    request: z.object({}),
    response: z.object({ logoUrl: z.string().nullable(), primaryColor: z.string() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [logoKey, primaryColor] = await Promise.all([
        getPlatformSetting(db, "platform_logo_blob_key", ""),
        getPlatformSetting(db, "brand_primary_color", "#e8590c"),
      ]);
      let logoUrl: string | null = null;
      if (logoKey) {
        try {
          logoUrl = await ctx.blobs.getUrl(logoKey);
        } catch {
          logoUrl = null;
        }
      }
      return { logoUrl, primaryColor };
    },
  }),

  /** Admin-only: upload the platform logo (jpeg/png, ≤10MB). Replaces the old one. */
  adminBrandLogoUpload: defineAction({
    request: z.object({
      filename: z.string().trim().min(1).max(240),
      contentType: z.enum(["image/jpeg", "image/png"]),
      dataBase64: z.string().min(1).max(14_000_000),
    }),
    response: z.object({ ok: z.literal(true), logoUrl: z.string().nullable() }),
    async handler(ctx, args): Promise<{ ok: true; logoUrl: string | null }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      if (args.filename.length > 240) throw new Error("The filename is too long.");
      if (args.dataBase64.length > 14_000_000) throw new Error("The logo must be 10MB or smaller.");
      const bytes = Buffer.from(args.dataBase64, "base64");
      if (bytes.length > 10 * 1024 * 1024) throw new Error("The logo must be 10MB or smaller.");
      const safe = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "logo";
      const key = `branding/platform-${randomBytes(8).toString("hex")}-${safe}`;
      await ctx.blobs.put(key, bytes, { contentType: args.contentType });
      const oldKey = await getPlatformSetting(db, "platform_logo_blob_key", "");
      await upsertPlatformSetting(db, "platform_logo_blob_key", key);
      if (oldKey && oldKey !== key) {
        try {
          await ctx.blobs.delete(oldKey);
        } catch {
          // Old blob already gone — the setting is already updated.
        }
      }
      let logoUrl: string | null = null;
      try {
        logoUrl = await ctx.blobs.getUrl(key);
      } catch {
        logoUrl = null;
      }
      await logAdminAction(db, admin.id, "settings.branding_changed", "platform_setting", "platform_logo_blob_key",
        `logo uploaded: ${key}`);
      ctx.invalidateQueries();
      return { ok: true, logoUrl };
    },
  }),

  /** Admin-only: set the brand primary color (#rrggbb). */
  adminBrandingColorSet: defineAction({
    request: z.object({ primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Enter a hex color like #e8590c.") }),
    response: z.object({ ok: z.literal(true), primaryColor: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; primaryColor: string }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      if (!/^#[0-9a-fA-F]{6}$/.test(args.primaryColor)) throw new Error("Enter a hex color like #e8590c.");
      await upsertPlatformSetting(db, "brand_primary_color", args.primaryColor);
      await logAdminAction(db, admin.id, "settings.branding_changed", "platform_setting", "brand_primary_color",
        `brand color -> ${args.primaryColor}`);
      ctx.invalidateQueries();
      return { ok: true, primaryColor: args.primaryColor };
    },
  }),

  // -----------------------------------------------------------------------
  // Policy versions (terms / privacy)
  // -----------------------------------------------------------------------

  /** Admin-only: publish a new terms/privacy version row. */
  adminPolicyVersionPublish: defineAction({
    request: z.object({
      kind: policyKindSchema,
      version: z.string().trim().min(1).max(40),
      url: z.string().trim().max(500).default(""),
      effectiveAt: z.string().datetime().optional(),
    }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; id: number }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      if (!args.version || args.version.length > 40) throw new Error("Version must be 1–40 characters.");
      if (args.url.length > 500) throw new Error("Keep the URL under 500 characters.");
      const now = new Date();
      const made = (await db.insert(schema.platformPolicyVersions).values({
        kind: args.kind,
        version: args.version,
        url: args.url,
        effectiveAt: args.effectiveAt ? new Date(args.effectiveAt) : null,
        publishedBy: admin.id,
        createdAt: now,
      }).returning({ id: schema.platformPolicyVersions.id }))[0];
      if (!made) throw new Error("The policy version could not be saved.");
      await logAdminAction(db, admin.id, "settings.policy_publish", "policy_version", String(made.id),
        `${args.kind} v${args.version}${args.url ? ` (${args.url})` : ""}`);
      ctx.invalidateQueries();
      return { ok: true, id: made.id };
    },
  }),

  /** Admin-only: version history, newest first. */
  adminPolicyVersionsList: defineAction({
    request: z.object({ kind: policyKindSchema.optional() }),
    response: z.object({ versions: z.array(policyVersionSchema) }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const rows = args.kind
        ? await db.select().from(schema.platformPolicyVersions)
            .where(eq(schema.platformPolicyVersions.kind, args.kind))
            .orderBy(desc(schema.platformPolicyVersions.createdAt), desc(schema.platformPolicyVersions.id))
        : await db.select().from(schema.platformPolicyVersions)
            .orderBy(desc(schema.platformPolicyVersions.createdAt), desc(schema.platformPolicyVersions.id));
      return {
        versions: rows.map((r) => ({
          id: r.id, kind: r.kind, version: r.version, url: r.url,
          effectiveAt: r.effectiveAt ? r.effectiveAt.toISOString() : null,
          publishedBy: r.publishedBy, createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  /** Public: latest published version for a doc kind, or null. */
  getPolicyVersion: defineAction({
    request: z.object({ kind: policyKindSchema }),
    response: z.object({ version: z.string(), url: z.string(), effectiveAt: z.string().nullable() }).nullable(),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const row = (await db.select().from(schema.platformPolicyVersions)
        .where(eq(schema.platformPolicyVersions.kind, args.kind))
        .orderBy(desc(schema.platformPolicyVersions.createdAt), desc(schema.platformPolicyVersions.id))
        .limit(1))[0];
      if (!row) return null;
      return {
        version: row.version,
        url: row.url,
        effectiveAt: row.effectiveAt ? row.effectiveAt.toISOString() : null,
      };
    },
  }),

  // -----------------------------------------------------------------------
  // Admin TOTP 2FA
  // -----------------------------------------------------------------------

  /** Any platform team member: start enrollment. Returns the secret for
   *  manual entry in an authenticator app (no QR lib available). */
  adminTotpSetupStart: defineAction({
    request: z.object({}),
    response: z.object({ secret: z.string(), otpauthUri: z.string() }),
    async handler(ctx) {
      const { admin } = await requireTeamRole(ctx, "admin", "support", "moderator");
      const db = platformDb(ctx);
      const secret = base32Encode(randomBytes(20));
      const now = new Date();
      const existing = (await db.select({ userId: schema.adminTotpSecrets.userId }).from(schema.adminTotpSecrets).where(eq(schema.adminTotpSecrets.userId, admin.id)).limit(1))[0];
      if (existing) {
        await db.update(schema.adminTotpSecrets)
          .set({ secret, verified: false, verifiedAt: null, createdAt: now })
          .where(eq(schema.adminTotpSecrets.userId, admin.id));
      } else {
        await db.insert(schema.adminTotpSecrets).values({ userId: admin.id, secret, verified: false, createdAt: now });
      }
      const otpauthUri = `otpauth://totp/Crewkat:${encodeURIComponent(admin.email)}?secret=${secret}&issuer=Crewkat`;
      return { secret, otpauthUri };
    },
  }),

  /** Any platform team member: confirm enrollment with a 6-digit code. */
  adminTotpSetupVerify: defineAction({
    request: z.object({ code: z.string().regex(/^\d{6}$/) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "support", "moderator");
      const db = platformDb(ctx);
      const row = (await db.select().from(schema.adminTotpSecrets).where(eq(schema.adminTotpSecrets.userId, admin.id)).limit(1))[0];
      if (!row) throw new Error("Start 2FA setup first.");
      if (!verifyTotpCode(row.secret, args.code)) throw new Error("That code is not valid. Check your authenticator app and try again.");
      await db.update(schema.adminTotpSecrets).set({ verified: true, verifiedAt: new Date() }).where(eq(schema.adminTotpSecrets.userId, admin.id));
      await logAdminAction(db, admin.id, "settings.totp_enabled", "user", String(admin.id), "TOTP 2FA enrolled and verified");
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Self, or admin-for-other: remove a TOTP secret. */
  adminTotpDisable: defineAction({
    request: z.object({ userId: z.number().int().positive().optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin, role } = await requireTeamRole(ctx, "admin", "support", "moderator");
      const targetId = args.userId ?? admin.id;
      if (targetId !== admin.id && role !== "admin") throw new Error("Platform admin access required.");
      const db = platformDb(ctx);
      const target = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.id, targetId)).limit(1))[0];
      if (!target) throw new Error("User not found.");
      await db.delete(schema.adminTotpSecrets).where(eq(schema.adminTotpSecrets.userId, targetId));
      await logAdminAction(db, admin.id, "settings.totp_disabled", "user", String(targetId),
        targetId === admin.id ? "disabled own TOTP 2FA" : "disabled TOTP 2FA");
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Any platform team member: own enrollment state. */
  adminTotpStatus: defineAction({
    request: z.object({}),
    response: z.object({ enrolled: z.boolean(), verified: z.boolean() }),
    async handler(ctx) {
      const { admin } = await requireTeamRole(ctx, "admin", "support", "moderator");
      const db = platformDb(ctx);
      const row = (await db.select({ verified: schema.adminTotpSecrets.verified }).from(schema.adminTotpSecrets).where(eq(schema.adminTotpSecrets.userId, admin.id)).limit(1))[0];
      return { enrolled: !!row, verified: row?.verified ?? false };
    },
  }),

  /** Admin-only: require TOTP 2FA for the whole platform team at login. */
  adminTotpRequiredSet: defineAction({
    request: z.object({ required: z.boolean() }),
    response: z.object({ ok: z.literal(true), required: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; required: boolean }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      await upsertPlatformSetting(db, "admin_2fa_required", args.required ? "1" : "0");
      await logAdminAction(db, admin.id, "settings.totp_required", "platform_setting", "admin_2fa_required",
        `team 2FA requirement ${args.required ? "ON" : "OFF"}`);
      ctx.invalidateQueries();
      return { ok: true, required: args.required };
    },
  }),

  /** Public: finish a TOTP-pending login. The client sends the pending proof
   *  as _sessionToken (the fetch layer attaches it automatically). */
  verifyTotpLogin: defineAction({
    request: z.object({ code: z.string().regex(/^\d{6}$/), _sessionToken: z.string().min(32).max(300).optional() }),
    response: z.object({
      sessionToken: z.string(),
      expiresAt: z.string(),
      user: z.object({
        id: z.number(), name: z.string(), email: z.string(), companyId: z.number(), role: z.literal("owner"),
        tier: z.enum(["free", "premium"]), isPlatformAdmin: z.boolean(),
        marketplaceTermsAcceptedAt: z.string().nullable(), marketplaceTermsVersion: z.string().nullable(),
        announcementBanner: z.string(), createdAt: z.string(),
      }),
      setCookies: z.array(z.string()),
      totpRequired: z.boolean().default(false),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (!args._sessionToken) throw new Error("Your verification session has expired. Sign in again.");
      const pending = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, sha256Hex(args._sessionToken))).limit(1))[0];
      if (!pending || !pending.totpPending || pending.revokedAt || pending.expiresAt.getTime() <= Date.now()) {
        throw new Error("Your verification session has expired. Sign in again.");
      }
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, pending.userId)).limit(1))[0];
      if (!user?.emailVerifiedAt) throw new Error("Sign in to continue.");
      if (user.suspendedAt) throw new Error("This account has been suspended. Contact support for help.");
      const totp = (await db.select().from(schema.adminTotpSecrets).where(eq(schema.adminTotpSecrets.userId, user.id)).limit(1))[0];
      if (!totp?.verified) throw new Error("Two-factor authentication is not set up for this account.");
      if (!verifyTotpCode(totp.secret, args.code)) throw new Error("That code is not valid. Check your authenticator app and try again.");
      // Burn the pending proof, then issue the real session.
      await db.update(schema.authSessions).set({ revokedAt: new Date() }).where(eq(schema.authSessions.id, pending.id));
      const session = await issueSession(ctx, user.id);
      return {
        sessionToken: session.proof,
        expiresAt: session.proofExpiresAt.toISOString(),
        user: authUserShape(user, await getPlatformSetting(db, "announcement_banner", "")),
        setCookies: session.setCookies,
        totpRequired: false,
      };
    },
  }),
};
