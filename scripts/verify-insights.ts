import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { MAX_INSIGHTS, RELEVANCE_THRESHOLD } from "../convex/insights/rank.ts";

type Check = { name: string; pass: boolean; measured: string };

type SeededDoc = { id: string; url: string; publisher: string };

type Citation = {
  researchDocId: string;
  publisher: string;
  url: string;
  excerpt: string;
  fetchedAt: number;
};

type InsightRow = {
  insightId: string;
  matchType: string;
  confidence: number;
  rationaleCode: string;
  citations: Citation[];
};

type MatchRow = { id: string; relevant: number };

type MatchOutcome = { subjectId: string; candidates: number; matches: MatchRow[] };

const MATCH_TYPES = ["domain_signal", "observation_signal", "concern_signal"];
const RATIONALE_CODES = ["strong_relevance", "moderate_relevance"];

// The allowlisted but off-topic page the matcher has to drop, and the memory
// finding the seeded concern has to pull in.
const OSTEOARTHRITIS_URL =
  "https://www.mayoclinic.org/diseases-conditions/osteoarthritis/symptoms-causes/syc-20351925";
const MEMORY_URL =
  "https://www.nia.nih.gov/health/memory-loss-and-forgetfulness/memory-problems-forgetfulness-and-aging";

const seed = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { subjectId: string; assessmentId: string }
>("seed:seed");

const matchSubject = makeFunctionReference<"action", { assessmentId: string }, MatchOutcome>(
  "research/match:matchSubject",
);

const listBySubject = makeFunctionReference<"query", { subjectId: string }, InsightRow[]>(
  "insights/panel:listBySubject",
);

const checks: Check[] = [];

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error("CONVEX_URL is unset. Run `npm run verify:insights`, which loads .env.local.");
}

const convex = new ConvexHttpClient(convexUrl);

function check(name: string, pass: boolean, measured: string) {
  checks.push({ name, pass, measured });
}

function table(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const lines = [headers, ...rows].map((cells) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  "),
  );
  console.log(lines[0]);
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const line of lines.slice(1)) console.log(line);
}

const { subjectId, assessmentId } = await convex.mutation(seed);
console.log(`seeded subject ${subjectId} with assessment ${assessmentId}`);

// An internal mutation is unreachable from a Convex client, so the seeding step
// shells out to the CLI, the documented way to run an internal function. Its
// return value is the seeded ids, which are what name each citation.
const seeded: SeededDoc[] = JSON.parse(
  execFileSync("npx", ["convex", "run", "research/syntheticDocs:seedSyntheticDocs"], {
    encoding: "utf8",
  }),
);
console.log(`seeded ${seeded.length} synthetic researchDocs`);

const outcome = await convex.action(matchSubject, { assessmentId });
const insights = await convex.query(listBySubject, { subjectId });

const docById = new Map(seeded.map((doc) => [doc.id, doc] as const));
const urlFor = (id: string) => {
  const doc = docById.get(id);
  if (!doc) throw new Error(`Unknown researchDoc in matches: ${id}`);
  return doc.url;
};
const citations = insights.flatMap((row) => row.citations);
const citedUrls = citations.map((citation) => citation.url);
const confidences = insights.map((row) => row.confidence);
const matchTypes = [...new Set(insights.map((row) => row.matchType))];
const rationaleCodes = [...new Set(insights.map((row) => row.rationaleCode))];
const offTopic = outcome.matches.find((match) => urlFor(match.id) === OSTEOARTHRITIS_URL);

console.log(`\nCandidate relevance (${outcome.matches.length} of ${outcome.candidates} findings)`);
table(
  ["url", "relevant", "verdict"],
  outcome.matches.map((match) => [
    urlFor(match.id),
    match.relevant.toFixed(2),
    match.relevant >= RELEVANCE_THRESHOLD ? "matched" : "excluded",
  ]),
);

console.log(`\nInsights for ${subjectId} (${insights.length})`);
table(
  ["confidence", "matchType", "rationaleCode", "publisher", "url", "fetchedAt"],
  insights.flatMap((row) =>
    row.citations.map((citation) => [
      row.confidence.toFixed(2),
      row.matchType,
      row.rationaleCode,
      citation.publisher,
      citation.url,
      new Date(citation.fetchedAt).toISOString(),
    ]),
  ),
);

check(
  "every seeded researchDoc entered the JEV batch",
  outcome.candidates === seeded.length && outcome.matches.length === seeded.length,
  `candidates=${outcome.candidates} matches=${outcome.matches.length} seeded=${seeded.length}`,
);

check(
  "every insight cites a real researchDocs row",
  insights.every((row) => row.citations.length === 1) &&
    citations.every(
      (citation) =>
        docById.has(citation.researchDocId) &&
        citation.publisher.trim() !== "" &&
        citation.url.trim() !== "" &&
        Number.isFinite(citation.fetchedAt),
    ),
  `insights=${insights.length} citationsPerInsight=${insights
    .map((row) => row.citations.length)
    .join(", ")} citedUrls=${citedUrls.join(", ")}`,
);

check(
  "every insight carries a pinned match type and rationale code",
  insights.every(
    (row) => MATCH_TYPES.includes(row.matchType) && RATIONALE_CODES.includes(row.rationaleCode),
  ),
  `matchTypes=${matchTypes.join(", ")} rationaleCodes=${rationaleCodes.join(", ")}`,
);

check(
  "every insight clears the relevance cutoff",
  insights.every((row) => row.confidence >= RELEVANCE_THRESHOLD),
  `confidences=${confidences.map((confidence) => confidence.toFixed(2)).join(", ")} threshold=${RELEVANCE_THRESHOLD}`,
);

check(
  "the insight set is capped at MAX_INSIGHTS",
  insights.length <= MAX_INSIGHTS,
  `insights=${insights.length} max=${MAX_INSIGHTS}`,
);

check(
  "insights are ordered by descending confidence",
  confidences.every((confidence, index) => index === 0 || confidences[index - 1] >= confidence),
  `confidences=${confidences.map((confidence) => confidence.toFixed(2)).join(", ")}`,
);

check(
  "the unrelated finding is excluded",
  offTopic !== undefined &&
    offTopic.relevant < RELEVANCE_THRESHOLD &&
    !citedUrls.includes(OSTEOARTHRITIS_URL),
  `relevant=${offTopic ? offTopic.relevant.toFixed(2) : "missing"} threshold=${RELEVANCE_THRESHOLD} cited=${citedUrls.includes(OSTEOARTHRITIS_URL)}`,
);

check(
  "the memory-concern finding is matched",
  citedUrls.includes(MEMORY_URL),
  `citedUrls=${citedUrls.join(", ")}`,
);

console.log("\nAssertions");
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.name} (measured ${item.measured})`);
}

const failed = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} assertions passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}
