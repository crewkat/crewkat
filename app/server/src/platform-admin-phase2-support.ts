// Platform admin Phase 2 (2026-10-09): support ticket assignment, priority,
// and team-only internal notes. Roles admin + support only — moderators lost
// the support inbox per the Phase 2 permission matrix.
//
// The coordinator spreads platformAdminPhase2SupportActions into BaseActions
// (actions.ts) alongside the analytics/settings workstreams.
import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import { logAdminAction, platformDb } from "./actions";
import { requireTeamRole } from "./platform-admin";

type Db = ReturnType<Ctx["db"]>;

async function getReportOrThrow(db: Db, reportId: number) {
  const report = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, reportId)).limit(1))[0];
  if (!report) throw new Error("Report not found.");
  return report;
}

export const platformAdminPhase2SupportActions = {
  /** Assign (or unassign) a support ticket to a team member. Admin + support. */
  adminSupportTicketAssign: defineAction({
    request: z.object({ reportId: z.number().int().positive(), userId: z.number().int().positive().nullable() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "support");
      const db = platformDb(ctx);
      const report = await getReportOrThrow(db, args.reportId);
      let assigneeName = "unassigned";
      if (args.userId !== null) {
        const target = (await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(eq(schema.authUsers.id, args.userId)).limit(1))[0];
        if (!target) throw new Error("User not found.");
        assigneeName = target.name;
      }
      await db.update(schema.platformSupportReports)
        .set({ assignedTo: args.userId, updatedAt: new Date() })
        .where(eq(schema.platformSupportReports.id, report.id));
      await logAdminAction(db, admin.id, "support.assign", "platform_support_report", String(report.id),
        `${report.userName} <${report.userEmail}> — ${report.subject} — assigned to ${assigneeName}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Set a support ticket's priority. Admin + support. */
  adminSupportTicketPriority: defineAction({
    request: z.object({ reportId: z.number().int().positive(), priority: z.enum(["low", "normal", "high", "urgent"]) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "support");
      const db = platformDb(ctx);
      const report = await getReportOrThrow(db, args.reportId);
      await db.update(schema.platformSupportReports)
        .set({ priority: args.priority, updatedAt: new Date() })
        .where(eq(schema.platformSupportReports.id, report.id));
      await logAdminAction(db, admin.id, "support.priority", "platform_support_report", String(report.id),
        `${report.userName} <${report.userEmail}> — ${report.subject} — priority set to ${args.priority}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Add a team-only internal note to a support ticket. Admin + support. */
  adminSupportNoteAdd: defineAction({
    request: z.object({ reportId: z.number().int().positive(), note: z.string().trim().min(1).max(2000) }),
    response: z.object({ id: z.number(), createdAt: z.string() }),
    async handler(ctx, args) {
      const { admin } = await requireTeamRole(ctx, "admin", "support");
      const db = platformDb(ctx);
      const report = await getReportOrThrow(db, args.reportId);
      const now = new Date();
      const made = (await db.insert(schema.platformSupportNotes).values({
        reportId: report.id, authorId: admin.id, note: args.note, createdAt: now,
      }).returning({ id: schema.platformSupportNotes.id }))[0];
      if (!made) throw new Error("The note could not be saved.");
      await logAdminAction(db, admin.id, "support.note_add", "platform_support_report", String(report.id),
        `${report.userName} <${report.userEmail}> — ${report.subject} — ${args.note.slice(0, 160)}`);
      ctx.invalidateQueries();
      return { id: made.id, createdAt: now.toISOString() };
    },
  }),

  /** List team-only internal notes for a support ticket. Admin + support. */
  adminSupportNotesList: defineAction({
    request: z.object({ reportId: z.number().int().positive() }),
    response: z.object({
      notes: z.array(z.object({
        id: z.number(), authorId: z.number(), authorName: z.string(), note: z.string(), createdAt: z.string(),
      })),
    }),
    async handler(ctx, args) {
      await requireTeamRole(ctx, "admin", "support");
      const db = platformDb(ctx);
      await getReportOrThrow(db, args.reportId);
      const rows = await db.select().from(schema.platformSupportNotes)
        .where(eq(schema.platformSupportNotes.reportId, args.reportId))
        .orderBy(schema.platformSupportNotes.createdAt, schema.platformSupportNotes.id);
      const authorIds = [...new Set(rows.map((r) => r.authorId))];
      const authorRows = authorIds.length
        ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers)
            .where(inArray(schema.authUsers.id, authorIds))
        : [];
      const nameById = new Map(authorRows.map((a) => [a.id, a.name]));
      return {
        notes: rows.map((r) => ({
          id: r.id, authorId: r.authorId, authorName: nameById.get(r.authorId) ?? `User ${r.authorId}`,
          note: r.note, createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),
};
