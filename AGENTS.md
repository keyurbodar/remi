# Remi

Remi turns memory concerns into repeated, reviewable, evidence-backed preparation for a doctor visit. A person worried about their own or a parent's memory runs a five minute check-in, journals real incidents, watches trends, and leaves with a doctor-ready brief. Built for the Convex All Gas Hackathon. Submit at vibeapps.dev before Sept 22, 12:00 PM PT (Sept 23, 12:30 AM IST).

I build this solo. The execution plan lives in `docs/plan.md` and is the source of truth. Execution state lives in `checklist.md`. References live in `refs/`. Read those before guessing at intent.

## Positioning (never break this)

Remi is informational. It is not a diagnosis, a screening result, a risk prediction, a medical device, or an emergency service. Never label tasks as MoCA or MMSE. JEV confidence describes model certainty for a typed output, never disease probability. Route people to professionals when signals or uncertainty say so.

## Skills

- Always create real verification. Typechecking and no syntax errors does not mean it works. Build pre-verification tools with /skill:create-verification-skill and maintain them with /skill:maintain-verification-skill.
- Run /hackathon while building so `hackathon.md` stays current. Judges read that build log.

## Shipping

Every task ships through the same loop, regardless of size.

1. Verify against the real artifact first. A scored JEV call, a sent email, a deployed URL. Typecheck alone proves nothing.
2. Run the verification suite. Under 5 minutes, parallel, no duplicates.
3. Commit with a plain conventional title. One concern per commit.
4. Deploy to convex.site and confirm the live URL serves the change.
5. Update `hackathon.md` via /hackathon so the judge-facing build log stays current.
6. Record the trail with /skill:show-me-your-work.

Track all of it in `checklist.md`. Check items off as they land, add one line under the round's Notes when something deviates, and log the call in the decision table when it changes the plan. A round is done only when its whole block is checked, including the runtime line. Do not start the next round with an unchecked box behind you.

## Verification

- Verify against the real artifact. A scored JEV call, a sent email, a deployed URL. Not a proxy.
- Verification suites run under 5 minutes, never duplicate each other, run in parallel, and are programmed as scripts in `scripts/`, not manual checklists.
- Backend waves prove themselves headless. A scripted run through the Convex dashboard counts. No UI needed.
- If repeating the same action is not making progress toward the goal, stop and reassess. Blind looping is worse than stopping.

## Coding style

- Refactor into meaningful file names and variable names. Understandable but not long. Must not look AI generated.
- No redundant variable initializations or function calls. Compose in one pass. `c = g(f(a))`, not `b = f(a)` then `c = g(b)`.
- A function under 20 lines used once gets inlined. Over 20 lines, refactor on need. Under 20 lines used more than once, make it a function.
- Strict ordering inside files. Imports, then enums, then structs, then logic.
- No em dashes anywhere. Code, comments, commits, docs.
- No fallbacks. No backward compatibility. No shims, no deprecated aliases, no dual code paths for "just in case". Rewrite the caller and delete the old path in the same change.
- Follow YAGNI. Prefer one line solutions. If it adds no impact, it is bloat and it does not ship.
- Inferred types over annotations. Make illegal states unrepresentable.

## Parallelism

- Work in parallel as much as possible. Use background agents when available. Use more agents when multiple requests arrive.
- Assigning tasks to background agents is not a reason to stop. I work one of the assigned tasks too.
- Two changes to one file go to the same agent, or land as one edit. Never two sequential edit passes on the same file for two features.

## Architecture

Backend ships first and proves itself headless (Waves 1 to 4). Frontend wires the proven backend last (Waves 5 to 7). Schema and contracts freeze when Wave 4 exits.

```
remi/
├── docs/plan.md          # execution plan, source of truth
├── checklist.md          # round by round execution state, notes live here
├── refs/                 # resources.md, jev-api.md, integrations.md
├── lib/jev.ts            # JEV adapter, moves into convex/jev/ at scaffold
├── shared/contracts.ts   # adapter signatures + doc types, frozen after Wave 1
├── convex/               # backend, Phase B
│   ├── schema.ts         # tables + indexes, the only shared surface
│   ├── jev/              # adapter + scoring workflow
│   ├── assessments/      # check-in mutations + queries
│   ├── observations/     # journal entries, structured fields + raw note
│   ├── research/         # Firecrawl crawl, researchDocs, vector search
│   ├── reports/          # report builder + file storage
│   ├── email/            # AgentMail send, reply ingestion
│   ├── http.ts           # /api/agentmail webhook, signature verified
│   └── crons.ts          # weekly re-crawl, check-in reminders
├── src/                  # frontend, Phase F
│   ├── routes/           # dashboard, checkin, journal, trends, report
│   └── components/
└── scripts/              # seed, reset, verification tools
```

## JEV

- JEV owns every typed decision. Scoring, trend deltas, escalation, evidence matching, reply classification. Primitives are noul, choice, score.
- Nothing in the product calls a text generating LLM. Reports and questions render from typed values through templates.
- Batch independent questions over the same state into one call.
- The key stays server side. Call JEV only from Convex actions.
- Verified contract and live-call evidence live in `refs/jev-api.md`. The adapter is `lib/jev.ts` until it moves to `convex/jev/`.
- Fallback rule. If JEV is unreachable, the same five adapter functions get re-implemented over a structured output LLM. Callers never change.

## Stack rules

- Convex owns all state, logic, realtime, crons, files, http actions. Frontend deploys to convex.site. No localhost submissions.
- Firecrawl crawls only the allowlisted health sources in `refs/resources.md`. Every citation stores publisher, URL, excerpt, fetchedAt.
- AgentMail sends with idempotency keys. The inbound webhook verifies signatures before touching data.
- Env vars live in the Convex dashboard, never in the repo. TYPESAFE_API_KEY, FIRECRAWL_API_KEY, AGENTMAIL_API_KEY, AGENTMAIL_WEBHOOK_SECRET, VITE_CONVEX_URL.

## Taste

- The smallest model that makes correct behavior unsurprising. Fight scope creep. YAGNI.
- No fallbacks, no backward compatibility, no compatibility layers. Never write them.
- Nothing ships because it might be useful later. Unused flexibility is bloat.
- Complexity belongs at adapter boundaries. Business logic stays pure. UI stays dumb.
- Comments describe how a thing is used, not what a line does. If code can say it, delete the comment.
- If a rule here fights the task, say so and get a human decision before breaking it.

## References

- Plan: `docs/plan.md`. Waves, ownership, acceptance criteria, freeze rules.
- Checklist: `checklist.md`. Rounds, issue checkboxes, and the notes log.
- `refs/resources.md` for cognitive content sources, the crawl allowlist, and links.
- `refs/jev-api.md` for the verified JEV contract.
- `refs/integrations.md` for Firecrawl, AgentMail, and Convex notes.
- Hackathon rules: new app on a Convex backend, public GitHub repo, live URL on convex.site that opens signed out, video under 3 minutes, social post tagging @convex @OpenAI @firecrawl @agentmail, submit at vibeapps.dev before the deadline.
