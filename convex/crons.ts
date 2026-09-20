import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// A week is the cadence the check-in repeats on, so the reminder scans weekly and
// mails whoever is behind. The hour is off the top of the hour on purpose.
crons.weekly(
  "check-in reminders",
  { dayOfWeek: "monday", hourUTC: 15, minuteUTC: 23 },
  internal.email.reminders.sendDueReminders,
);

export default crons;
