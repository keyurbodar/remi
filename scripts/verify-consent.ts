import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ConsentDenial } from "../convex/consents/guard";

type Check = { name: string; pass: boolean; measured: string };

type ConsentStateRow = {
  reportId: string;
  recipient: string | null;
  scope: string | null;
  status: "none" | "active" | "revoked";
  grantedAt: number | null;
  revokedAt: number | null;
};

type ConsentReceipt = {
  consentId: string;
  reportId: string;
  recipient: string;
  scope: string;
  grantedAt: number;
};

type GuardOutcome = {
  code: ConsentDenial["code"] | "no_error" | "unparsed";
  receipt: ConsentReceipt | null;
  output: string;
};

const RECIPIENT = "caregiver@example.com";
const SCOPE = "email the visit brief to the caregiver";
const OTHER_RECIPIENT = "someone-else@example.com";
const OTHER_SCOPE = "email the visit brief to the doctor";

const seed = makeFunctionReference<"mutation", Record<string, never>, { subjectId: string }>(
  "seed:seed",
);

const grant = makeFunctionReference<
  "mutation",
  { reportId: string; recipient: string; scope: string },
  string
>("consents/grant:grant");

const revoke = makeFunctionReference<"mutation", { consentId: string }, null>(
  "consents/revoke:revoke",
);

const consentState = makeFunctionReference<"query", { subjectId: string }, ConsentStateRow[]>(
  "consents/state:consentState",
);

const checks: Check[] = [];

const convexUrl = process.env.CONVEX_URL;
const deployment = process.env.CONVEX_DEPLOYMENT;
if (convexUrl === undefined || deployment === undefined) {
  throw new Error(
    "CONVEX_URL and CONVEX_DEPLOYMENT must be set. Run `npm run verify:consent`, which loads .env.local.",
  );
}

const deploymentName = deployment.replace(/^dev:/, "");
const host = new URL(convexUrl).host;
const convex = new ConvexHttpClient(convexUrl);

function check(name: string, pass: boolean, measured: string) {
  checks.push({ name, pass, measured });
}

function show(value: unknown) {
  return value === undefined ? "missing" : String(value);
}

function showScope(scope: string | null | undefined) {
  return scope === null || scope === undefined ? "null" : JSON.stringify(scope);
}

