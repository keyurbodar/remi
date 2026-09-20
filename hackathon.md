# Hackathon log

- **Project:** Remi
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns memory concerns into repeated, reviewable, evidence-backed preparation for a doctor visit through five minute cognitive check-ins scored by a calibrated decision model.
- **Live app:** https://dutiful-armadillo-316.convex.site
- **Repo:** https://github.com/keyurbodar/remi
- **Frontend:** Convex static hosting
- **Convex deployment:** https://dutiful-armadillo-316.convex.cloud
- **Components:** none
- **Convex features:** schema, tables, indexes, vector search, queries, mutations, actions, internal queries, internal mutations, HTTP actions
- **Auth:** none
- **AI models:** jev-1.13.0 (TypeSafe System One model, called from Convex actions)
- **Started:** 2026-09-19T22:13:08Z
- **Last updated:** 2026-09-20T12:15:29Z

## Log

### 2026-09-19 - 8c2f8c9
Initialized the repo with the execution plan, the verified JEV API contract, integration references, and the JEV adapter skeleton. Five adapter functions typed against the TypeSafe API: answer scoring, trend assessment, escalation recommendation, reply classification, and evidence matching (`lib/jev.ts`, `docs/plan.md`, `refs/`).

### 2026-09-19 - 618cd00
Added AGENTS.md as the standing rulebook for every agent on the repo: coding style, a real-verification doctrine, a six step shipping loop, and the round based execution order (`AGENTS.md`).

### 2026-09-20 - 674fc38
Converted the plan to markdown, added the round checklist with per issue verification, and stripped fallback paths and dual implementations from the plan per a no-fallback policy (`docs/plan.md`, `checklist.md`).

### 2026-09-20 - e5a9b55
Froze the shared contracts and shipped the backend spine. `shared/contracts.ts` holds the adapter signatures and document types. `convex/schema.ts` defines 12 tables with every required index plus a vector index on researchDocs (1536 dims, publisher filter). Idempotent seed and reset for one synthetic subject. Deployed to Convex static hosting and verified: seed returns five document ids, every table queries clean, the live URL serves signed out (`shared/contracts.ts`, `convex/schema.ts`, `convex/seed.ts`, `convex/http.ts`). Convex features: schema, tables, indexes, vector search, mutations, HTTP actions.

### 2026-09-20 - 59d4fb6
Shipped the JEV scoring engine. Every check-in answer gets one JEV call returning a typed calibrated score: correctness probability, anomaly flag, quality level on a 0 to 4 rubric, and a rationale code, persisted with the model version. Confidence gates set lowConfidence instead of emitting a number below threshold, and gated domains roll up to null with an insufficient_evidence rationale. Domain rollups compute as the mean of their answer rows and cross-session trend deltas compute per domain. Verified headless with real JEV calls: a two-session scripted assessment passed 18 assertions, including a deliberately wrong recall answer scoring 0.97 answer_incorrect and a borderline timed answer gating at confidence 0.63 while a solid answer at 0.95 rolled up normally (`convex/jev/`, `convex/assessments/`, `convex/scores/`, `scripts/verify-scoring.ts`). Convex features: actions, internal queries, internal mutations, mutations, indexes.

### 2026-09-20 - dab02f1
Matched subject profiles to stored evidence with JEV. One batched `systemOne` call carries a noul per candidate `researchDocs` row, so a profile plus a candidate set costs a single JEV call, and `convex/insights/rank.ts` turns those probabilities into ranked insight rows: a 0.7 relevance cutoff, a match type derived from which anchor the candidate shares terms with (domain, journal observation, or stated concern), a strong/moderate rationale code, and a top-five cap so the results panel shows a small defensible set. Insights are derived rows, so a re-run replaces the subject's set instead of appending. Fixed a real adapter defect the runtime run caught: the batched question asked about "this finding" over a state holding every finding, so the model answered a coin flip for the whole batch (0.71 and 0.70 on a relevant page and an off-topic page, both over the cutoff). Naming the finding by its state path moved the same pair to 0.97 and 0.04. Verified headless against the isolated dev deployment: 8/8 assertions, three insights citing real `researchDocs` rows with publisher, URL and `fetchedAt`, and the off-topic page excluded at 0.05 (`convex/research/match.ts`, `convex/insights/`, `convex/jev/adapter.ts`, `scripts/verify-insights.ts`).
