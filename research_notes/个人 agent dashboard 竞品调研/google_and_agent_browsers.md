# Google products and agent browsers vs. "an agent that builds and maintains a persistent personal workspace" (state as of 2026-09-26)

Founder concept used for comparison: natural-language-created, **persistent, multi-tab workspace** (email triage, job search, research, aggregation of sites the user visits) that an agent **keeps maintained** via **scheduled background jobs**.

Date conventions: each finding carries the date of the source. "[STALE?]" = the fact comes from a source older than ~3 months or from a third-party aggregator and may have changed. "[3P]" = third-party / aggregator source, not primary.

---

## 1. Google Labs Disco and GenTabs

### Takeaway
Disco (Dec 2025) is the closest conceptual match to "agent-generated interactive workspace tabs": Gemini turns open tabs + chat history into a custom mini web app (a GenTab). But it is a macOS-only, waitlisted Labs experiment, it is built around a one-off browsing task rather than a maintained, scheduled workspace, and I found no primary source from 2026 showing expansion, persistence semantics, or background refresh.

### Cited Findings
- Announced 2025-12-11 by Google Labs as "an experimental way to discover new generative AI features on the web"; first feature is GenTabs, built with Gemini 3. — [Google blog, 2025-12-11](https://blog.google/innovation-and-ai/models-and-research/google-labs/gentabs-gemini-3/); [Google Labs on X](https://x.com/GoogleLabs/status/1999191845696340199)
- GenTabs creates interactive web apps from the user's open tabs and chat history; users describe the tool they need in natural language and refine it without code; Disco proactively suggests generative apps and links back to original sources. — [Google blog, 2025-12-11](https://blog.google/innovation-and-ai/models-and-research/google-labs/gentabs-gemini-3/)
- Examples shown: trip planner (maps, timelines), meal planner with shopping list, gardening schedule, solar-system explorer. — [9to5Google, 2025-12-11](https://9to5google.com/2025/12/11/google-disco-gentab-browser/); [Chrome Unboxed](https://chromeunboxed.com/meet-disco-googles-wild-new-experimental-browser-that-builds-apps-for-you/)
- Availability at launch: macOS only, waitlist at labs.google/disco, "starting with a small cohort of testers"; Google says "it's early, and not everything will work perfectly." No pricing (free Labs experiment). — [Google blog, 2025-12-11](https://blog.google/innovation-and-ai/models-and-research/google-labs/gentabs-gemini-3/)
- Windows/ChromeOS not supported at launch. — [9to5Google, 2025-12-11](https://9to5google.com/2025/12/11/google-disco-gentab-browser/)
- Third-party 2026 guides say a Windows build is "on the roadmap for 2026" with no confirmed date, and describe Disco as an experimental "discovery vehicle," not a Chrome replacement. [3P, unverified by Google] — [The Rundown AI tool page](https://www.therundown.ai/tools/disco); [DigitalApplied guide](https://www.digitalapplied.com/blog/google-disco-gentabs-ai-browser-guide)
- Google's announcement does not say how long GenTabs persist, whether they can be saved/reopened, or whether they refresh data on a schedule. — [Google blog, 2025-12-11](https://blog.google/innovation-and-ai/models-and-research/google-labs/gentabs-gemini-3/)

### Inferences
- GenTabs validates the "generate a bespoke interactive tab from natural language" UX, and Google has the model + browser distribution to ship it widely. It is the biggest latent threat to the concept's UI layer.
- As documented, GenTabs is task-scoped (derived from current tabs), not a standing workspace with scheduled data jobs, credentialed email access, or cross-session maintenance. That "maintained over time" layer is where the founder's concept differs.
- No sign (in sources found) that Disco left the waitlist by Sept 2026; treat as still-experimental.

### Gaps
- No primary source found for Disco status in 2026 (expansion, Windows, shutdown, graduation into Chrome). Status as of Sept 2026 is unknown.
- GenTab persistence/saving behaviour not documented in any primary source found.

---

## 2. Google Labs "CC" to Gemini Daily Brief

### Takeaway
CC (Labs, early 2026) was an email/calendar/Drive morning-briefing agent you could reply to; it graduated into **Gemini Daily Brief** (announced at I/O, 2026-05-19, paid), which became **free for all US personal accounts on 2026-09-08**. CC itself pivoted on 2026-09-18 into a waitlisted US-only family/household agent. Google now gives away the "daily email triage digest" slice of the founder's concept for free.

### Cited Findings
- CC: experimental Labs productivity agent built with Gemini; connects Gmail, Calendar, Drive (plus web) and emails a daily "Your Day Ahead" briefing with top-of-mind items, calendar recap and FYI; you can reply to it to draft emails or "remember this for later." — [Google blog (CC)](https://blog.google/innovation-and-ai/models-and-research/google-labs/cc-ai-agent/); [labs.google/cc](https://labs.google.com/cc/); [Chrome Unboxed (waitlist US & Canada)](https://chromeunboxed.com/googles-new-cc-ai-agent-wants-to-be-your-morning-executive-assistant/); [TidBITS, 2026-05-29](https://tidbits.com/2026/05/29/taming-email-overload-googles-cc-daily-briefing-agent/)
- 2026-05-19 (I/O): Gemini app announced Daily Brief — personalized morning digest of urgent email and calendar events that "actively organizes and prioritizes based on your specific goals" with next-step suggestions; US rollout for Google AI Plus/Pro/Ultra. — [Google blog, 2026-05-19](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/)
- 2026-09-08: Daily Brief became free for all US users with a personal Google Account (previously Plus/Pro/Ultra only); setup via Settings > Personal Intelligence, Memory on, Workspace connection on, Daily Brief toggle. Features: dates/deadlines/reminders, links and phone numbers, time estimates, daily notification. — [Droid Life, 2026-09-08](https://www.droid-life.com/2026/09/08/google-makes-geminis-daily-brief-a-free-feature/); [Gemini Help: daily brief](https://support.google.com/gemini/answer/17077455?hl=en&co=GENIE.Platform%3DDesktop)
- 2026-09-18: Google re-launched CC as a household agent for families (shared calendars and task lists, fills permission slips and registration forms, shopping lists, meal plans, drive times, important dates; up to 6 family members); runs on isolated cloud infrastructure using Gemini and Antigravity; US only, personal Gmail, 18+, waitlist; no pricing disclosed. Pivot reason: users wanted household management. — [TechCrunch, 2026-09-18](https://techcrunch.com/2026/09/18/googles-new-cc-is-an-ai-agent-that-helps-families-run-their-households/)

### Inferences
- The email triage/briefing component is now a free, default-distribution Google feature in the US. A standalone product cannot compete on "daily brief of Gmail" alone; it would have to win on a cross-source, user-shaped workspace (non-Google sites, job boards, research) and on the persistent visual surface.
- Daily Brief is a feed/notification, not an editable multi-tab dashboard.

### Gaps
- Exact CC launch date and whether the old CC briefing email still runs for existing users after the pivot was not confirmed from a primary source.
- Daily Brief availability outside the US not found.

---

## 3. Gemini Agent / Gemini Spark, Scheduled Actions, Gemini in Chrome

### Takeaway
Google's **Gemini Spark** (announced 2026-05-19) is the most direct functional competitor to the "scheduled background jobs" half of the concept: a 24/7 cloud-VM agent with reusable Skills and time/event-triggered Schedules over Workspace. It outputs to chat/email/Docs/Sheets rather than a persistent custom dashboard. Gemini in Chrome adds auto-browse (agentic web actions) for Pro/Ultra in the US.

### Cited Findings
- **Gemini Spark** announced 2026-05-19: "24/7 personal AI agent"; keeps working in the background when the device is closed or locked; recurring tasks, document parsing, workflows; asks approval for high-stakes actions (spending, sending email); integrates Gmail, Docs, Slides etc.; beta "next week" for Ultra subscribers in the US. — [Google blog, 2026-05-19](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/)
- Spark official page: three mechanisms — Tasks, Skills (reusable named custom workflows), Schedules (time-based e.g. "Every Monday at 9:00 AM", or event-triggered e.g. incoming emails matching criteria). Example uses include tracking internships/opportunities, inbox organization, invoice/receipt finding, file tagging, logging data into spreadsheets, research across multiple websites. Integrations off by default. Available to Google AI Pro and Ultra subscribers, 18+, "select countries." — [gemini.google Spark page, accessed 2026-09-26](https://gemini.google/overview/agent/spark/)
- Spark runs on Gemini 3.5 Flash and Google's Antigravity harness on dedicated Google Cloud VMs; now included in Pro as well as Ultra; Google AI Pro is $19.99/month in the US. [3P] — [DataCamp](https://www.datacamp.com/blog/gemini-spark); [The Rundown AI](https://www.therundown.ai/tools/gemini-spark)
- Same I/O post: Gemini app has 900M+ monthly active users; connected apps Canva, OpenTable, Instacart at launch; MCP connections "expanding throughout summer." — [Google blog, 2026-05-19](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/)
- **Scheduled Actions** (earlier feature): lets users ask Gemini to perform a task at a specific time or recurringly, managed on a Scheduled Actions settings page, on Android, iOS and web. [STALE? — reported mid-2025] — [GSMArena](https://www.gsmarena.com/googles_gemini_now_supports_scheduled_actions-news-68154.php); [Yahoo Tech](https://tech.yahoo.com/ai/articles/google-geminis-scheduled-actions-finally-025838564.html)
- **Gemini in Chrome** (Gemini 3 update): new side panel assistant; **auto browse** for multi-step tasks (e.g. researching hotel/flight prices across dates, filling forms), requiring confirmation for sensitive actions like purchases or social posts; connected apps Gmail, Calendar, YouTube, Maps, Shopping, Flights; Personal Intelligence "coming"; US on Windows, macOS, Chromebook Plus; auto browse requires Google AI Pro or Ultra. — [Google Chrome blog](https://blog.google/products-and-platforms/products/chrome/gemini-3-auto-browse/) (publication date not shown in fetched text; widely reported as early 2026 [STALE?])
- Chrome for Android agentic browsing reported rolling out to eligible US users from late June 2026. [3P] — [DEV Community](https://dev.to/alifar/gemini-in-chrome-for-android-brings-agentic-browsing-to-eligible-u-s-users-41fn)

### Inferences
- Spark + Schedules covers "job search tracking," "weekly inbox recap," "log into a sheet" as recurring jobs at $19.99/mo bundled with 2TB storage etc. The founder's differentiation must be the **persistent, visual, per-topic workspace UI** that the agent edits and keeps fresh, plus non-Google sources — Spark's outputs are ephemeral chat messages or files in Drive.
- Google is Workspace-centric; Outlook/iCloud users, and sites behind logins outside Google's connectors, are weaker for Google.

### Gaps
- Spark country list, usage limits/quotas, and whether it can render or maintain an interactive dashboard/app (vs. Docs/Sheets output) not found.
- Exact date Spark was extended to Pro tier not confirmed from a primary source.

---

## 4. NotebookLM (renamed Gemini Notebook, July 2026)

### Takeaway
NotebookLM is Google's persistent research workspace: notebooks persist, Google Docs/Slides/Sheets sources can be re-synced, Deep Research builds source lists from the web, and since July 2026 each notebook has a cloud computer for code execution. It covers the "research tab" but is source-grounded Q&A, not a monitoring/aggregation dashboard with scheduled refresh.

### Cited Findings
- 2026-07-16: Google renamed NotebookLM to **Gemini Notebook**; same product, existing notebooks kept, notebooklm.google.com still works; every notebook now has a secure cloud computer to write and execute code for data analysis; notebooks can be attached as grounded sources in Gemini chats. — [Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/); [Forbes, 2026-07-16](https://www.forbes.com/sites/danfitzpatrick/2026/07/16/notebooklm-is-now-gemini-notebook-im-confused/); [NC State OIT, 2026-07-17](https://oit.ncsu.edu/2026/07/17/notebooklm-changes-name-to-gemini-notebook/)
- 2026-06-08: update lets users start a chat about a project and have the app suggest and add sources using research skills and Google Search, building the knowledge base from chat. — [TechCrunch, 2026-06-08](https://techcrunch.com/2026/06/08/notebooklms-new-update-will-help-you-build-source-repository-from-chat/)
- March 2026: new customization/interaction features for NotebookLM in Workspace. — [Workspace Updates, 2026-03](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html)
- April 2026: auto-labeling of sources (once >5 sources), bulk sharing, improved quizzes. [3P] — [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/1391/notebooklm-april-2026-update-auto-label-flashcards)
- Google Docs/Slides/Sheets sources are "living" (can fetch latest changes); PDFs are static. Deep Research (since Nov 2025) builds a cited source list from the open web. [3P] — [Jeff Su](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/)

### Inferences
- Strong persistent research workspace, but refresh is manual/source-sync, not "watch these sites and update this tab every morning." Could be combined with Spark schedules by Google later — a plausible convergence risk.

### Gaps
- Whether Gemini Notebook supports scheduled source refresh or website monitoring: no evidence found.

---

## 5. Agent browsers

### Takeaway
Agent browsers (Comet, Dia, Neon, Atlas) have converged on: sidebar assistant over tabs, agentic web actions, saved prompts ("Skills"/"Cards"), and some recurring/background tasks or morning briefs. None found builds and maintains a persistent, agent-edited multi-tab dashboard. Monetization has moved to $20/mo and $100–200/mo tiers; ChatGPT Atlas was deprecated (to stop working 2026-08-09).

### Cited Findings

**Perplexity Comet / Computer**
- Comet is free to download and use on Windows, macOS, iOS and Android (including agentic search, summaries, voice, Deep Research) as of 2026-03-18; Perplexity says Comet "will always be free." [3P] — [eesel AI](https://www.eesel.ai/blog/perplexity-comet-pricing); [XDA](https://www.xda-developers.com/perplexity-comet-now-completely-free/)
- Comet lets users run several tasks from a dashboard and set recurring triggers (e.g. summarize morning email and calendar at 8:30 daily); Max adds Background Assistants that work through a to-do list autonomously. Comet Plus is a $5/mo publisher-content add-on, included in Pro and Max. [3P] — [eesel AI](https://www.eesel.ai/blog/perplexity-comet-pricing)
- **Perplexity Computer** launched 2026-02-25: multi-agent orchestration across ~19 models, 400+ app integrations; Max ($200/mo) first. — [Perplexity blog](https://www.perplexity.ai/hub/blog/introducing-perplexity-computer); [Perplexity product page](https://www.perplexity.ai/products/computer)
- **Personal Computer** (Mac, can run 24/7 on a Mac mini with access to local files/apps; tasks managed from iPhone) unveiled 2026-03-11 at Ask 2026, shipped to all Max subscribers 2026-04-16. — [MacRumors, 2026-04-16](https://www.macrumors.com/2026/04/16/perplexity-personal-computer-for-mac/); [TestingCatalog](https://www.testingcatalog.com/perplexity-released-personal-computer-to-all-max-subscribers/)

**The Browser Company Dia (Atlassian)**
- Atlassian acquired The Browser Company for $610M in October 2025. — [Wikipedia: Dia](https://en.wikipedia.org/wiki/Dia_(web_browser))
- Dia Skills = saved AI prompts/shortcuts fired on any page; Memory pulls context from open tabs. [3P] — [Composite](https://composite.com/blog/dia-browser-reviews-pricing-alternatives)
- 2026-08-17/18: new pricing for new macOS users — "Better Browser" free (no AI), "Better Answers" $20/mo (connectors, tab context, ask on page), "Better Days" $100/mo (Morning Brief, Reports, higher limits). Existing users stay free for now with 30 days' notice; old Pro plan phased out; Windows still in beta. — [PiunikaWeb, 2026-08-18](https://piunikaweb.com/2026/08/18/dia-announces-expensive-monthly-ai-plans/)

**Opera Neon**
- Neon made public at $19.90/month (Dec 2025); features Tasks (workspaces for AI-assisted source comparison/analysis) and Cards (reusable AI prompts); can make mini apps. — [TechCrunch, 2025-12-11](https://techcrunch.com/2025/12/11/opera-wants-you-to-pay-20-a-month-to-use-its-ai-powered-browser-neon/)
- As of August 2026, Neon is reported to be a free download (browser, ad blocker, VPN, MCP connector and CLI for your own agents), with a $19.90/mo Standard plan for Neon's own agents. [3P, unverified] — [ToolChase](https://toolchase.com/tool/opera-neon/)

**OpenAI ChatGPT Atlas (brief)**
- Launched macOS 2025-10-21 with agent mode; Windows/iOS/Android "coming soon." — [OpenAI](https://openai.com/index/introducing-chatgpt-atlas/)
- OpenAI is deprecating Atlas, moving browser agent capabilities into ChatGPT and Codex (multiple tabs, downloads, login support); Atlas scheduled to stop working 2026-08-09. (Primary help page returned 403 to my fetch; claim from search snippet of that page.) — [OpenAI Help Center](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work); [Wikipedia: ChatGPT Atlas](https://en.wikipedia.org/wiki/ChatGPT_Atlas)

### Inferences
- "Tasks" (Neon) and "Reports/Morning Brief" (Dia) and recurring Comet tasks are the nearest analogues to persistent workspaces, but each is a saved prompt or scheduled summary, not a durable, agent-maintained UI per topic.
- Atlas's shutdown and Dia's paywall suggest standalone AI browsers struggle to monetize/sustain; this argues for building the workspace as a web app/extension on top of existing browsers rather than a new browser.
- Price anchors: $20/mo consumer AI tier is standard; "always-on agent" tiers cluster at $100–200/mo (Dia Better Days, Perplexity Max) while Google bundles Spark into $19.99 Pro — strong price pressure.

### Gaps
- Comet recurring-task details are from third-party sources; no primary Perplexity doc found describing scheduled tasks or limits.
- No source found showing any agent browser that monitors specific sites over time and shows diffs in a persistent dashboard.
- Neon's Aug 2026 free-tier change not confirmed from Opera primary source.

---

## 6. Older personal start pages / dashboards

### Takeaway
The widget start-page category shrank: iGoogle closed in 2013 and Netvibes retired its consumer dashboards on 2025-06-02; survivors (Start.me, Momentum) are static widget/bookmark pages. No evidence found of any adding agent-maintained AI dashboards in 2025–2026.

### Cited Findings
- Dassault Systèmes announced in April 2025 that Netvibes would retire its standalone (free consumer) web service on 2025-06-02; Netvibes (founded 2005) was known for widgets and RSS reader. — [Wikipedia: Netvibes](https://en.wikipedia.org/wiki/Netvibes); [The Point Online](https://www.thepoint.online/netvibes-retiring-no-great-free-alternatives/)
- Start.me positioned itself as the Netvibes replacement (bookmarks, notes, RSS widgets). — [Start.me blog](https://blog.start.me/netvibes-alternative/)
- Momentum: new-tab personal dashboard with to-do, weather, inspiration. — [AlternativeTo](https://alternativeto.net/software/momentum-personal-dashboard/?p=2)
- Netvibes' remaining enterprise product is marketed as brand/social-listening analytics with "AI-powered data analysis." [3P] — [GetApp](https://www.getapp.com/business-intelligence-analytics-software/a/netvibes/)

### Inferences
- Decline drivers (inference, not sourced here): feeds/widgets broke as sites dropped RSS and APIs, social feeds and mobile apps replaced start pages, and manual widget configuration was too much work. An agent that configures and maintains widgets from natural language directly attacks the configuration-cost problem that killed the category.

### Gaps
- iGoogle shutdown date (2013-11-01, from memory) not re-verified with a source in this pass.
- No sourced evidence on Start.me or Momentum adding generative AI features in 2025–2026.

---

## Overall inference for the founder (synthesis)
- Google already ships each *piece* separately: generative tab-apps (Disco, experimental), free email daily brief (Daily Brief, US), scheduled background agent (Spark, $19.99 Pro), persistent research (Gemini Notebook), agentic browsing (Chrome auto browse). No Google product found combines them into one persistent, agent-maintained, multi-tab personal workspace — but convergence risk is high given shared Gemini/Antigravity infrastructure.
- The open space: a durable visual workspace where each tab is owned and refreshed by scheduled jobs, spanning non-Google sources (job boards, arbitrary sites, non-Gmail mail), with user-editable structure.
