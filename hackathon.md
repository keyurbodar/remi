# Hackathon log

- **Project:** Remi
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns memory concerns into repeated, reviewable, evidence-backed preparation for a doctor visit through five minute cognitive check-ins scored by a calibrated decision model.
- **Live app:** https://dutiful-armadillo-316.convex.site
- **Repo:** https://github.com/keyurbodar/remi
- **Frontend:** Convex static hosting
- **Convex deployment:** https://dutiful-armadillo-316.convex.cloud
- **Components:** workflow (durable scoring runs)
- **Convex features:** schema, tables, indexes, vector search, queries, mutations, actions, internal queries, internal mutations, HTTP actions, durable workflows
- **Auth:** none
- **AI models:** jev-1.13.0 (TypeSafe System One model, called from Convex actions)
- **Started:** 2026-09-19T22:13:08Z
- **Last updated:** 2026-09-20T13:45:00Z

## Log

### 2026-09-19 - 8c2f8c9
Initialized the repo with the execution plan, the verified JEV API contract, integration references, and the JEV adapter skeleton. Five adapter functions typed against the TypeSafe API: answer scoring, trend assessment, escalation recommendation, reply classification, and evidence matching (`lib/jev.ts`, `docs/plan.md`, `refs/`).

### 2026-09-19 - 618cd00
Added AGENTS.md as the standing rulebook for every agent on the repo: coding style, a real-verification doctrine, a six step shipping loop, and the round based execution order. Extended it with the no-fallback policy and the tracking checklist (`AGENTS.md`, `checklist.md`).

### 2026-09-20 - 674fc38
Converted the plan to markdown, added the round checklist with per issue verification, and stripped fallback paths and dual implementations from the plan per a no-fallback policy. Fixed the JEV env var name to match the SDK default (`docs/plan.md`, `checklist.md`, `AGENTS.md`).

### 2026-09-20 - e5a9b55
Froze the shared contracts and shipped the backend spine. `shared/contracts.ts` holds the adapter signatures and document types. `convex/schema.ts` defines 12 tables with every required index plus a vector index on researchDocs (1536 dims, publisher filter). Idempotent seed and reset for one synthetic subject. Deployed to Convex static hosting and verified: seed returns five document ids, every table queries clean, the live URL serves signed out (`shared/contracts.ts`, `convex/schema.ts`, `convex/seed.ts`, `convex/http.ts`). Convex features: schema, tables, indexes, vector search, mutations, HTTP actions.

### 2026-09-20 - 59d4fb6
Shipped the JEV scoring engine. Every check-in answer gets one JEV call returning a typed calibrated score: correctness probability, anomaly flag, quality level on a 0 to 4 rubric, and a rationale code, persisted with the model version. Confidence gates set lowConfidence instead of emitting a number below threshold, and gated domains roll up to null with an insufficient_evidence rationale. Domain rollups compute as the mean of their answer rows and cross-session trend deltas compute per domain. Verified headless with real JEV calls: a two-session scripted assessment passed 18 assertions, including a deliberately wrong recall answer scoring 0.97 answer_incorrect and a borderline timed answer gating at confidence 0.63 while a solid answer at 0.95 rolled up normally (`convex/jev/`, `convex/assessments/`, `convex/scores/`, `scripts/verify-scoring.ts`). Convex features: actions, internal queries, internal mutations, mutations, indexes.

### 2026-09-20 - ecb526d
Matched subject profiles to stored evidence with JEV. One batched call carries a noul per candidate researchDocs row, and `convex/insights/rank.ts` turns those probabilities into ranked insight rows: a 0.7 relevance cutoff, a match type derived from which anchor the candidate shares terms with, a strong or moderate rationale code, and a top-five cap. Every insight cites a real researchDocs row with publisher, URL, excerpt, and fetch time. The runtime run caught a real adapter defect: the batched question asked about "this finding" over a state holding every finding, so the model answered a coin flip for the whole batch (0.71 and 0.70 on a relevant page and an off-topic page, both over the cutoff). Naming the finding by its state path moved the same pair to 0.97 and 0.04. Verified headless: 8/8 assertions, three insights citing real researchDocs rows, the off-topic page excluded at 0.05 (`convex/research/match.ts`, `convex/insights/`, `convex/jev/adapter.ts`, `scripts/verify-insights.ts`). Convex features: actions, internal queries, internal mutations, indexes.

### 2026-09-20 - eda2dff
Made the scoring pipeline durable and observable. Scoring now runs as a `@convex-dev/workflow` definition (`convex/workflows/scoring.ts`) that reads the answers a check-in still owes a score, scores each one with one JEV call per attempt, then rolls the scores up per domain. Every state transition lands in `workflowRuns`, our own table rather than the component's logs, so a run reads back as queued, running, per-step running and succeeded, and a closed terminal row. Retries are explicit: two retries with backoff after the first attempt, each attempt writing retryable with the model's error text before the next one starts, then failed with the same error on the step row and the run row. The step action is the typed boundary: JEV's quality and confidence are checked against the ranges shared/contracts.ts declares before the run treats an answer as scored, and a re-triggered run picks up only the answers still missing a score, so a retry cannot double-score. Verified headless against a live deployment: 20/20 assertions, a six-answer check-in producing a 19-row trail that ends succeeded with six scores in the database, and the same run with a rejected JEV key landing retryable, retryable, failed with `401 Cannot authenticate with the server` recorded on both the step row and the run row and the rollup never reached (`convex/workflows/`, `convex/workflowRuns/`, `convex/convex.config.ts`, `scripts/verify-workflow.ts`). Convex features: durable workflows, components, actions, internal actions, internal queries, internal mutations, mutations, indexes.

### 2026-09-20 - r4 consent gate (#7)
Gated every send behind explicit, scoped, revocable consent. `convex/consents/guard.ts` is an internal query the send path calls through `ctx.runQuery`: it resolves the live grant for a report, refuses with a typed `ConvexError` carrying `{ code, reportId }` (`consent_missing`, `consent_revoked`, `recipient_mismatch`, `scope_mismatch`), and returns a receipt only when the recipient and scope about to be sent match what was granted. `grant` records the exact report, recipient and scope shown at grant time and refuses anything but a settled `final` report; `revoke` takes a report and closes every live grant for it; `consentState` reads current consent per subject. An adversarial review then reproduced an admit-after-revoke in the row-scoped revoke (two live grants, revoke the one the client held, and the send still went out), so revoke became report-scoped and the fix is asserted as a regression. Verified headless against the isolated deployment: 18 assertions covering the missing grant, the admitted send, both mismatch refusals, the blocked second send, and the revoked row keeping its original scope (`convex/consents/`, `scripts/verify-consent.ts`). Convex features: schema, indexes, queries, mutations, internal queries, internal mutations.

