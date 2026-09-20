# JEV API: verified contract

Verified with a live call on 19 Sep 2026 (see "Verified result" below).

## Endpoint

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```

## Request

```json
{
  "state": { "...application state: object, array, or plain string" },
  "model": "jev-latest",
  "questions": {
    "<question-id>": { "...typed Question: id is code-only, never sent to the model" }
  }
}
```

## Question types (primitives)

| Type | Shape | Answer |
|---|---|---|
| **noul** (yes/no) | `{ type:"noul", instructions, criteria?: { true?, false? } }` | `{ type:"noul", noul: 0..1 }`. Probability of yes; no separate confidence field |
| **choice** | `{ type:"choice", instructions, criteria: { option: desc\|null } }` | `{ choice, probabilities{option: p}, confidence }`. Full distribution |
| **score** | `{ type:"score", instructions, criteria: [ordered levels, ≥2] }` | `{ score (probability-weighted, can land between levels), legend{}, probabilities{}, confidence }` |

## Rules (from the TypeSafe skill + docs)

- Batch **independent questions over the same state** into ONE call: parallel sampling, no cross-contamination.
- Question ids are for code only: put complete meaning in `instructions`/`criteria`.
- Reference nested state with backticked paths: `ticket.messages[0].text`.
- Include a no-match outcome when nothing may fit.
- Thresholds (e.g. red-flag > 0.7) are starting points. Calibrate on real sessions.
- **API key stays server-side**: call only from Convex actions, never client bundles.
- SDK: `npm i @typesafe-ai/sdk` (Node 20+); `new TypeSafeClient()` reads `TYPESAFE_API_KEY`.

## Verified live result (19 Sep 2026)

Input: word-recall item. Expected "apple, penny, table", user answered "apple, table, chair", responseMs 6100.

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "correct": { "type": "noul", "noul": 0.07 },
    "quality": {
      "type": "score", "score": 2.01, "confidence": 0.99,
      "probabilities": { "0": 0.0, "1": 0.0, "2": 0.99, "3": 0.01, "4": 0.0 }
    }
  },
  "usage": { "input_tokens": 449, "output_tokens": 33 }
}
```

Read: correctly judged wrong (93% wrong) but quality = "Partial" (2/3 words right, 0.99 confidence). Calibrated + typed, exactly as documented. Round-trip ~1.2s from laptop incl. TLS; lower server-side from Convex.

## Adapter

`lib/jev.ts`: five functions (scoreAnswer, assessTrend, recommendEscalation, classifyReply, matchFindings). Moves into `convex/jev/` at scaffold.
