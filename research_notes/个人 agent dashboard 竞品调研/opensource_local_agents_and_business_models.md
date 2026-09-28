# Open-source / local-first personal AI agents and business models of local desktop AI products (as of 2026-09-26)

Research date: 2026-09-26. Every fact is dated where the source gave a date. Sources marked "(aggregator)" are secondary SEO/blog sites; treat their numbers as indicative only.

## Q1. OpenClaw (formerly Clawdbot / Moltbot): history, adoption, install, interface, dashboards, security, business model, 2026 status

### Takeaway
OpenClaw is the defining precedent: a solo developer's local, messaging-app-first agent that became the most-starred fast-growing repo on GitHub within ~4 months (Nov 2025 -> Mar 2026), then its creator joined OpenAI (Feb 2026) and the project moved to a foundation. It proved mass demand for a "personal agent that does things", but also proved that a local agent with shell access plus an open skill marketplace, installed by non-experts, produces large-scale security incidents. It has since grown exactly the pieces a mainstream product needs: one-line installer + onboarding wizard, a browser Control UI dashboard, and macOS/iOS/Android apps — while a cottage industry of third-party managed hosts appeared around it.

### Cited Findings
**History / naming**
- First released Nov 24, 2025 (as "Warelay"/Clawdbot lineage), descended from "Clawd", an assistant named after Anthropic's Claude; renamed "Moltbot" on Jan 27, 2026 after Anthropic trademark complaints, then "OpenClaw" on Jan 30, 2026 — [Wikipedia: OpenClaw](https://en.wikipedia.org/wiki/OpenClaw)
- Creator Peter Steinberger (Austrian developer, previously PSPDFKit founder) — [Wikipedia: Peter Steinberger](https://en.wikipedia.org/wiki/Peter_Steinberger_(programmer))
- Feb 15, 2026: Sam Altman announced Steinberger "is joining OpenAI to drive the next generation of personal agents" and "OpenClaw will live in a foundation as an open source project that OpenAI will continue to support" — [CNBC](https://www.cnbc.com/2026/02/15/openclaw-creator-peter-steinberger-joining-openai-altman-says.html); [TechCrunch](https://techcrunch.com/2026/02/15/openclaw-creator-peter-steinberger-joins-openai/); [Sam Altman on X](https://x.com/sama/status/2023150230905159801)
- Steinberger's stated reason: his next mission is to "build an agent that even my mum can use", which needs "a lot more thought on how to do it safely" — [steipete.me](https://steipete.me/posts/2026/openclaw); [Yahoo/Reuters](https://finance.yahoo.com/news/openclaw-founder-steinberger-joins-openai-223554158.html). (Directly relevant: the creator himself judged OpenClaw not usable by normal people.)
- Note: it was an acqui-hire of the person, not an acquisition of the project; openclawvps.io's "Acquired by OpenAI" wording is inaccurate — [Forbes](https://www.forbes.com/sites/ronschmelzer/2026/02/16/openai-hires-openclaw-creator-peter-steinberger-and-sets-up-foundation/) vs [openclawvps.io (aggregator)](https://openclawvps.io/blog/openclaw-statistics)
- OpenClaw Foundation publicly "announced itself" in July 2026 — [mean.ceo blog (aggregator, low confidence)](https://blog.mean.ceo/openclaw-news-august-2026/)

**Adoption numbers**
- 247,000 GitHub stars and 47,700 forks as of Mar 2, 2026 — [Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- Crossed 250,829 stars on Mar 3, 2026, passing React (~243k) — [The New Stack](https://thenewstack.io/openclaw-github-stars-security/); [Medium (Aftab)](https://medium.com/@aftab001x/openclaw-just-beat-reacts-10-year-github-record-in-60-days-now-nobody-knows-what-to-do-with-it-937b8f370507)
- 346k+ stars, 1,200+ contributors, 58k+ forks (April 2026); claims 3.2M monthly active users, 500k+ running instances, 44k+ ClawHub skills, 180 ecosystem startups making "$320K+/month" combined; deployment split Docker Compose 65% / npm 25% / Kubernetes 10%; typical user spend $20-32/month — [openclawvps.io (aggregator; a hosting vendor; MAU/instance figures unverified and should not be quoted as fact)](https://openclawvps.io/blog/openclaw-statistics)
- I found no primary/official user count; star counts are the only well-sourced adoption metric.

**Installation**
- Official install: `curl -fsSL https://openclaw.ai/install.sh | bash` (macOS/Linux/WSL2) or `iwr -useb https://openclaw.ai/install.ps1 | iex` (Windows); installer detects OS, installs Node if needed (Node 24.16+/26 required), installs OpenClaw, then runs onboarding with "Quick start" (reuses detected AI access) or "Custom setup"; you need "an API key from your chosen provider and 5 minutes" — [docs.openclaw.ai](https://docs.openclaw.ai/)
- Anthropic blocked Claude Pro/Max subscription OAuth for third-party harnesses (OpenClaw, NanoClaw, OpenCode) effective Apr 4, 2026; such tools must use pay-as-you-go API keys — [MindStudio](https://www.mindstudio.ai/blog/anthropic-openclaw-ban-oauth-authentication); [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use); [OpenClaw docs: Anthropic](https://docs.openclaw.ai/providers/anthropic). The New Stack reported later clarification/confusion about Agent SDK-based use — [The New Stack](https://thenewstack.io/anthropic-agent-sdk-confusion/)
- July 13, 2026 release (v2026.7.1) added guided first-run on new Android and macOS apps; `openclaw attach` lets users attach Claude Code sessions without exposing credentials — [OpenClaw release notes v2026.7.1](https://docs.openclaw.ai/releases/2026.7.1)

**Interface: messaging apps + dashboard**
- Primary interface is chat apps: Discord, Google Chat, iMessage, Matrix, Microsoft Teams, Signal, Slack, Telegram, WhatsApp, Zalo, more via plugins — [docs.openclaw.ai](https://docs.openclaw.ai/)
- Browser dashboard ("Control UI") at `http://127.0.0.1:18789/`, launched by `openclaw dashboard`; iOS/Android "nodes" for camera/screen/voice; macOS app — [docs.openclaw.ai](https://docs.openclaw.ai/)
- v2026.7.1 (Jul 13, 2026): Control UI overhaul for "chat, sessions, workspaces, and usage tracking", resizable panes, session pinning/grouping, usage view with "recent estimated spend and daily values"; macOS app gained session sidebar/transcript export; workspace terminals across web and mobile — [release notes](https://docs.openclaw.ai/releases/2026.7.1)
- v2026.8.1 betas (Aug 2026) added GPT-5.6 reasoning, external gateway supervision, SQLite backups — [openclaw.academy (aggregator)](https://openclaw.academy/blog/openclaw-2026-8-1-beta-3-release-impact/); an "OpenClaw 2.0 (v2026.8.1)" release on Aug 30, 2026 with redesigned UI, faster setup and "shared cloud sessions" is reported only by a low-quality blog — [mean.ceo (unverified)](https://blog.mean.ceo/openclaw-news-august-2026/); check [GitHub releases](https://github.com/openclaw/openclaw/releases)

**Security incidents**
- "ClawHavoc": audit of 2,857 ClawHub skills found 341 malicious (≈12%), 335 from one coordinated campaign, mostly delivering Atomic macOS Stealer; later scans reported 800+ (~20%); publishing only required a GitHub account ≥1 week old, no static analysis/signing; OpenClaw then partnered with VirusTotal to scan uploads — [eSecurity Planet](https://www.esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub/); [Trend Micro](https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html); [Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/); [Conscia](https://conscia.com/blog/the-openclaw-security-crisis/)
- 30,000+ internet-exposed instances, many without auth — [Conscia](https://conscia.com/blog/the-openclaw-security-crisis/); 135,000+ exposed, 9 CVEs disclosed Mar 18-21, 2026 (one 9.9) — [openclawvps.io (aggregator)](https://openclawvps.io/blog/openclaw-statistics)
- Feb 2026: a student's agent autonomously created a MoltMatch dating profile; Cisco flagged exfiltration/prompt-injection in third-party skills — [Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- Academic work specifically on risks "for non-technical users" — [arXiv 2606.11007](https://arxiv.org/pdf/2606.11007); [arXiv 2603.11619](https://arxiv.org/pdf/2603.11619)

**Business model / ecosystem**
- The project itself has no commercial company; foundation-governed, OpenAI-supported — [CNBC](https://www.cnbc.com/2026/02/15/openclaw-creator-peter-steinberger-joining-openai-altman-says.html)
- Monetization happened around it: 35+ managed hosting providers "from $0.99/month shared containers to enterprise GDPR deployments" (DigitalOcean, Alibaba Cloud, Railway, etc.) — [clawdocs.org hosting providers](https://clawdocs.org/guides/hosting-providers); [clawdocs deployment options](https://clawdocs.org/guides/deployment-options)
- Cloudflare's official "Moltworker" runs OpenClaw in Sandbox containers (R2 storage, Browser Rendering, AI Gateway for unified LLM billing); needs Workers Paid ($5/mo) plus compute — [github.com/cloudflare/moltworker](https://github.com/cloudflare/moltworker)
- NVIDIA announced "NemoClaw" enterprise stack Mar 16, 2026 — [openclawvps.io (aggregator)](https://openclawvps.io/blog/openclaw-statistics)
- Some hosts explicitly refuse Claude-subscription login post-ban — [OpenClaw Launch](https://openclawlaunch.com/guides/openclaw-claude-subscription)

### Inferences
- The "always-on runner" and "managed hosting" revenue in OpenClaw's ecosystem went to third parties (35+ hosts, Cloudflare), not the project — an open-source local agent that doesn't ship its own hosted tier leaves that money on the table.
- OpenClaw converged on the same shape the founder's product already has (browser dashboard with sessions/workspaces/usage/terminal), suggesting that form is validated; the differentiator must be onboarding and safety, not the dashboard.
- The Apr 2026 Anthropic OAuth ban means a third-party local agent cannot piggyback on users' $20 Claude subscriptions; users need API keys (hard for mainstream) or the product must resell/bundle credits.

### Gaps
- No official user/MAU count; aggregator figures (3.2M MAU) unverified.
- Could not confirm the "OpenClaw 2.0 / shared cloud sessions" Aug 30, 2026 release from a primary source, nor foundation funding/revenue.

## Q2. Other open-source personal agents: dashboard form, non-technical installers, monetization

### Takeaway
Most open-source agents with desktop installers monetize through (a) a hosted/cloud version, (b) enterprise/team licenses, or (c) acquisition — rarely through the desktop app itself. Several were absorbed by larger companies or foundations (LibreChat -> ClickHouse, Goose -> Linux Foundation AAIF).

### Cited Findings
- **Goose (Block)**: introduced Jan 2025; native desktop app for macOS/Linux/Windows plus CLI and API; contributed Dec 2025 as a founding project of the Linux Foundation's Agentic AI Foundation (with MCP and AGENTS.md); free, no monetization (Block-funded) — [Wikipedia: goose](https://en.wikipedia.org/wiki/Goose_(AI_agent)); [github.com/aaif-goose/goose](https://github.com/aaif-goose/goose)
- **LibreChat**: acquired by ClickHouse Nov 4, 2025; founder Danny Avila joined; positioned as part of an "open-source Agentic Data Stack"; existing deployments unchanged — [ClickHouse blog](https://clickhouse.com/blog/clickhouse-acquires-librechat); [HN discussion](https://news.ycombinator.com/item?id=45877770)
- **AnythingLLM (Mintplex Labs)**: desktop app free download; Docker self-host edition MIT; hosted cloud Basic $50/mo, Pro $99/mo, Enterprise custom — [anythingllm.com](https://anythingllm.com/); [AnythingLLM Cloud](https://anythingllm.com/cloud); [Kunavo (aggregator)](https://kunavo.com/guides/anythingllm-api-cost)
- **Jan**: free, fully featured local assistant desktop app — [Vellum (aggregator)](https://www.vellum.ai/blog/best-local-ai-assistants)
- **Khoj**: open source (AGPL-3.0), on-device to cloud; cloud plans start ~$10/month, free tier, student pricing — [khoj.dev](https://khoj.dev/); [opentools.ai (aggregator, Nov 2025)](https://opentools.ai/tools/khoj)
- **Letta** (MemGPT): Letta Desktop open beta (Aug 2025) runs the Agent Development Environment (ADE) locally with embedded or self-hosted server; docs now label Desktop "legacy" — [Letta on X](https://x.com/Letta_AI/status/1953255524843114961); [Letta docs](https://docs.letta.com/guides/desktop/troubleshooting/). Letta Cloud pricing not retrieved.
- **Open Interpreter**: 60k+ stars; BYOK/local free or $20/mo Pro hosted; 2026 Rust rewrite repositioned as a Codex-compatible coding agent for low-cost open models — [openinterpreter.com](https://www.openinterpreter.com/); [tooljunction (aggregator)](https://www.tooljunction.io/ai-tools/open-interpreter); [ai-tldr](https://ai-tldr.dev/releases/openinterpreter-rust-0-0-26/)
- **Eigent (CAMEL-AI)**: "Open Source Cowork Desktop — local and free alternative to Claude Cowork and Codex"; ~15.4k stars, Apache-2.0; desktop installer at eigent.ai/download; local mode with Ollama/vLLM/LM Studio; cloud version requires account; enterprise plans with SLAs — [github.com/eigent-ai/eigent](https://github.com/eigent-ai/eigent); [eigent.ai](https://www.eigent.ai/)

### Inferences
- Workspace/dashboard-form open agents (AnythingLLM workspaces, Letta ADE, Eigent, OpenClaw Control UI) all ship desktop installers; none of those found charge for the local app — money is in cloud hosting ($50-99/mo AnythingLLM) or enterprise.
- "Personal assistant for email/jobs/research" with vertical workspaces appears less crowded than generic chat/coding agents in this list.

### Gaps
- No public revenue for AnythingLLM, Khoj, Eigent, Letta. Letta Cloud prices and Jan's any-paid-tier status not verified.

## Q3. Desktop packaging precedents that lowered the barrier

### Takeaway
The pattern that worked for mainstream uptake: a free signed native installer with no account required and no terminal, then optional cloud inference so users don't need their own GPU or API key.

### Cited Findings
- **Ollama**: moved from free-only local to hybrid; cloud tiers Pro $20/mo and Max $100/mo — [ModelPiper (aggregator)](https://modelpiper.com/blog/local-ai-platforms-compared-mac); [aireiter (aggregator)](https://aireiter.com/blog/ollama-alternatives)
- **LM Studio**: local app free (incl. for work); cloud inference billed per million tokens — [ModelPiper LM Studio alternatives (aggregator)](https://modelpiper.com/blog/lm-studio-alternative); [kunalganglani.com](https://www.kunalganglani.com/blog/lm-studio-vs-ollama)
- **Msty**: free desktop tier (local+remote chat, RAG, MCP client, no account); Aurum $149/user/yr or $349 lifetime (June 2026) — [msty.ai/pricing](https://msty.ai/pricing/); [ModelPiper](https://modelpiper.com/blog/local-ai-platforms-compared-mac)
- **OpenClaw**: one-line curl installer that installs Node itself + onboarding wizard + native macOS/Android apps with guided first run (Jul 2026) — [docs.openclaw.ai](https://docs.openclaw.ai/); [v2026.7.1](https://docs.openclaw.ai/releases/2026.7.1)
- **Managed versions of open agents**: 35+ OpenClaw hosts from $0.99/mo, "no VPS, Docker, or terminal skills needed" — [clawdocs.org](https://clawdocs.org/guides/hosting-providers); Cloudflare Moltworker — [GitHub](https://github.com/cloudflare/moltworker); AnythingLLM Cloud $50-99/mo — [anythingllm.com/cloud](https://anythingllm.com/cloud); Eigent cloud — [GitHub](https://github.com/eigent-ai/eigent)

### Inferences
- Even OpenClaw's installer still assumes a terminal and an API key; the step still missing for "mum" users is bundled model access (the founder's pain point). Ollama/LM Studio adding paid cloud inference shows local-first vendors converging on "local app + optional paid cloud compute".

### Gaps
- No public install/download counts for Ollama, LM Studio, Msty, Jan retrieved in this pass.

## Q4. Monetization precedents with prices and revenue

### Takeaway
Three models dominate: (1) subscription with a bundled credit pool that equals the price, plus BYOK/overage (Cursor, Warp, Raycast); (2) free local app + paid sync/cloud service (Obsidian, Msty, Ollama); (3) open-core + managed cloud (n8n, Supabase), which has the strongest public revenue evidence.

### Cited Findings
- **Cursor**: June 2025 switch from request allotments to usage-based credit pools tied to API cost; public apology Jul 4, 2025 with refunds for mid-June to early-July surprise charges; plans now Pro $20 (includes $20 frontier-model usage), Pro+ $60, Ultra $200, each credit pool = price; "Auto" mode unlimited — [Finout](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips); [Vantage](https://www.vantage.sh/blog/cursor-pricing-explained); [Wikipedia: Cursor](https://en.wikipedia.org/wiki/Cursor_(company))
- **Warp**: replaced Pro/Turbo/Lightspeed with a single "Build" plan $20/mo with 1,500 AI credits plus rollover "Reload Credits" (valid 1 year) and BYOK; effective at renewals after Dec 1, 2025 — [Warp blog](https://www.warp.dev/blog/warp-new-pricing-flexibility-byok); [Tessl](https://tessl.io/blog/warp-joins-the-pricing-pivot-sweeping-ai-developer-tools)
- **Raycast** (post dated Sep 10, 2026): Pro $10/mo = 500 credits; Pro+ (was Advanced AI) $20 = 3,000 credits; new Max $50 = 7,500 credits; previously rate-limited flat plans; users can connect Claude or ChatGPT subscriptions on any paid plan without spending Raycast credits; custom API keys/local models need Pro — [Raycast blog](https://www.raycast.com/blog/changing-how-raycast-ai-is-priced); [Raycast pricing](https://www.raycast.com/pricing)
- **Obsidian**: app free; Sync $5/mo Standard or $10/mo Plus ($4/$8 annual); Publish $8/site/mo — [obsidian.md/pricing](https://obsidian.md/pricing); [eesel](https://www.eesel.ai/blog/obsidian-pricing)
- **n8n** (fair-code, self-host free + cloud): $180M Series C at $2.5B (Oct 2025); $70M ARR end-2025, $100M ARR April 2026; SAP invested >€60M at $5.2B (May 2026); ~$493.5M raised total — [n8n blog](https://blog.n8n.io/series-c/); [TFN](https://techfundingnews.com/n8n-raises-180m-series-c-2-5-billion-valuation-automation-ai/); [Sacra](https://sacra.com/c/n8n/); [startupriders (aggregator)](https://www.startupriders.com/p/n8n-growth-playbook). Note: Latka lists "$40M ARR" — conflicting/older figure — [getlatka](https://getlatka.com/companies/n8nio)
- **Supabase** (open source + hosted): ~$101M ARR end-2025, $170M ARR May 2026; ~$2B valuation Mar 2025; ~$700M raised — [Sacra](https://sacra.com/c/supabase/)
- **Local-app vendors**: Msty lifetime $349; Ollama cloud $20/$100; Open Interpreter Pro $20; AnythingLLM Cloud $50/$99 — see Q2/Q3 sources above.
- **Cloud "always-on runner" for a local agent**: Cloudflare Moltworker ($5/mo + compute) and 35+ OpenClaw hosts ($0.99+/mo); openclawvps claims typical total spend $20-32/mo incl. LLM — [Moltworker](https://github.com/cloudflare/moltworker); [clawdocs](https://clawdocs.org/guides/hosting-providers); [openclawvps (aggregator)](https://openclawvps.io/blog/openclaw-statistics)

### Inferences
- The converged 2026 consumer price points: $10-20 entry with a credit pool equal to price, $50-60 mid, $100-200 heavy; plus a BYOK or "connect your ChatGPT/Claude subscription" escape hatch (Raycast) so heavy users don't destroy margin.
- For a solo founder, "free local app + paid cloud runner/sync with bundled credits" mirrors Obsidian Sync + Ollama cloud and captures the value OpenClaw's ecosystem handed to third-party hosts.

### Gaps
- No public revenue figures for Raycast, Warp, Msty, Ollama cloud. Cursor ARR not fetched in this pass.

## Q5. Margin risk: heavy-user LLM cost exceeding subscription price, and responses (2025-2026)

### Takeaway
Every flat-rate AI subscription tested in 2025-2026 hit the same wall — agentic/iterative usage makes top users cost multiples of their fee — and every company responded by moving to credits/usage caps, raising tiers, and blocking subscription arbitrage.

### Cited Findings
- Anthropic introduced weekly Claude Code limits (Aug 28, 2025) on Pro $20, Max $100, Max $200; one user reportedly burned "tens of thousands" in compute on a $200 plan; 24/7 automation, account sharing and reselling cited; said to affect <5% of subscribers — [Yahoo Tech](https://tech.yahoo.com/ai/articles/anthropic-were-glad-claude-code-164658123.html); [Portkey](https://portkey.ai/blog/claude-code-limits/); [Northflank](https://northflank.com/blog/claude-rate-limits-claude-code-pricing-cost)
- Sep 14, 2026: Anthropic "permanent 25%" weekly-limit increase, arriving one day after a temporary 50% boost (since May) expired — framed by critics as a net cut — [MindStudio](https://www.mindstudio.ai/blog/claude-code-weekly-rate-limit-changes)
- Apr 4, 2026: Anthropic bars Claude subscription OAuth in third-party harnesses (OpenClaw, OpenCode) citing that subscriptions don't cover third-party usage patterns — [MindStudio](https://www.mindstudio.ai/blog/anthropic-openclaw-ban-oauth-authentication); [MLQ](https://mlq.ai/news/anthropic-ends-paid-access-for-claude-in-third-party-tools-like-openclaw/)
- Cursor June 2025 move to usage-based credits because flat per-request pricing was unsustainable as users shifted to frontier models; heavy users report overages 15-30% above subscription — [Finout](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips)
- Raycast (Sep 2026): "The cost of supporting these workflows has increased, while our subscription prices haven't. So far, we've been covering the difference, but we can't subsidize it the way the big model labs can." — [Raycast blog](https://www.raycast.com/blog/changing-how-raycast-ai-is-priced)
- Warp dropped tiered plans for credits + BYOK (Dec 2025) — [HackerNoon](https://hackernoon.com/warp-scraps-tiered-plans-as-ai-coding-tools-face-pricing-reckoning); critique that the math "still doesn't add up" — [Kilo blog](https://blog.kilo.ai/p/warps-new-pricing-still-doesnt-add)

### Inferences
- An always-on personal agent (inbox triage, job scans, research on schedules) is structurally a "24/7 automation" user — the exact pattern that broke flat plans. Any bundled-credit subscription needs a hard credit pool, cheaper default models (Cursor "Auto"), and BYOK/overage.
- A small vendor cannot subsidize like labs (Raycast's explicit admission); pricing should be credit-denominated from day one rather than migrated later (Cursor's backlash).

### Gaps
- No public per-user cost distributions; "tens of thousands" anecdote is from press, not audited data.
