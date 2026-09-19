# Integrations quick reference

## Firecrawl (evidence grounding)

- **/scrape** — URL → clean markdown/JSON; `maxAge` caching for speed
- **/search** — web search with content in results
- **JSON extract mode** — structured facts from a page via LLM (`/features/llm-extract`)
- **Change tracking** — diff between scrapes; powers the weekly re-crawl cron
- **Batch scrape** — multiple URLs in one job
- Webhooks available for long crawls

Our rule: crawl action is **allowlist-only** (see `resources.md`); every fact stored with publisher, URL, excerpt, `fetchedAt`.

## AgentMail (email in/out)

- npm package: `agentmail` (TypeScript SDK)
- One inbox per user at signup; reminders + report delivery out; replies in
- **Send:** `messages.send` with Idempotency-Key header — duplicate brief sends impossible
- **Receive:** webhook `message.received` → our Convex httpAction `/api/agentmail`
- **Verify webhook signatures** — see docs/webhook-verification.md; secret in `AGENTMAIL_WEBHOOK_SECRET`
- Delivery events (sent/delivered/bounced/failed) update `messages.deliveryStatus`
- Labels can track state on threads; SOC 2 Type II — cite in the writeup

## Convex (platform)

- **httpAction** — receives AgentMail webhooks (signature-verified)
- **crons** — weekly re-crawl + change tracking; scheduled check-in reminders
- **vectorSearch** — semantic retrieval over `researchDocs`
- **@convex-dev/workflow** — durable pipeline: assessment → score → match → report → email, with retries; states in `workflowRuns`
- **file storage** — report HTML/PDF
- **static hosting** — frontend deploys to `convex.site` (hackathon requirement; no other host)

## Env vars (names only — values in Convex dashboard, never in repo)

`TYPESAFE_API_KEY` · `FIRECRAWL_API_KEY` · `AGENTMAIL_API_KEY` · `AGENTMAIL_WEBHOOK_SECRET` · frontend: `VITE_CONVEX_URL`
