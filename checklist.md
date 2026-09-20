# Checklist

Execution state for Remi. The plan lives in `docs/plan.md`; this file tracks what is done.

Check items off as they land. When something deviates, add one line under that round's Notes instead of leaving it in your head. Rounds run in order. Issues inside a round run in parallel, one agent each, one PR each.

| Round | Theme | Issues |
|---|---|---|
| r1 | Contracts and spine | #1 |
| r2 | Scoring engine and crawl | #2, #4 |
| r3 | Insights and pipeline state | #5, #3 |
| r4 | Consent and report | #7, #6 |
| r5 | Frontend and ship | #8, #9, #10 |

## r1 Contracts and spine

Issues #1. Owners both.

- [x] `shared/contracts.ts` frozen. Adapter signatures and document types.
- [x] `convex/schema.ts` frozen. Tables, indexes, vector index on `researchDocs`.
- [x] `convex/seed.ts` with seed and reset for one synthetic subject.
- [x] Convex project created, every env var set in the dashboard.
- [x] Static. `npx tsc --noEmit` clean.
- [x] Runtime. Seed runs, every table queries clean, the `convex.site` URL loads signed out.
- [ ] PR merged and both builders pulled.

Gate. Every later round is blocked until this lands. Do not start r2 early.

Notes

- All four Convex env vars are set on both deployments: TYPESAFE_API_KEY, FIRECRAWL_API_KEY, AGENTMAIL_API_KEY, AGENTMAIL_WEBHOOK_SECRET. The AgentMail webhook `ep_3JZer7S7YjOnNodx6erCteo3eHF` points at `/api/agentmail` on the prod deployment; the receiving endpoint lands in r4.

## r2 Scoring engine and crawl

Issues #2 keyur, #4 aether. Parallel, disjoint modules.

### #2 Score check-in answers with JEV

- [ ] `convex/jev/adapter.ts` with the five functions, typed against contracts.
- [ ] `convex/jev/scoreAnswer.ts`, one JEV call per answer.
- [ ] `convex/assessments/` start, submit, finish.
- [ ] `convex/scores/` domain rollup and cross-session trend delta.
- [ ] Confidence gate sets `lowConfidence` instead of a number below threshold.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. Scripted assessment persists scores carrying `modelVersion` `jev-1.13.0`, a wrong answer scores low, a weak answer gates.
- [ ] PR merged.

### #4 Crawl trusted sources and capture journal observations

- [ ] `convex/research/crawl.ts` restricted to the allowlist in `refs/resources.md`.
- [ ] `convex/research/store.ts` writes publisher, URL, excerpt, `fetchedAt`, embedding.
- [ ] `convex/observations/` stores structured fields plus the raw note, `reviewed:false`.
- [ ] `convex/crons.ts` created, weekly re-crawl with change tracking.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. `researchDocs` holds a row per allowlisted source and a stored URL opens.
- [ ] PR merged.

Notes

## r3 Insights and pipeline state

Issues #5 keyur, #3 aether. Each consumes the other lane's r2 output.

### #5 Match subject profiles to evidence

- [ ] `convex/research/match.ts` batches one JEV noul per candidate in a single call.
- [ ] `convex/insights/` links subject, evidence, match type, confidence, rationale code.
- [ ] Ranking plus a cutoff so the panel shows a small defensible set.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. Matches point at real `researchDocs` rows, carry rationale codes, and exclude an unrelated finding.
- [ ] PR merged.

### #3 Make the scoring pipeline durable and replayable

- [ ] `convex/workflows/` with the `@convex-dev/workflow` definition.
- [ ] `convex/workflowRuns/` records every transition.
- [ ] Replay fixtures plus the switch that selects replay over live JEV.
- [ ] Error and retry paths with typed validation at the action boundary.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. A run shows its full state trail, and an invalid key lands retryable then failed with the error recorded.
- [ ] PR merged.

Notes

## r4 Consent and report

Issues #7 keyur, #6 aether.

### #7 Gate every send behind explicit consent

- [ ] `convex/consents/` grant with scope, revoke, and the guard the send path calls.
- [ ] The record stores the exact report, recipient, and scope shown at grant time.
- [ ] Query for current consent state per subject.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. Grant, send, revoke, blocked second send. The revoked row keeps its original scope.
- [ ] PR merged.

### #6 Build the visit report and deliver it by email

