/**
 * The r4 #6 runtime proof, headless: seed, score, match, build a report file,
 * send it through AgentMail, record delivery, classify an inbound reply, and
 * refuse a send after a revoke. Every step reads back what the deployment wrote.
 *
 * The AgentMail key and the webhook secret come from the deployment rather than
 * the environment, so no secret lands in the repo.
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { Webhook } from "svix";
import type { ConsentDenial } from "../convex/consents/guard";

type Check = { name: string; pass: boolean; measured: string };

type MessageRow = {
  messageId: string;
  direction: "outbound" | "inbound";
  agentmailMessageId: string;
  body: string;
  deliveryStatus: string;
  classification: string | null;
  receivedAt: number;
};

type SentReport = {
  messageId: string;
  threadId: string;
  deliveryStatus: string;
  consentId: string;
};

type BuiltReport = {
  reportId: string;
  fileId: string;
  html: string;
  questions: { prompt: string; basis: string }[];
};

type Preview = {
  reportId: string;
  status: "draft" | "final";
  recipient: string | null;
  fileId: string;
  url: string | null;
};

type InboxMessage = {
  messageId: string;
  subject: string;
  labels: string[];
  html: string | null;
  timestamp: string;
};

type DueReminder = {
  reportId: string;
  recipient: string;
  scope: string;
  subjectName: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The AgentMail account carries one human inbox and one generated inbox. The
// generated inbox stands in for the person's own address, because a send to the
// sending inbox itself produces no received copy to read back.
const RECIPIENT = "wonderfulholiday540@agentmail.to";
const SENDING_INBOX = "keyur@agentmail.to";
const SCOPE = "email the visit brief to the caregiver";
const OWNER_ID = "demo-user";
const REPLY_TEXT =
  "She asked me the same question three times today and forgot we had an appointment. It is getting worse.";

const checks: Check[] = [];

const convexUrl = process.env.CONVEX_URL;
const deployment = process.env.CONVEX_DEPLOYMENT;
if (convexUrl === undefined || deployment === undefined) {
  throw new Error(
    "CONVEX_URL and CONVEX_DEPLOYMENT must be set. Run `npm run verify:report`, which loads .env.local.",
  );
}

const deploymentName = deployment.replace(/^dev:/, "");
const host = new URL(convexUrl).host;

// The next call seeds the deployment CONVEX_URL names, and seeding clears all
// twelve tables there, so the two variables disagreeing stops the script instead
// of wiping the wrong deployment.
if (host !== `${deploymentName}.convex.cloud`) {
  throw new Error(
    `CONVEX_URL host ${host} is not the ${deploymentName} deployment: seeding would clear every table on ${host}, not on ${deploymentName}.convex.cloud.`,
  );
}

const convex = new ConvexHttpClient(convexUrl);

function check(name: string, pass: boolean, measured: string) {
  checks.push({ name, pass, measured });
}

function show(value: unknown) {
  return value === undefined ? "missing" : String(value);
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

function convexRun(path: string, args: Record<string, unknown>) {
  return spawnSync("npx", ["convex", "run", "--deployment", deploymentName, path, JSON.stringify(args)], {
    encoding: "utf8",
  });
}

// Internal functions never cross the HTTP client, so the CLI runs them against
// the deployment the client is pinned to.
function runInternal<T>(path: string, args: Record<string, unknown>): T {
  const result = convexRun(path, args);
  if (result.status !== 0) throw new Error(`convex run ${path} failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout) as T;
}

function envValue(name: string) {
  const result = spawnSync("npx", ["convex", "env", "get", name], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`convex env get ${name} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const agentMailKey = envValue("AGENTMAIL_API_KEY");
const webhookSecret = envValue("AGENTMAIL_WEBHOOK_SECRET");
const siteUrl = envValue("CONVEX_SITE_URL");

async function agentMail<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.agentmail.to/v0${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${agentMailKey}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`AgentMail ${path} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

type RawInboxMessage = {
  message_id: string;
  subject: string;
  labels: string[];
  html: string | null;
  timestamp: string;
};

const asInboxMessage = (row: RawInboxMessage): InboxMessage => ({
  messageId: row.message_id,
  subject: row.subject,
  labels: row.labels,
  html: row.html,
  timestamp: row.timestamp,
});

// The delivered copy has to still name the subject it was built for, and the
// report title is where the rendered document carries it.
const subjectNameIn = (document: string) => /<h1[^>]*>([^<]*)</.exec(document)?.[1] ?? "";

// Delivery lands after the send call returns, so arrival is polled rather than
// assumed. A timeout is a failed assertion, never a skip.
async function waitFor<T>(describe: string, read: () => Promise<T | null>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${describe}`);
    await sleep(3_000);
  }
}

const seed = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { subjectId: string; assessmentId: string }
>("seed:seed");

const startAssessment = makeFunctionReference<
  "mutation",
  { ownerId: string; subjectId: string },
  string
>("assessments/session:start");

const submitResponse = makeFunctionReference<
  "mutation",
  { assessmentId: string; taskKey: string; answer: string; reactionMs?: number; clientTs: number },
  string
>("assessments/session:submit");

const finishAssessment = makeFunctionReference<"mutation", { assessmentId: string }, null>(
  "assessments/session:finish",
);

const scoreResponse = makeFunctionReference<
  "action",
  { responseId: string },
  { scoreId: string; domain: string; value: number; confidence: number; lowConfidence: boolean; rationaleCode: string }
>("jev/scoreAnswer:scoreResponse");

const answerScores = makeFunctionReference<
  "query",
  { assessmentId: string },
  { domain: string; value: number; confidence: number; modelVersion: string; lowConfidence: boolean; rationaleCode: string }[]
>("scores/rollup:answerScores");

const matchSubject = makeFunctionReference<"action", { assessmentId: string }, unknown>(
  "research/match:matchSubject",
);

const buildReport = makeFunctionReference<
  "action",
  { ownerId: string; subjectId: string },
  BuiltReport
>("reports/build:buildReport");

const finalize = makeFunctionReference<"mutation", { reportId: string; recipient: string }, null>(
  "reports/build:finalize",
);

const previewReport = makeFunctionReference<"query", { reportId: string }, Preview>(
  "reports/build:previewReport",
);

const grant = makeFunctionReference<
  "mutation",
  { reportId: string; recipient: string; scope: string },
  string
>("consents/grant:grant");

const revoke = makeFunctionReference<"mutation", { reportId: string }, null>("consents/revoke:revoke");

const sendReport = makeFunctionReference<
  "action",
  { reportId: string; recipient: string; scope: string },
  SentReport
>("email/send:sendReport");

const readMessages = () => runInternal<MessageRow[]>("email/ingest:listMessages", {});

// ---------------------------------------------------------------------------
// The loop.
// ---------------------------------------------------------------------------

const { subjectId } = await convex.mutation(seed);
console.log(`seeded subject ${subjectId}`);

// The loop starts where a person does: a check-in answered and scored by JEV, so
// the brief renders real model output rather than the seed fixture.
const assessmentId = await convex.mutation(startAssessment, { ownerId: OWNER_ID, subjectId });
const responseId = await convex.mutation(submitResponse, {
  assessmentId,
  taskKey: "memory-word-recall-3",
  answer: "apple, table, chair",
  reactionMs: 6100,
  clientTs: Date.now(),
});
const scored = await convex.action(scoreResponse, { responseId });
await convex.mutation(finishAssessment, { assessmentId });
const [scoreRow] = await convex.query(answerScores, { assessmentId });
console.log(
  `scored ${scoreRow.domain} at ${scoreRow.value} confidence ${scoreRow.confidence} ${scoreRow.rationaleCode} (${scoreRow.modelVersion})`,
);

check(
  "the check-in inside the loop was scored by JEV and the row carries the model version",
  scored.domain === scoreRow.domain &&
    scored.value === scoreRow.value &&
    scoreRow.modelVersion.startsWith("jev-") &&
    scoreRow.value > 0 &&
    scoreRow.value <= 4,
  `domain=${scoreRow.domain} value=${scoreRow.value} confidence=${scoreRow.confidence} modelVersion=${scoreRow.modelVersion}`,
);

const seededDocs = runInternal<{ id: string; url: string; publisher: string }[]>(
  "research/syntheticDocs:seedSyntheticDocs",
  {},
);
console.log(`seeded ${seededDocs.length} researchDocs`);

await convex.action(matchSubject, { assessmentId });
const { reportId, fileId, html, questions } = await convex.action(buildReport, {
  ownerId: OWNER_ID,
  subjectId,
});
console.log(`built report ${reportId} with file ${fileId} and ${questions.length} questions`);

console.log("\nDrafted clinician questions");
table(
  ["basis", "prompt"],
  questions.map((question) => [question.basis, question.prompt.slice(0, 96)]),
);

const sections = [
  "Remi visit brief",
  "Check-in results",
  "What you have noticed",
  "Sources",
  "Questions for your clinician",
];
const missing = sections.filter((section) => !html.includes(section));

check(
  "the stored document is a complete styled HTML report",
  html.startsWith("<!doctype html>") && html.includes("<style>") && missing.length === 0,
  `bytes=${html.length} sections=${sections.length - missing.length}/${sections.length} missing=${missing.join(", ")}`,
);

const POSITIONING =
  "It is not a diagnosis, a screening result, a risk prediction, a medical device, or an emergency service.";
const INSTRUMENT_LABEL = /\bMoCA\b|\bMMSE\b/i;

check(
  "the report carries the informational positioning and never claims a diagnosis",
  html.includes(POSITIONING) && !INSTRUMENT_LABEL.test(html),
  `positioning=${html.includes(POSITIONING)} instrumentLabels=${INSTRUMENT_LABEL.test(html)}`,
);

check(
  "every question is drawn from a reviewed fact and carries its provenance",
  questions.length > 0 &&
    questions.length <= 6 &&
    questions.every(
      (question) =>
        /^(domain:|observation:|insight:|subject:|report:)/.test(question.basis) &&
        question.prompt.trim().length > 0,
    ),
  `questions=${questions.length} bases=${questions.map((question) => question.basis).join(", ")}`,
);

const preview = await convex.query(previewReport, { reportId });
const served = preview.url === null ? null : await fetch(preview.url);
const servedText = served === null ? "" : await served.text();
check(
  "the stored report file opens and serves the same brief",
  served !== null &&
    served.status === 200 &&
    servedText.includes("Remi visit brief") &&
    servedText.includes("Questions for your clinician"),
  `url=${preview.url === null ? "null" : "set"} status=${served?.status ?? "none"} bytes=${servedText.length}`,
);

await convex.mutation(finalize, { reportId, recipient: RECIPIENT });
const finalized = await convex.query(previewReport, { reportId });
check(
  "finalizing records the recipient and settles the report",
  finalized.status === "final" && finalized.recipient === RECIPIENT,
  `status=${finalized.status} recipient=${finalized.recipient}`,
);

const consentId = await convex.mutation(grant, { reportId, recipient: RECIPIENT, scope: SCOPE });
console.log(`granted consent ${consentId}`);

const sent = await convex.action(sendReport, { reportId, recipient: RECIPIENT, scope: SCOPE });
console.log(`sent message ${sent.messageId} on thread ${sent.threadId}`);

check(
  "the send returned an AgentMail message id and a live consent receipt",
  sent.messageId.length > 0 && sent.threadId.length > 0 && sent.consentId === consentId,
  `messageId=${sent.messageId.slice(0, 24)} threadId=${sent.threadId} consentId=${sent.consentId}`,
);

// The message has to reach the recipient's inbox, not just be accepted by the
// send endpoint, so arrival is read back from the receiving inbox itself.
const arrived = await waitFor(
  `message ${sent.messageId} in ${RECIPIENT}`,
  async () => {
    const inbox = await agentMail<{ messages: RawInboxMessage[] }>(
      `/inboxes/${encodeURIComponent(RECIPIENT)}/messages?limit=20`,
    );
    const row = inbox.messages.find(
      (candidate) =>
        candidate.message_id === sent.messageId && candidate.labels.includes("received"),
    );
    return row === undefined ? null : asInboxMessage(row);
  },
);

const deliveredHtml =
  arrived.html ??
  (
    await agentMail<RawInboxMessage>(
      `/inboxes/${encodeURIComponent(RECIPIENT)}/messages/${encodeURIComponent(sent.messageId)}`,
    )
  ).html ??
  "";

check(
  "the brief arrives in the recipient inbox carrying the report",
  deliveredHtml.includes("Remi visit brief") &&
    deliveredHtml.includes("Questions for your clinician") &&
    deliveredHtml.includes(subjectNameIn(html)),
  `labels=${arrived.labels.join(",")} subject=${JSON.stringify(arrived.subject)} bytes=${deliveredHtml.length}`,
);

// AgentMail reports delivery to the webhook, so the row the send wrote is what
// proves the delivery status came back into the record.
const deliveredRow = await waitFor(
  `delivery status for ${sent.messageId}`,
  async () => {
    const row = (await readMessages()).find(
      (candidate) => candidate.agentmailMessageId === sent.messageId,
    );
    return row !== undefined && row.deliveryStatus === "delivered" ? row : null;
  },
);

check(
  "the delivery webhook moved the outbound row to delivered",
  deliveredRow.direction === "outbound" && deliveredRow.body.includes("Remi visit brief"),
  `deliveryStatus=${deliveredRow.deliveryStatus} direction=${deliveredRow.direction} bytes=${deliveredRow.body.length}`,
);

const sign = (payload: string, id: string, timestamp: Date) => new Webhook(webhookSecret).sign(id, timestamp, payload);

const postWebhook = (payload: string, signed: boolean) => {
  const id = `msg_replay_${Date.now()}`;
  const timestamp = new Date();
  return fetch(`${siteUrl}/api/agentmail`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      ...(signed ? { "svix-signature": sign(payload, id, timestamp) } : {}),
    },
    body: payload,
  });
};

// The reply is a real email out of the recipient inbox, so the webhook, the
// classification and the replay are all driven by a delivery AgentMail actually
// made rather than by a synthetic payload.
const replied = await agentMail<{ message_id: string }>(
  `/inboxes/${encodeURIComponent(RECIPIENT)}/messages/${encodeURIComponent(sent.messageId)}/reply`,
  { method: "POST", body: JSON.stringify({ text: REPLY_TEXT, html: `<p>${REPLY_TEXT}</p>` }) },
);
console.log(`replied with ${replied.message_id}`);

// The CLI run is synchronous, so the inbound rows are read straight out.
const inboundRows = () =>
  readMessages().filter((row) => row.agentmailMessageId === replied.message_id);

const classified = await waitFor(
  `classification of ${replied.message_id}`,
  async () => {
    const row = inboundRows()[0];
    return row !== undefined && row.classification !== null ? row : null;
  },
);

const parsed = JSON.parse(classified.classification ?? "{}") as {
  category?: string;
  confidence?: number;
  redFlag?: boolean;
};
const CATEGORIES = [
  "cognitive_concern",
  "mood",
  "functional_change",
  "positive_update",
  "logistics",
];

check(
  "the inbound reply is classified by JEV and the judgement is recorded",
  classified.direction === "inbound" &&
    CATEGORIES.includes(parsed.category ?? "") &&
    typeof parsed.confidence === "number" &&
    typeof parsed.redFlag === "boolean",
  `category=${parsed.category} confidence=${parsed.confidence} redFlag=${parsed.redFlag}`,
);

check(
  "the reply is captured verbatim as an observation-shaped message body",
  classified.body.includes("same question three times"),
  `bytes=${classified.body.length}`,
);

// A replay is the normal case for a webhook, so the same signed event is posted
// twice and the row count plus the untouched classification are what settle it.
const replayEvent = JSON.stringify({
  event_type: "message.received",
  event_id: `evt_replay_${Date.now()}`,
  message: {
    message_id: replied.message_id,
    thread_id: sent.threadId,
    from: RECIPIENT,
    subject: `Re: Remi visit brief for ${subjectNameIn(html)}`,
    text: classified.body,
    timestamp: new Date(classified.receivedAt).toISOString(),
  },
});

const forged = await postWebhook(replayEvent, false);
check(
  "an unsigned delivery is refused before it touches the database",
  forged.status === 400,
  `status=${forged.status}`,
);

const first = await postWebhook(replayEvent, true);
const second = await postWebhook(replayEvent, true);
const replayed = inboundRows();

check(
  "replaying the same webhook delivery twice leaves exactly one record",
  first.status === 204 &&
    second.status === 204 &&
    replayed.length === 1 &&
    replayed[0].classification === classified.classification,
  `statuses=${first.status},${second.status} rows=${replayed.length} classification=${replayed[0]?.classification}`,
);

// The reminder cron mails from the same consent gate the report does, so the
// scan is read at the real clock and then at a clock a week past the check-in.
const remindersNow = runInternal<DueReminder[]>("email/reminders:dueReminders", {
  now: Date.now(),
});
const remindersDue = runInternal<DueReminder[]>("email/reminders:dueReminders", {
  now: Date.now() + WEEK_MS + 1,
});

check(
  "a fresh check-in is not due a reminder",
  remindersNow.length === 0,
  `due=${remindersNow.length} reports=${remindersNow.map((row) => row.reportId).join(", ")}`,
);

check(
  "a check-in a week old is due, addressed to the consented recipient and scope",
  remindersDue.length === 1 &&
    remindersDue[0].reportId === reportId &&
    remindersDue[0].recipient === RECIPIENT &&
    remindersDue[0].scope === SCOPE,
  `due=${remindersDue.length} recipient=${remindersDue[0]?.recipient} scope=${remindersDue[0]?.scope}`,
);

await convex.mutation(revoke, { reportId });
console.log(`revoked consent for report ${reportId}`);

let refusal: { code: string; payload: string };
try {
  await convex.action(sendReport, { reportId, recipient: RECIPIENT, scope: SCOPE });
  refusal = { code: "no_error", payload: "the send was admitted" };
} catch (error) {
  const data = (error as { data?: ConsentDenial }).data;
  refusal =
    data === undefined
      ? { code: "unparsed", payload: String(error) }
      : { code: data.code, payload: JSON.stringify(data) };
}

const afterRevoke = (await readMessages()).filter(
  (row) => row.agentmailMessageId === sent.messageId,
);
check(
  "a revoked consent refuses the next send and sends no second email",
  refusal.code === "consent_revoked" && afterRevoke.length === 1,
  `code=${refusal.code} rows=${afterRevoke.length} payload=${refusal.payload}`,
);

const remindersAfterRevoke = runInternal<DueReminder[]>("email/reminders:dueReminders", {
  now: Date.now() + WEEK_MS + 1,
});
check(
  "a revoked consent takes the reminder off the scan with the report",
  remindersAfterRevoke.length === 0,
  `due=${remindersAfterRevoke.length} reports=${remindersAfterRevoke.map((row) => row.reportId).join(", ")}`,
);

console.log("\nMessages");
table(
  ["direction", "deliveryStatus", "classification", "agentmailMessageId"],
  (await readMessages()).map((row) => [
    row.direction,
    row.deliveryStatus,
    show(row.classification === null ? null : (JSON.parse(row.classification).category as string)),
    row.agentmailMessageId.slice(0, 26),
  ]),
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
