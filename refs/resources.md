# Remi References

Gathered + verified 19 Sep 2026. Plan lives in `docs/plan.md`.

## Cognitive content (public-domain / free, never MoCA or MMSE)

| Resource | Link | Use |
|---|---|---|
| Mini-Cog | https://mini-cog.com/ | Word-recall block structure (word list → distractor → recall); cite Borson et al. 2000 |
| AD8 informant interview | https://knightadrc.wustl.edu/professionals-clinicians/ad8-instrument | Caregiver-mode questions; free for non-commercial use (WashU) |
| GDS-15 | public domain (Yesavage et al.) | Mood items in profile/trend |
| jsPsych | https://www.jspsych.org/v8/ · https://github.com/jspsych/jsPsych | Timed-task plugins: reaction time, serial-RT, n-back, Stroop, digit span; trial data → Convex mutations |
| TestMyBrain | https://testmybrain.org/ · toolkit: https://cogsci.testmybrain.org/ · NIH OMNI-ADRD: https://testmybrain.org/omni-adrd-press-release-sept-2025.html | Design reference + credibility citation only, NOT a runtime dependency |

**Instrument boundary:** never label tasks MoCA (license + certification) or MMSE (PAR-owned).

## Convex

- Docs: https://docs.convex.dev/, agent-friendly index: https://docs.convex.dev/llms.txt
- Components directory: https://www.convex.dev/components
  - `@convex-dev/workflow`: durable, resumable pipeline (assessment → score → match → report → email)
  - `@convex-dev/rate-limiter`: guard sends/actions
  - `@convex-dev/ai-budget`: `ai.meter()` caps on JEV/Firecrawl calls
- Auth (optional per hackathon rules): https://docs.convex.dev/auth
- Static hosting, REQUIRED frontend host: https://docs.convex.dev/hosting/static-hosting

## Sponsor docs

- **Firecrawl**: https://docs.firecrawl.dev/ · scrape: /features/scrape · JSON extract: /features/llm-extract · change tracking: /features/change-tracking · Node SDK: /sdks/node (verify current npm package name at scaffold)
- **AgentMail**: https://docs.agentmail.to/ (append `.md` to any page) · webhooks: /webhooks-overview.md · signature verification: /webhook-verification.md · idempotency: /idempotency.md · npm package: `agentmail` · SOC 2 Type II, cite in writeup
- **TypeSafe / JEV**, docs index: https://docs.typesafe.ai/llms.txt · API: https://docs.typesafe.ai/api · JS SDK: https://docs.typesafe.ai/sdk/javascript · console: https://console.typesafe.ai · verified contract: see `jev-api.md`

## Health-source allowlist (Firecrawl crawls ONLY these)

- NIA, what to tell the doctor: https://www.nia.nih.gov/health/medical-care-and-appointments/what-do-i-need-tell-doctor
- NIA, memory problems: https://www.nia.nih.gov/health/memory-loss-and-forgetfulness/memory-problems-forgetfulness-and-aging
- NHS memory loss: https://www.nhs.uk/symptoms/memory-loss-amnesia/
- Mayo Clinic: https://www.mayoclinic.org
- Alzheimer's Association: https://www.alz.org
- PubMed: https://pubmed.ncbi.nlm.nih.gov

Every citation stores: publisher, URL, excerpt, fetchedAt.

## Hackathon

- Rules/registration: https://luma.com/convex-allgas-hackathon
- Submit: https://vibeapps.dev, before **Sept 22, 12:00 PM PT = Sept 23, 12:30 AM IST**
- Social post tags: @convex @[OI] @firecrawl @agentmail
- `hackathon.md` build log is what judges read. Run `/hackathon` while building