- [ ] `convex/reports/build.ts`, deterministic render from typed values.
- [ ] Template-drafted clinician questions from reviewed facts only.
- [ ] File storage for the HTML and PDF artifacts.
- [ ] `convex/email/send.ts` with an idempotency key.
- [ ] `convex/http.ts` webhook with signature verification and idempotency on `messages.by_agentmail_message_id`.
- [ ] `convex/email/classify.ts` for JEV reply classification.
- [ ] Reminder cron appended to `convex/crons.ts`. Append only.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. Send to self arrives, a replayed webhook writes one record, a revoked consent refuses the send.
- [ ] PR merged.

### Backend done gate

- [ ] Full loop headless. Seed, score, review, match, report file, send, delivery recorded, reply classified, revoke blocks the next send.
- [ ] Schema and contracts frozen. No further edits without both builders.

Notes

## r5 Frontend and ship

Sequential. #8, then #9, then #10.

### #8 Build the browser shell and check-in flow

- [ ] `src/` shell with routes for dashboard, check-in, journal, trends, report.
- [ ] Sign-in, or a fixed demo user if OTP blocks.
- [ ] Check-in task UIs. jsPsych where stable, plain timers otherwise.
- [ ] Per-answer autosave, live results with loading and low-confidence states.
- [ ] Static. `npx tsc --noEmit` clean and the build succeeds.
- [ ] Runtime. A browser check-in persists and the results screen shows a typed score with its confidence. State survives reload.
- [ ] PR merged.

### #9 Build journal, trends, report, and consent screens

- [ ] Journal form with structured fields plus the raw note.
- [ ] Review screen with per-field correction and JEV classification beside the note.
- [ ] Timeline and domain charts with empty, error, and low-confidence states.
- [ ] Report preview with editable clinician questions.
- [ ] Consent screen showing the exact report, recipient, and scope.
- [ ] Delivery status view covering failed and revoked.
- [ ] Static. `npx tsc --noEmit` clean and the build succeeds.
- [ ] Runtime. All seven journey steps work at 390px and on desktop. Charts never overflow.
- [ ] PR merged.

### #10 Break the loop, record the demo, and submit

- [ ] Failure paths fixed. Duplicate webhook, JEV timeout, stale crawl, revoked consent, failed send.
- [ ] Route freeze. No new routes past this point.
- [ ] Device pass on desktop and at 390px.
- [ ] `hackathon.md` current through `/hackathon`.
- [ ] README with setup, architecture, sponsor roles.
- [ ] Demo recorded under three minutes.
- [ ] Two rehearsals finish under three minutes with no database repair.
- [ ] PR merged.

Notes

## Submission

- [ ] Repo is public at submission time. Private repos are not allowed.
- [ ] Live URL on `convex.site` opens signed out.
- [ ] Video under three minutes attached.
- [ ] Social post tagging @convex @[OI] @firecrawl @agentmail.
- [ ] Submitted at vibeapps.dev before Sept 22, 12:00 PM PT (Sept 23, 12:30 AM IST).
- [ ] No secrets, no real health data, no private addresses in repo, app, or recording.

## Decision log

One line per deviation or call worth remembering. Newest first.

| Date | Decision | Why |
|---|---|---|
| 2026-09-20 | Registered the AgentMail webhook before r4 builds the receiving endpoint | Creating the webhook is the only way to obtain the signing secret; deliveries to `/api/agentmail` fail harmlessly until the endpoint ships in r4. |
| 2026-09-20 | Set all four env vars (TYPESAFE, FIRECRAWL, AGENTMAIL key and webhook secret) on both deployments | Keys arrived during r1; verified each with a live call before recording it as done. |
| 2026-09-20 | Vector index `researchDocs.by_embedding` pinned to 1536 dimensions with a `publisher` filter | No embedding model is named in the plan; 1536 is the common default. Revisit with #5 before the Wave 4 freeze. |
| 2026-09-20 | Added a root GET route in `convex/http.ts` during r1 | `convex.site` 404s with no HTTP actions deployed, and the r1 exit requires the live URL to load signed out. The AgentMail webhook appends here in r4. |
| 2026-09-20 | Set only TYPESAFE_API_KEY in the dashboard | Firecrawl and AgentMail keys do not exist yet; missing names are listed in the PR #11 body, no values invented. |
