import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

crons.weekly(
  "weekly research refresh",
  { dayOfWeek: "sunday", hourUTC: 3 },
  api.research.crawl.refreshAll,
  {},
);

export default crons;
