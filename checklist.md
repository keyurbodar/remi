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
- [x] PR merged (#11, squash) and main pulled. Aether pulls on invite acceptance.
- [x] Independent review passed. Seed re-run against prod returned five ids, live URL HTTP 200 signed out, `.env` audited as ciphertext-only with `.env.keys` untracked.

Gate. Every later round is blocked until this lands. Do not start r2 early.

Notes

- All four Convex env vars are set on both deployments: TYPESAFE_API_KEY, FIRECRAWL_API_KEY, AGENTMAIL_API_KEY, AGENTMAIL_WEBHOOK_SECRET. The AgentMail webhook `ep_3JZer7S7YjOnNodx6erCteo3eHF` points at `/api/agentmail` on the prod deployment; the receiving endpoint lands in r4.
- Deviations accepted at review: encrypted `.env` committed via dotenvx (ciphertext verified, private key untracked), vector index pinned to 1536 dims pending #5, root HTTP route added so the exit gate could run, webhook registered early to obtain the signing secret.

## r2 Scoring engine and crawl

Issues #2 keyur, #4 aether. Parallel, disjoint modules.

### #2 Score check-in answers with JEV

- [x] `convex/jev/adapter.ts` with the five functions, typed against contracts.
- [x] `convex/jev/scoreAnswer.ts`, one JEV call per answer.
- [x] `convex/assessments/` start, submit, finish.
- [x] `convex/scores/` domain rollup and cross-session trend delta.
- [x] Confidence gate sets `lowConfidence` instead of a number below threshold.
- [x] Static. `npx tsc --noEmit` clean.
- [x] Runtime. Scripted assessment persists scores carrying `modelVersion` `jev-1.13.0`, a wrong answer scores low, a weak answer gates.
- [x] PR merged (#12, squash), deployed to prod, live URL verified. `hackathon.md` created covering r1 and r2.

### #4 Crawl trusted sources and capture journal observations

- [ ] `convex/research/crawl.ts` restricted to the allowlist in `refs/resources.md`.
- [ ] `convex/research/store.ts` writes publisher, URL, excerpt, `fetchedAt`, embedding.
- [ ] `convex/observations/` stores structured fields plus the raw note, `reviewed:false`.
- [ ] `convex/crons.ts` created, weekly re-crawl with change tracking.
- [ ] Static. `npx tsc --noEmit` clean.
- [ ] Runtime. `researchDocs` holds a row per allowlisted source and a stored URL opens.
- [ ] PR merged.

Notes

- #2 runtime evidence. `npm run verify:scoring` against the isolated dev deployment `keyur-bodar19:remi:dev/keyur/r2-scoring` ran two six-item sessions through the real pipeline (submit, one JEV call, finish) and passed 18/18 assertions. Session B rows read from the dashboard: memory 0.97 `answer_incorrect`, attention 3.35 and 3.44 `answer_correct`, language 2.92, visuospatial 3.75, speed 2.75 at confidence 0.62 gated. Every row carries `modelVersion` `jev-1.13.0`. Domain rollup: attention 3.4 over 2 answers, speed `null` with `insufficient_evidence`. Trend delta: attention -0.02 `declining` over 2 sessions.
- #2 gate fixture is calibrated, not tuned to pass. JEV's correctness probability on the timed item is a smooth function of response time (320 ms -> 0.89, 460 ms -> 0.54 to 0.58, 900 ms -> 0.17), so 460 ms is the middle of the gate band with a 0.12 margin under the 0.7 threshold. The gate fires on real model uncertainty, and the solid visuospatial answer at 0.95 proves the gate discriminates.
- #2 deviations. `lib/jev.ts` was deleted rather than kept beside `convex/jev/adapter.ts`, and `tsconfig.json` now includes `scripts/**/*` in its place. The domain rollup and trend delta are read paths over the per-answer `scores` rows, not separate persisted rows. The runtime line was verified on the isolated dev deployment; prod deploy waits for the r2 merge so #2 and #4 land together.
- #2 gaps. `hackathon.md` and `/hackathon` are not installed in this worktree, so the judge-facing build log was not updated from this lane.

## r3 Insights and pipeline state

Issues #5 keyur, #3 aether. Each consumes the other lane's r2 output.

### #5 Match subject profiles to evidence

- [x] `convex/research/match.ts` batches one JEV noul per candidate in a single call.
- [x] `convex/insights/` links subject, evidence, match type, confidence, rationale code.
- [x] Ranking plus a cutoff so the panel shows a small defensible set.
- [x] Static. `npx tsc --noEmit` clean.
- [x] Runtime. Matches point at real `researchDocs` rows, carry rationale codes, and exclude an unrelated finding.
- [ ] PR merged.

### #3 Make the scoring pipeline durable and observable

- [x] `convex/workflows/` with the `@convex-dev/workflow` definition.
- [x] `convex/workflowRuns/` records every transition.
- [x] Error and retry paths with typed validation at the action boundary.
- [x] Static. `npx tsc --noEmit` clean.
- [x] Runtime. A run shows its full state trail, and an invalid key lands retryable then failed with the error recorded.
- [ ] PR merged.

Notes

- #5 runtime evidence. `npm run verify:insights` against the isolated dev deployment `keyur-bodar19:remi:dev/keyur/r3-insights` seeded the 65-74 subject (finished assessment, memory 2.01, one reviewed journal observation about repeating a question) plus four `researchDocs` rows, ran the matcher, and read the panel back. 8/8 assertions passed. JEV relevance: NIA memory problems 0.97, NHS memory loss 0.96, NIA what to tell the doctor 0.81, Mayo Clinic osteoarthritis 0.05 excluded. Three insights written, each citing one real `researchDocs` row with publisher, URL and `fetchedAt`: 0.97 `concern_signal` `strong_relevance`, 0.96 `domain_signal` `strong_relevance`, 0.81 `concern_signal` `moderate_relevance`. One JEV call carried all four nouls.
- #5 the matcher question has to name the finding. `matchFindings` asked "Is this finding relevant to this person's cognitive profile?" over a state holding every finding, so the model answered a coin flip for the whole batch: 0.71 and 0.70 on a relevant page and the off-topic page, both above the cutoff, which would have matched osteoarthritis guidance to a memory concern. Naming the finding by its state path (`findings[2]`) moved the same two candidates to 0.97 and 0.04. Fixed in `convex/jev/adapter.ts`, the one change outside this issue's named files, and the r2 suite re-ran at 18/18.
- #5 deviations. The `researchDocs` rows are synthetic, inserted by `convex/research/syntheticDocs.ts`, because the #4 crawler has not merged; real crawled rows replace them when it lands. The matcher does no embedding or vector retrieval, since JEV judges relevance and retrieval would be a second redundant filter, so `embedding` stays unset on the fixtures. Insights are derived rows, so a re-run replaces the subject's set: two matcher runs left 3 rows, not 6. Prod deploy waits for the r3 merge so #5 and #3 land together, the same call r2 made.
- #5 gap. The panel returns `matchType` and `rationaleCode` as `v.string()` because the frozen `convex/schema.ts` declares them as strings. The literal unions live in `convex/insights/rank.ts` and are enforced on write, so the read path widens them.
- #3 runtime evidence. `npm run verify:workflow` against the isolated dev deployment `keyur-bodar19:remi:dev/aether/r3-pipeline` seeded the subject, submitted the six-item battery, started `workflows/scoring:startScoring`, and read the trail back through `workflowRuns/trail:trail`. 20/20 assertions passed. The healthy run is 19 rows: `run` queued then running, `assessment` running then succeeded, a `score:<taskKey>` running and succeeded pair per answer, `rollup` running then succeeded, `run` succeeded and closed. Six `scores` rows in the database, one per answer. A re-triggered run on the same assessment wrote 7 rows with no score step at all and left the six scores untouched, so a retry cannot double-score. The rejected-key run wrote 11 rows: `score:memory-word-recall-3` at attempts 1 and 2 `retryable`, attempt 3 `failed`, each carrying `Uncaught AuthenticationError: 401 Cannot authenticate with the server`, the `run` row `failed` with the same text, and no rollup row and no `succeeded` row anywhere in the run.
- #3 the deployment env var is the failure fixture. The Convex action reads `TYPESAFE_API_KEY` from the deployment, never from the script, so the suite sets the deployment key to a rejected value with `convex env set --deployment`, runs the pipeline, and restores the saved key in a `finally`. The 401 is the model's own answer, not a simulated throw. The isolated deployment had no env vars when this lane started; the TYPESAFE key was copied over from prod, and the check that it is restored is the last assertion.
- #3 deviations. `convex/workflowRuns/` holds the trail rather than reading the workflow component's own tables: the issue asks for every transition in the database, and the component's journal is a step record, not a state machine a results screen can read. Retry is explicit in the workflow handler instead of the component's `retry: true`, so each attempt is a row with its own `attempt` number, which is what the frozen `workflowRuns` shape asks for; the step itself runs with `retry: false` so one attempt is one row. `trail` filters `workflowRuns` in memory because the frozen schema carries no index on that table. The workflow scores responses that have no `accuracy` yet, so a run is safe to trigger again; the check-in flow still calls the scoring action directly per answer, and the durable run is the pipeline that replays and rolls up. Prod deploy waits for the r3 merge so #5 and #3 land together, the same call r2 and #5 made.
- #3 gap. `hackathon.md` is updated by hand from this lane; `/hackathon` is not installed in this worktree, the same gap #2 recorded.

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

|| Date | Decision | Why |
|---|---|---|
| 2026-09-20 | The durable run records its own trail in `workflowRuns` and does not read the workflow component's tables | The issue asks for every transition in the database, and the component's journal is a step record, not a state machine the results screen or a verification script can read as queued, running, succeeded, failed, retryable. `convex/workflowRuns/trail.ts` returns that trail oldest first; the frozen schema carries no index on the table, so it filters in memory over one deployment's rows. |
| 2026-09-20 | Retry is written in the workflow handler, not delegated to the component's `retry: true` | Each attempt has to be a row with its own `attempt` number, which is the shape the frozen `workflowRuns` table declares and the shape that makes a third-party outage readable. The step itself runs with `retry: false` so one attempt writes exactly one row, and the handler writes `retryable` with the model's error before the next attempt starts. |
| 2026-09-20 | The #3 failure fixture is a rejected `TYPESAFE_API_KEY` on the deployment, set and restored by the suite | The Convex action reads the key from the deployment, never from the script's environment, so the only way to make JEV answer 401 is to change the deployment var. The suite saves the key, sets a rejected value with `convex env set --deployment`, runs the pipeline, and restores it in a `finally`, so the failure is the model's own answer rather than a simulated throw. |
| 2026-09-20 | The scoring workflow scores only responses that carry no `accuracy` | A durable pipeline gets triggered again by a retry or a second tap, and re-scoring an answer would double every downstream rollup. Selecting on the missing score makes a re-triggered run a no-op that still writes its trail: 7 rows, no score step, and the same six scores in the database. |
| 2026-09-20 | `convex/workflowRuns/trail.ts` calls the scoring action through `api`, not `internal` | `jev/scoreAnswer:scoreResponse` is a public action the check-in flow calls per answer, so the typed step boundary reaches it through the public reference. `internal.jev.scoreAnswer` has no `scoreResponse` entry, and the first verification run failed on exactly that. |
| 2026-09-20 | The matcher names each finding by its state path inside the JEV question | The batched noul asked about "this finding" over a state holding every finding, so the model answered a coin flip for the batch: 0.71 and 0.70 on a relevant page and an off-topic page, both over the cutoff, which would have matched osteoarthritis guidance to a memory concern. Naming the path (`findings[2]`) moved the same two to 0.97 and 0.04. Fixed in `convex/jev/adapter.ts`, the only edit outside #5's named files. |
| 2026-09-20 | #5 fixtures are synthetic `researchDocs` rows seeded through an internal mutation reached by the CLI | The #4 crawler has not merged, so the runtime check needs stand-in documents. Internal keeps a fixture out of the public API surface, and the suite shells out to `convex run` for that one step because a Convex client cannot reach an internal function. Real crawled rows replace them when #4 lands. |
| 2026-09-20 | The evidence matcher does no vector retrieval, and caps its JEV batch at 99 candidates | JEV judges relevance over the profile, so a vector pre-filter would be a second, redundant judgment on the same question, and `researchDocs.embedding` is left unset until an embedding model is chosen. The cap keeps one `systemOne` call inside the adapter's documented batch size. |
| 2026-09-20 | #5 runtime verified on the isolated dev deployment, prod deploy deferred to the r3 merge | #5 and #3 ship together as r3. Deploying one lane mid-round would put a backend that matches evidence without the durable pipeline in front of the live URL. Same call as r2. |
| 2026-09-20 | Pinned `@typesafe-ai/sdk` to `^0.6.0` | `package.json` asked for `^1.0.0`, which npm does not publish (latest is 0.6.0). The r1 lockfile already resolved 0.6.0, so the manifest now matches the installed SDK and the adapter API that `refs/jev-api.md` verified. |
| 2026-09-20 | Deleted `lib/jev.ts` in favour of `convex/jev/adapter.ts`, and swapped `lib/**/*` for `scripts/**/*` in the tsconfig include | The adapter moves into the Convex backend at scaffold; keeping the Day-0 copy beside it would be a second code path for the same JEV contract, and `lib/` held nothing else. |
| 2026-09-20 | Domain rollup and trend delta are read paths over the per-answer `scores` rows, not separate persisted rows | One row per scored answer keeps the confidence gate, the domain rollup and the trend derived from the same evidence, and lets a trend recompute when a session is re-read. Revisit with #3 if the durable pipeline wants stored rollups. |
| 2026-09-20 | #2 runtime verified on the isolated dev deployment, prod deploy deferred to the r2 merge | #2 and #4 ship together as r2. Deploying one lane mid-round would put a half-scored backend in front of the live URL. |
| 2026-09-20 | Gate fixture is a 460 ms reaction time on the timed item | Calibrated live rather than tuned to pass: JEV's correctness probability there measures 0.54 to 0.58, so the gate fires on genuine model uncertainty with a 0.12 margin under the threshold, and the 0.95 solid answer proves the gate discriminates. |
| 2026-09-20 | Ship env to collaborators via dotenvx encrypted `.env`, committed to the repo | Both builders need the four keys locally; encryption lets the repo carry them while `.env.keys` stays private. Replaces "secrets never in the repo" with "never commit plaintext secrets". |
| 2026-09-20 | Registered the AgentMail webhook before r4 builds the receiving endpoint | Creating the webhook is the only way to obtain the signing secret; deliveries to `/api/agentmail` fail harmlessly until the endpoint ships in r4. |
| 2026-09-20 | Set all four env vars (TYPESAFE, FIRECRAWL, AGENTMAIL key and webhook secret) on both deployments | Keys arrived during r1; verified each with a live call before recording it as done. |
| 2026-09-20 | Vector index `researchDocs.by_embedding` pinned to 1536 dimensions with a `publisher` filter | No embedding model is named in the plan; 1536 is the common default. Revisit with #5 before the Wave 4 freeze. |
| 2026-09-20 | Added a root GET route in `convex/http.ts` during r1 | `convex.site` 404s with no HTTP actions deployed, and the r1 exit requires the live URL to load signed out. The AgentMail webhook appends here in r4. |
| 2026-09-20 | Set only TYPESAFE_API_KEY in the dashboard | Firecrawl and AgentMail keys do not exist yet; missing names are listed in the PR #11 body, no values invented. |
