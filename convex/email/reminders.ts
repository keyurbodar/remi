import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { latestGrant } from "../consents/guard";
import { deliver } from "./send";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The action reads its own module through `internal`, so the handler return types
// are written out or the inference cycles.
type DueReminder = {
  reportId: Id<"reports">;
  recipient: string;
  scope: string;
  subjectName: string;
};

// A check-in is the thing Remi asks people to repeat, so a reminder is due when
// the newest finished check-in is a week old. Nothing else is reminded.
export const REMINDER_AFTER_MS = WEEK_MS;

/**
 * The scan the reminder action mails from. A reminder only ever goes to an
 * address the person already consented to: the recipient and the scope come from
 * the live grant on their newest final report, so withdrawing consent stops the
 * reminders with the same switch that stops the report.
 *
 * `reports` carries no subject index in the frozen schema, so the scan is
 * deliberate: it reads the table and keeps the newest final report per subject.
 */
export const dueReminders = internalQuery({
  args: { now: v.number() },
  returns: v.array(
    v.object({
      reportId: v.id("reports"),
      recipient: v.string(),
      scope: v.string(),
      subjectName: v.string(),
    }),
  ),
  handler: async (ctx, { now }): Promise<DueReminder[]> => {
    const newest = new Map<string, { report: Doc<"reports">; recipient: string }>();
    for (const report of await ctx.db.query("reports").collect()) {
      if (report.status !== "final" || report.recipient === undefined) continue;
      const held = newest.get(report.subjectId);
      if (held === undefined || report.createdAt > held.report.createdAt) {
        newest.set(report.subjectId, { report, recipient: report.recipient });
      }
    }
    const due = [];
    for (const { report, recipient } of newest.values()) {
      const grant = latestGrant(
        await ctx.db
          .query("consents")
          .withIndex("by_report", (q) => q.eq("reportId", report._id))
          .collect(),
      );
      if (grant === undefined || grant.revokedAt !== undefined) continue;
      const newestCheckIn = (
        await ctx.db
          .query("assessments")
          .withIndex("by_subject_created", (q) => q.eq("subjectId", report.subjectId))
          .collect()
      )
        .filter((row) => row.status === "finished")
        .reduce<Doc<"assessments"> | undefined>(
          (latest, row) => (latest === undefined || row.createdAt > latest.createdAt ? row : latest),
          undefined,
        );
      if (newestCheckIn !== undefined && now - newestCheckIn.createdAt < REMINDER_AFTER_MS) continue;
      const subject = await ctx.db.get(report.subjectId);
      if (subject === null) throw new Error(`Unknown subject: ${report.subjectId}`);
      due.push({
        reportId: report._id,
        recipient,
        scope: grant.scope,
        subjectName: subject.name,
      });
    }
    return due;
  },
});

const reminderBody = (subjectName: string, checkInUrl: string) =>
  `<!doctype html><html><body style="font-family:Georgia,serif;color:#2b2724;max-width:560px;margin:0 auto;padding:32px">
<h1 style="font-size:20px;font-weight:normal">A week has passed since the last check-in</h1>
<p style="line-height:1.6">The check-in for ${subjectName} is due again. Repeating it on a regular
schedule is what makes the trend worth showing at an appointment.</p>
<p style="line-height:1.6"><a href="${checkInUrl}" style="color:#2b2724">Open Remi and start the check-in</a></p>
<p style="line-height:1.6;font-size:13px;color:#6b635c">Remi is informational. It is not a diagnosis,
a screening result, a risk prediction, a medical device, or an emergency service. If you would
rather not receive reminders, revoke consent for this report in Remi and they stop.</p>
</body></html>`;

/**
 * Runs weekly from the cron. Each reminder goes through the same consent gate and
 * the same AgentMail boundary as the report, so a revoked consent refuses here
 * too. The idempotency key carries the seven day window the reminder belongs to,
 * so a retried run inside the same window returns the original message.
 */
export const sendDueReminders = internalAction({
  args: {},
  returns: v.array(v.object({ reportId: v.id("reports"), messageId: v.string() })),
  handler: async (ctx): Promise<{ reportId: Id<"reports">; messageId: string }[]> => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.email.reminders.dueReminders, { now });
    const sent: { reportId: Id<"reports">; messageId: string }[] = [];
    for (const reminder of due) {
      const { messageId } = await deliver(ctx, {
        reportId: reminder.reportId,
        recipient: reminder.recipient,
        scope: reminder.scope,
        idempotencyKey: `reminder-${reminder.reportId}-${Math.floor(now / WEEK_MS)}`,
        subject: "Time for the next Remi check-in",
        body: reminderBody(reminder.subjectName, "https://remi.convex.site"),
      });
      sent.push({ reportId: reminder.reportId, messageId });
    }
    return sent;
  },
});