function stateCells(row: ConsentStateRow) {
  return [
    row.reportId,
    show(row.recipient),
    show(row.scope),
    row.status,
    show(row.grantedAt),
    show(row.revokedAt),
  ];
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

const STATE_HEADERS = ["reportId", "recipient", "scope", "status", "grantedAt", "revokedAt"];

function convexRun(path: string, args: Record<string, unknown>) {
  return spawnSync(
    "npx",
    ["convex", "run", "--deployment", deploymentName, path, JSON.stringify(args)],
    { encoding: "utf8" },
  );
}

// Internal functions never cross the HTTP client, so the CLI runs them against
// the deployment the client is pinned to.
function runInternal<T>(path: string, args: Record<string, unknown>): T {
  const result = convexRun(path, args);
  if (result.status !== 0) throw new Error(`convex run ${path} failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout) as T;
}

// The guard is the gate the send path calls, so its typed refusal is what a
// blocked send looks like from outside: read the code, never the message.
function guardOutcome(reportId: string, recipient: string, scope: string): GuardOutcome {
  const result = convexRun("consents/guard:requireConsent", { reportId, recipient, scope });
  if (result.status === 0) {
    return {
      code: "no_error",
      receipt: JSON.parse(result.stdout) as ConsentReceipt,
      output: result.stdout.trim(),
    };
  }
  const payload = /Uncaught ConvexError: (\{.*\})/.exec(result.stderr);
  if (payload === null) return { code: "unparsed", receipt: null, output: result.stderr.trim() };
  return { code: (JSON.parse(payload[1]) as ConsentDenial).code, receipt: null, output: payload[1] };
}

check(
  "the CLI and the HTTP client target the same deployment",
  host === `${deploymentName}.convex.cloud`,
  `host=${host} deployment=${deploymentName}`,
);

const { subjectId } = await convex.mutation(seed);
console.log(`seeded subject ${subjectId}`);

const reportId = runInternal<string>("consents/fixtures:stageReport", {
  ownerId: "demo-user",
  subjectId,
  recipient: RECIPIENT,
});
console.log(`staged report ${reportId} for ${RECIPIENT}`);

const beforeGrant = await convex.query(consentState, { subjectId });
console.log("\nConsent state before any grant");
table(STATE_HEADERS, beforeGrant.map(stateCells));

const staged = beforeGrant[0];
check(
  "consentState lists the staged report as the only report before any grant",
  beforeGrant.length === 1 && staged?.reportId === reportId,
  `rows=${beforeGrant.length} reportIds=${beforeGrant.map((row) => row.reportId).join(", ")}`,
);

check(
  "the un-granted report carries the staged recipient with no scope and no grant",
  staged?.recipient === RECIPIENT && staged?.scope === null && staged?.status === "none",
  `recipient=${show(staged?.recipient)} scope=${showScope(staged?.scope)} status=${show(staged?.status)}`,
);

const beforeGrantGuard = guardOutcome(reportId, RECIPIENT, SCOPE);
check(
  "the guard refuses a report with no consent row as consent_missing",
  beforeGrantGuard.code === "consent_missing",
  `code=${beforeGrantGuard.code} output=${beforeGrantGuard.output}`,
);

const consentId = await convex.mutation(grant, { reportId, recipient: RECIPIENT, scope: SCOPE });
console.log(`granted consent ${consentId}`);

check(
  "grant returns a consent id",
  typeof consentId === "string" && consentId !== "",
  `consentId=${show(consentId)}`,
);

const afterGrant = await convex.query(consentState, { subjectId });
console.log("\nConsent state after the grant");
table(STATE_HEADERS, afterGrant.map(stateCells));

const active = afterGrant[0];
check(
  "the granted report reads status active with the granted scope",
  active?.reportId === reportId && active?.status === "active" && active?.scope === SCOPE,
  `status=${show(active?.status)} scope=${showScope(active?.scope)} reportId=${show(active?.reportId)}`,
);

check(
  "the granted row records a grantedAt timestamp",
  typeof active?.grantedAt === "number",
  `grantedAt=${show(active?.grantedAt)}`,
);

const admitted = guardOutcome(reportId, RECIPIENT, SCOPE);
check(
  "the guard admits the granted triple and returns the granted consent",
  admitted.code === "no_error" && admitted.receipt?.consentId === consentId,
  `code=${admitted.code} returned=${show(admitted.receipt?.consentId)} granted=${show(consentId)}`,
);

check(
  "the admitted guard echoes the granted recipient and scope",
  admitted.receipt?.recipient === RECIPIENT && admitted.receipt?.scope === SCOPE,
  `recipient=${show(admitted.receipt?.recipient)} scope=${showScope(admitted.receipt?.scope)}`,
);

const wrongRecipient = guardOutcome(reportId, OTHER_RECIPIENT, SCOPE);
check(
  "the guard refuses a different recipient as recipient_mismatch",
  wrongRecipient.code === "recipient_mismatch",
  `code=${wrongRecipient.code} recipient=${OTHER_RECIPIENT} output=${wrongRecipient.output}`,
);

const wrongScope = guardOutcome(reportId, RECIPIENT, OTHER_SCOPE);
check(
  "the guard refuses a different scope as scope_mismatch",
  wrongScope.code === "scope_mismatch",
  `code=${wrongScope.code} scope=${showScope(OTHER_SCOPE)} output=${wrongScope.output}`,
);

const revoked = await convex.mutation(revoke, { consentId });
console.log(`revoked consent ${consentId}`);

check("revoke returns null", revoked === null, `revoke=${show(revoked)}`);

const afterRevokeGuard = guardOutcome(reportId, RECIPIENT, SCOPE);
check(
  "the guard refuses the revoked consent as consent_revoked",
  afterRevokeGuard.code === "consent_revoked",
  `code=${afterRevokeGuard.code} output=${afterRevokeGuard.output}`,
);

const afterRevoke = await convex.query(consentState, { subjectId });
console.log("\nConsent state after the revoke");
table(STATE_HEADERS, afterRevoke.map(stateCells));

const revokedRow = afterRevoke[0];
check(
  "the revoked report reads status revoked",
  revokedRow?.reportId === reportId && revokedRow?.status === "revoked",
  `status=${show(revokedRow?.status)} reportId=${show(revokedRow?.reportId)}`,
);

check(
  "the revoked row keeps the scope it was granted with",
  revokedRow?.scope === SCOPE,
  `scope=${showScope(revokedRow?.scope)} granted=${showScope(SCOPE)}`,
);

check(
  "the revoked row records a revokedAt timestamp",
  typeof revokedRow?.revokedAt === "number",
  `revokedAt=${show(revokedRow?.revokedAt)}`,
);

check(
  "revoking leaves the grantedAt of the revoked grant unchanged",
  typeof revokedRow?.grantedAt === "number" && revokedRow.grantedAt === active?.grantedAt,
  `grantedAtAfterRevoke=${show(revokedRow?.grantedAt)} grantedAtAfterGrant=${show(active?.grantedAt)}`,
);

const secondConsentId = await convex.mutation(grant, {
  reportId,
  recipient: RECIPIENT,
  scope: SCOPE,
});
console.log(`granted consent ${secondConsentId} again`);

const reGranted = guardOutcome(reportId, RECIPIENT, SCOPE);
check(
  "the guard admits the send again after a re-grant",
  reGranted.code === "no_error",
  `code=${reGranted.code} returned=${show(reGranted.receipt?.consentId)} output=${reGranted.output}`,
);

check(
  "the re-grant is a new consent row, not the revoked one",
  secondConsentId !== consentId && reGranted.receipt?.consentId === secondConsentId,
  `reGranted=${show(secondConsentId)} revoked=${show(consentId)} returned=${show(
    reGranted.receipt?.consentId,
  )}`,
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
