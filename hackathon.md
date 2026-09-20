# Remi

Remi turns memory concerns into repeated, reviewable, evidence-backed preparation for a doctor visit. A person worried about their own or a parent's memory runs a five minute check-in, journals real incidents, watches trends, and leaves with a doctor-ready brief.

**Live URL:** https://dutiful-armadillo-316.convex.site
**Demo video:** lands with the final submission.

## What is built so far

### r1. The backend spine

- Frozen data contract in `shared/contracts.ts`: adapter signatures for JEV, Firecrawl, and AgentMail, plus one document type per table. Every later module imports from it.
- Full Convex schema. 12 tables, every required index, and a vector index on `researchDocs` (1536 dims, publisher filter) for evidence matching.
- Idempotent seed and reset with one synthetic subject and a finished assessment.
- Deployed and verified: seed runs, all tables query clean, the live URL serves signed out.

### r2. The JEV scoring engine

- Every check-in answer gets a typed, calibrated score from Jev (`jev-1.13.0`): correctness probability, anomaly flag, quality level on a 0 to 4 rubric, and a rationale code. One JEV call per answer.
- Confidence gates. Below threshold, the score carries `lowConfidence` and the domain rollup reports `insufficient_evidence` instead of a number. The product says "not enough signal" rather than guessing.
- Domain rollups are the mean of their answer rows. Cross-session trend deltas compute per domain.
- Verified headless with real JEV calls: `npm run verify:scoring`, 18 assertions, two sessions. A deliberately wrong recall answer scores 0.97 `answer_incorrect`. A borderline timed answer gates at confidence 0.63 while a solid one at 0.95 rolls up normally.

### Landing next

Evidence crawl and journal observations (r2/r3), insights matching, the visit report, consent, and the AgentMail loop, then the browser on top of the proven backend.

## Stack

- **Convex.** Database, functions, durable workflow, crons, file storage, http actions, static hosting, realtime sync. The whole backend runs on it.
- **TypeSafe JEV.** Every typed decision in the product: answer scoring, domain rollups, trend deltas, confidence gates, evidence matching, reply classification. Calibrated probabilities, no hallucinated prose.
- **Firecrawl.** Crawls an allowlist of trusted health sources only (NIA, alz.org, NHS, Mayo Clinic, PubMed). Every citation stores publisher, URL, excerpt, and fetch time.
- **AgentMail.** Check-in reminders, doctor-ready report delivery, and inbound reply capture. The email thread doubles as the longitudinal record.

No text-generating LLM exists anywhere in the product. Reports and clinician questions render from typed values through templates.

## Architecture

```
browser (profile, check-in, journal, review, consent)
  -> Convex (persist, workflow, realtime UI)
  -> JEV (typed scoring, classification, calibration)
  -> Firecrawl (trusted evidence + citations)
  -> Report + AgentMail (preview, consent, delivery, reply)
```

Full plan in `docs/plan.md`. Round by round execution state in `checklist.md`.

## Safety

Remi is informational. It is not a diagnosis, a screening result, a risk prediction, or a medical device. JEV confidence describes model certainty for a typed output, never disease probability. Low confidence renders as "not enough signal" and routes people to professional evaluation.
