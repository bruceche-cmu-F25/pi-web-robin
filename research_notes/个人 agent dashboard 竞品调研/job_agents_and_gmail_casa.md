# AI job-search agents for individuals, and the Gmail restricted-scope (CASA) barrier — as of 2026-09-26

Research date: 2026-09-26. The research stopped after about 17 tool calls, so several vendor pricing pages were not fetched directly. Figures marked "(aggregator)" come from review or comparison sites rather than the vendor, so check them before quoting.

## A1. Competitor landscape: features, pricing, users, funding

### Takeaway
Most of the market sells two things: auto-apply volume (LazyApply, Sonara, AIApply, Jobright's agent, Tsenta) and resume or tracker tooling (Teal, Huntr, Careerflow, Simplify). The money is small next to the incumbents, which now bundle the same features: LinkedIn has Job Match and Premium Apply Assistant, and Indeed has Career Scout. The newest well-funded entrant (Jack & Jill, $60M) skips applications altogether and pairs a candidate agent with an employer agent.

### Cited Findings
**Jobright.ai**
- Markets itself as "the #1 AI job search agent — trusted by 2M+ tech professionals". It has 100k+ Chrome Web Store installs. — [Bounce Watch](https://bouncewatch.com/company/jobrightai)
- Total raised is $7.7M over 3 rounds from 5 investors. The latest was a $3.2M "Seed VC-II" on 2025-06-24. Founded 2023 in Santa Clara by Eric Yuan Cheng and Ethan Yudian Zheng. 97 employees as of 2026-07-26. — [Tracxn](https://tracxn.com/d/companies/jobright/__C3uOdHoPxR1xUlMQSwlRZ9KARuedthtYgO04KMkKLtM); [PitchBook](https://pitchbook.com/profiles/company/533317-60)
- Revenue was about $1M ARR (2024/2025 estimate). Latka lists it as "bootstrapped", which contradicts the $7.7M VC funding above. — [GetLatka](https://getlatka.com/companies/jobrightai)
- The pricing page (jobright.ai/pricing) returned 404 on fetch, so no current tier prices were verified. For third-party reviews, see [LoopCV](https://www.loopcv.pro/directory/jobright/) and [HiredRadar](https://hiredradar.com/jobright-ai-review/).

**Teal**
- Series A of $7.5M (announced 2025-01-22), co-led by CityLight Capital and Flybridge, with Rethink Capital Partners and Lerer Hippeau participating. Total raised is $19M. — [PR Newswire](https://www.prnewswire.com/news-releases/teal-announces-series-funding-expand-its-ai-powered-careers-platform-bringing-total-financing-raised-to-19-million-302357544.html)
- Teal+ costs $13 for 7 days, $29 for 30 days, or $79 for 90 days (aggregator). The pricing is time-boxed rather than a monthly subscription, which fits a finite job search. — [ToolsForHumans](https://www.toolsforhumans.ai/ai-tools/teal)
- Features: resume builder and job tracker. Teal requires manual skill entry and is more keyword-oriented, while Huntr scores resume alignment semantically (aggregator). — [JobShinobi comparison](https://www.jobshinobi.com/compare/huntr-vs-teal-vs-careerflow-job-tracker)

**Huntr**
- Pro costs $40/month, or $30/month billed quarterly, or $26.66/month billed every six months (aggregator). — [JobShinobi](https://www.jobshinobi.com/compare/huntr-vs-teal-vs-careerflow-job-tracker)
- No funding data found.

**Careerflow**
- Premium costs about $14/month and includes AI features, resume review and a LinkedIn profile optimizer (aggregator). — [JobShinobi](https://www.jobshinobi.com/compare/huntr-vs-teal-vs-careerflow-job-tracker); [Careerflow blog](https://www.careerflow.ai/blog/huntr-vs-teal-vs-careerflow)
- Funding data conflicts. Tracxn shows only a $20K Techstars round, while Latka estimates $5.6M ARR (2024), bootstrapped. — [Tracxn](https://tracxn.com/d/companies/careerflow/___tWiN1He5-oIbACs-yjbs9TjcAL3OhLrnMw8MlsMsLE/funding-and-investors); [GetLatka](https://getlatka.com/companies/careerflow.ai)

**Simplify**
- Its Copilot autofill extension has helped "1M+ job seekers" apply to "100M+ jobs" with a seven-person team (the company's own claim). — [YC directory](https://www.ycombinator.com/companies/industry/job-and-career-services)
- Raised a $3M seed in March 2024 led by Craft Ventures, for $4.35M total over 3 seed rounds. — [Tracxn](https://tracxn.com/d/companies/simplify-jobs/__Nghq6k46Vs-N_rZ2M26VOUDcy5eji4eK0ZC_K36a0HQ/funding-and-investors); [TechCrunch 2024-02-07](https://techcrunch.com/2024/02/07/simplify-looks-to-ai-to-help-with-job-searches-and-applications/). This data is from 2024 and may be stale.

**LazyApply**
- Basic costs $99/year for 15 applications/day and 1 resume profile. Premium costs $149/year for 150/day and 5 profiles. Ultimate costs $999/year for 1,500/day and 20 profiles. Lifetime deals are also sold on StackSocial. — [LoopCV](https://www.loopcv.pro/directory/lazyapply/); [LazyApply pricing](https://lazyapply-jobs.com/pricing/); [StackSocial](https://www.stacksocial.com/sales/lazyapply-job-application-lifetime-subscription?scsonar=1)

**Sonara (status)**
- Shut down abruptly on 2024-02-01 after failing to raise funding. Users lost access to their application queues mid-search. — [Resumly](https://www.resumly.ai/answers/what-happened-to-sonara-ai); [Teal review](https://www.tealhq.com/post/sonara-review)
- About 6 months later, BOLD (owner of LiveCareer, Zety and MyPerfectResume) acquired it. CEO Victor Schwartz joined BOLD. — [Lifeshack](https://www.lifeshack.com/resources/ai-industry-insights/sonara-ai-what-happened-complete-guide/)
- Live again as of June 2026: $2.95 trial, then $23.95 per 4 weeks or $71.40/year. Trustpilot 4.0/5 from 89 reviews. — [Resumly alternatives](https://www.resumly.ai/alternatives/sonara-alternatives); [Dreamwork](https://www.dreamworkhq.com/blog/sonara-ai-review)

**AIApply**
- Markets itself as "Job Application AI with Auto Apply". Pricing, users and funding were not retrieved. — [aiapply.co](https://aiapply.co/)

**Kickresume**
- Not researched (time limit). See Gaps.

**Tsenta**
- An AI career agent that matches, auto-applies and negotiates offers. Claims 90,000+ job seekers and about $3M annualized revenue within 3 months. — [YC directory](https://www.ycombinator.com/companies/industry/job-and-career-services)

**Adzuna ApplyIQ**
- An AI job-search agent launched in the US and UK in April 2025. — [Wikipedia: Adzuna](https://en.wikipedia.org/wiki/Adzuna)

**Jack & Jill**
- Raised a $40M Series A (reported 2026-09-16), led by Air Street Capital with Madrona, Creandum and Entrepreneurs First. Total raised is $60M after a $20M seed ten months earlier. — [SiliconANGLE](https://siliconangle.com/2026/09/16/jack-jill-raises-40m-to-change-the-face-of-job-hunting-with-ai-agents/)
- How it works: "Jack", a voice career-coach agent, talks to the candidate, and "Jill" works with employers. The two agents match on context, and there is no resume submission. Numbers: 5,000 companies, 25,000+ interviews facilitated, about 5,000 more per month, and 12,000+ hours of candidate conversation. — [SiliconANGLE](https://siliconangle.com/2026/09/16/jack-jill-raises-40m-to-change-the-face-of-job-hunting-with-ai-agents/)

**LinkedIn**
- Job Match shows how well you fit a role. Recommendations use embedding retrieval followed by an AI ranking model. — [bestjobsearchapps](https://bestjobsearchapps.com/articles/en/linkedin-ai-powered-job-search-features-stats-2026-guide)
- Premium Apply Assistant (reported as launched June 2026) pre-fills application fields, generates cover letters and assigns confidence scores. — [Jobsistant](https://www.jobsistant.com/guides/linkedin-2026-ai-changes). This comes from a secondary source only; no LinkedIn announcement was found.
- Premium Career plan page: [premium.linkedin.com](https://premium.linkedin.com/careers/career). Hiring Assistant is recruiter-side and was not researched.

**Indeed**
- Announced Career Scout (an AI career coach for career paths, resume customization and interview practice) along with Talent Scout on 2025-09-10. Indeed claims Career Scout users are 7x faster at finding and applying to jobs and 38% more likely to get hired. It partners with OpenAI to personalize job invitations. — [BusinessWire 2025-09-10](https://www.businesswire.com/news/home/20250910809034/en/Indeed-Introduces-New-Suite-of-Hiring-Products-Career-Scout-Talent-Scout-Premium-Sponsored-Jobs-and-Indeed-Connect)

### Inferences
- Pricing clusters at about $14–40/month or $99–150/year. Teal and Sonara both use 7-day, 4-week or 90-day plans, which suggests vendors price for a job search that ends rather than for a permanent subscription.
- Funding for individual-side tools is modest: Teal $19M, Jobright $7.7M, Simplify $4.35M. The large 2026 round (Jack & Jill) went to a two-sided marketplace where employers pay. That points to employer-side monetization as the route investors back.
- Distribution is a structural disadvantage. LinkedIn and Indeed now offer match scoring and apply assistance to their existing user bases.

### Gaps
- Current Jobright tier prices (pricing page returned 404), plus AIApply, Kickresume and Simplify+ pricing, users and funding.
- Huntr funding and user numbers.
- Official LinkedIn documentation for "Premium Apply Assistant" and AI job search as of 2026.

## A2. Churn after hire, and how vendors handle retention

### Takeaway
No hard data on churn after hire in this category turned up. The indirect signs all point the same way: time-boxed pricing, lifetime deals, and pivots toward coaching, career management or the employer side.

### Cited Findings
- Teal sells 7-, 30- and 90-day passes rather than only monthly or annual plans. — [ToolsForHumans](https://www.toolsforhumans.ai/ai-tools/teal)
- Sonara bills per 4 weeks, and its 2024 collapse came from failing to raise, not from lack of demand. — [Resumly](https://www.resumly.ai/answers/what-happened-to-sonara-ai)
- LazyApply sells lifetime licenses through StackSocial. — [StackSocial](https://www.stacksocial.com/sales/lazyapply-job-application-lifetime-subscription?scsonar=1)
- Retention strategies seen in the market:
  - Careerflow bundles a LinkedIn profile optimizer, which has uses beyond the job search. — [Careerflow blog](https://www.careerflow.ai/blog/huntr-vs-teal-vs-careerflow)
  - Indeed positions Career Scout as career-path coaching. — [BusinessWire](https://www.businesswire.com/news/home/20250910809034/en/Indeed-Introduces-New-Suite-of-Hiring-Products-Career-Scout-Talent-Scout-Premium-Sponsored-Jobs-and-Indeed-Connect)
  - Jack & Jill earns from employers. — [SiliconANGLE](https://siliconangle.com/2026/09/16/jack-jill-raises-40m-to-change-the-face-of-job-hunting-with-ai-agents/)
- General consumer-app benchmark for 2026: median retention is 25% at Day 1, 8% at Day 7 and 4% at Day 30. — [Userpilot](https://userpilot.com/blog/app-retention-strategies/). This covers all apps, not job search specifically.

### Inferences
- In job search, success causes churn, so lifetime value is capped at the length of a search, typically a few months. Retention strategies include:
  - keeping people for "passive" monitoring once they're employed
  - broadening into career management (learning, networking, compensation)
  - selling to employers
  - re-activating users at their next search.
- A personal agent dashboard with other workspaces (email, events, notes) could keep users after a hire, which the single-purpose tools cannot. This is untested.

### Gaps
- No published churn or LTV figures were found for Teal, Huntr, Jobright or others. Founder interviews and podcasts would be the next place to look.

## A3. Open-source job-search agents and their traction

### Takeaway
career-ops dominates. It is MIT-licensed, runs locally inside AI coding CLIs, and is reportedly #1 by stars in the GitHub #job-search topic. AIHawk was the 2024 open-source auto-apply wave; its creator has moved to a proprietary product and the original repo is fragmented into forks.

### Cited Findings
- career-ops (career-ops-hq/career-ops):
  - Runs locally in Claude Code, Codex, OpenCode, Copilot and similar CLIs.
  - Scores listings with an A–H structured report and a global 1–5 score (five dimensions plus a holistic score).
  - Scans 150+ job sources without spending tokens and tailors ATS PDF resumes.
  - Drafts answers to Greenhouse, Ashby and Lever form questions.
  - Includes a Go terminal dashboard.
  - No cloud, no telemetry, no account.
  - [GitHub](https://github.com/career-ops-hq/career-ops); [career-ops.org](https://career-ops.org/)
- career-ops star counts vary by date:
  - about 69.7k stars — [SkillsLLM](https://skillsllm.com/skill/career-ops)
  - "34K stars" in an earlier write-up — [CLSkills Hub](https://clskillshub.com/blog/career-ops-claude-agent)
  - claimed to be about 10x ahead of #2 in the #job-search topic — [SkillsLLM](https://skillsllm.com/skill/career-ops)
  - The current count was not verified directly on GitHub.
- The creator, Santiago Fernández de Valderrama, built it during his own 2026 search: 740 listings evaluated, 68 applications, 12 interviews, 1 offer. — [santifer.io](https://santifer.io/career-ops-system); [themenonlab](https://themenonlab.blog/blog/career-ops-ai-job-search-claude-code-skill)
- AIHawk (Jobs_Applier_AI_Agent / Auto_Jobs_Applier_AI_Agent):
  - A Python tool that auto-applies on LinkedIn, can send hundreds of applications a day, and generates resumes dynamically.
  - Its creator, Federico Elia (feder-cr), now works on a proprietary hiring product, and community contributors maintain the repo. Many forks exist.
  - [GitHub fork](https://github.com/Intusar/Auto_Jobs_Applier_AI_Agent); [Reworked](https://www.reworked.co/employee-experience/job-candidates-can-now-spam-employers-more-efficiently/)
  - No current star count was found.

### Inferences
- career-ops already offers for free what the founder's dashboard does: CV and rubric scoring plus portal scanning. The difference is that career-ops needs a coding CLI. The consumer opportunity is to package the same capability for people who don't use a terminal, with hosted scanning, a digest, and push to Telegram or mobile.

### Gaps
- Exact current star counts for career-ops and AIHawk.
- Whether career-ops has a hosted or commercial offshoot.

## A4. Underserved features

### Takeaway
The evidence is thin and mostly inferred. Three gaps stand out: a transparent personal scoring rubric the user can edit, direct scanning of company career pages and ATS boards (outside LinkedIn and Indeed), and markets outside the US. career-ops proves the demand for the first two among technical users.

### Cited Findings
- career-ops' main selling points are a custom rubric (A–H report, 1–5 score) and zero-token scanning of 150+ sources including Greenhouse, Ashby and Lever. Its traction (tens of thousands of stars) suggests commercial tools don't meet this need. — [GitHub](https://github.com/career-ops-hq/career-ops)
- Jobright targets "tech professionals" specifically. — [Bounce Watch](https://bouncewatch.com/company/jobrightai)
- Adzuna ApplyIQ launched only in the US and UK. — [Wikipedia: Adzuna](https://en.wikipedia.org/wiki/Adzuna)
- Commercial matching mostly uses the vendor's own opaque score, such as LinkedIn Job Match's embedding and ranking model. — [bestjobsearchapps](https://bestjobsearchapps.com/articles/en/linkedin-ai-powered-job-search-features-stats-2026-guide)
- Auto-apply tools are criticized as spamming employers. — [Reworked](https://www.reworked.co/employee-experience/job-candidates-can-now-spam-employers-more-efficiently/)

### Inferences
- Plausibly underserved:
  - a rubric the user controls and can explain, rather than a black-box match percentage
  - quality over volume: fewer, better applications, as a reaction to auto-apply spam
  - direct ATS and career-page coverage, including companies that don't post on LinkedIn
  - niche or senior roles, and roles outside tech
  - non-US markets (EU, APAC, Chinese-language) where Jobright, Simplify and others focus on the US
  - a daily digest in messaging apps (Telegram, WhatsApp) instead of email or app notifications
- None of these were confirmed by user surveys in this research.

### Gaps
- No survey data or Reddit or HN sentiment analysis was collected on unmet needs.

## B1. Gmail restricted scopes, CASA requirements, tiers, costs, timeline, user cap, exceptions

### Takeaway
Reading Gmail content in any form requires restricted-scope verification: `gmail.readonly`, `gmail.metadata`, `gmail.modify`, and full `https://mail.google.com/`, which also covers IMAP over OAuth. If data can reach a third-party server, it also needs a yearly CASA assessment. For a small app this is usually Tier 2 / AL1. TAC Security has quoted about $540–1,800 per year for Tier 2 and about $4,500 for Tier 3; Google decides the tier. Plan on roughly 2 months end to end. Until verified, an app can have at most 100 users.

### Cited Findings
- Restricted Gmail scopes: `gmail.readonly`, `gmail.metadata`, `gmail.modify`, `gmail.compose`, `gmail.insert`, `gmail.settings.basic`, `https://mail.google.com/`. Sensitive but not restricted: `gmail.send`, `gmail.labels`. — [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa). This is secondary; the official list is in Google's [OAuth API Verification FAQ](https://support.google.com/cloud/answer/9110914), which was not fetched.
- Official rule: "Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment" (the App Defense Alliance CASA framework). — [Google: Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) (page last updated 2026-08-19)
- Official exemptions from verification:
  1. personal use (the developer or a few known users)
  2. development or testing, with publishing status set to "Testing"
  3. service accounts accessing only their own data
  4. internal use within one Workspace or Cloud Identity organization
  5. domain-wide installation for Workspace customers
  - [Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- Annual reassessment: a new security assessment is required at least every 12 months after the assessor's Letter of Assessment (LOA) date. — [Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). The reassessment is a full re-test, and the assigned level can go up as users grow. — [DeepStrike](https://deepstrike.io/blog/google-casa-security-assessment-2025)
- Tiers are now called Assurance Levels, and the requirements are unchanged:
  - AL0 / Tier 1: self-assessment
  - AL1 / Tier 2: developer-tested, lab-reviewed
  - AL2 / Tier 3: lab-tested
  - "You do not choose your level, Google does", based on data sensitivity, user count and risk signals.
  - [DeepStrike](https://deepstrike.io/blog/google-casa-security-assessment-2025)
- Costs:
  - TAC Security quotes about $540–1,800/year for Tier 2 and about $4,500 for Tier 3. The industry range is about $500–4,500/year. Other labs include Leviathan, DEKRA and Bishop Fox. — [DeepStrike](https://deepstrike.io/blog/google-casa-security-assessment-2025); [Bright Softwares](https://bright-softwares.com/blog/en/google-workspace/the-50000-gmail-add-on-myth-what-google-s-casa-certification-really-costs)
  - Google charges no fee itself. — [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa)
- Stale figure: the older $15,000–75,000 assessment costs date from the 2019–2022 era of pen-test-style assessments. — [GMass blog](https://www.gmass.co/blog/google-oauth-verification-security-assessment/)
- Some indie developers still find quotes unaffordable (Latenode community thread, June 2025). — [Latenode](https://community.latenode.com/t/is-casa-tier-2-assessment-necessary-for-all-gmail-api-apps-options-for-indie-developers/22861)
- Timeline:
  - brand verification: 2–3 business days
  - sensitive-scope review: about 10 business days
  - restricted-scope review: about 6 weeks — [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa)
  - CASA testing: 1–3 weeks for Tier 2, 2–4 weeks for Tier 3; budget about 2 months including remediation — [DeepStrike](https://deepstrike.io/blog/google-casa-security-assessment-2025)
- Reports of passing Tier 2 quickly: [Orbis, "passed CASA Tier 2 in a weekend"](https://meetorbis.com/blog/how-we-passed-google-casa-tier-2-with-claude); [CellCog](https://cellcog.ai/blog/casa-security-assessment/)
- User caps:
  - Testing mode allows up to 100 manually listed test users, and their authorizations expire after 7 days.
  - A published but unverified app is capped at 100 new users total.
  - Google also caps refresh tokens at 100 per Google Account per OAuth client ID.
  - [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa); [GMass](https://www.gmass.co/blog/google-oauth-verification-security-assessment/)
  - Google's own restricted-scope page mentions a user cap but gives no number there.
- Local / on-device apps: a client-only app that keeps restricted data on the user's device "has an argument" for skipping CASA; a server-side agent does not. — [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa). This follows the "third-party server" wording in Google's rule above.
- Bring-your-own OAuth client: a customer's Workspace admin registers an Internal app, or each customer brings their own OAuth client, which moves the verification burden to them. — [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa). This fits Google's "personal use" and "Testing" exemptions.
- How an indie mail client handled it: Mimestream, a native macOS Gmail client built on the Gmail API, completed restricted-scope verification and CASA Tier 2 with TAC Security. — [Mimestream blog](https://mimestream.com/blog/casa-verified); [Mimestream Trust](https://mimestream.com/trust/security-and-privacy)
- 2025–2026 policy additions (secondary source, as of September 2026):
  - Google now requires protection against prompt injection ("Model Armor or other prompt injection protection").
  - Google prohibits using user data to train AI or ML models beyond that user's own personalized model.
  - [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa). Not verified against a Google primary page.
- Scope minimization tip: you may qualify for `gmail.modify` instead of full `mail.google.com` by never permanently deleting mail. — [Bright Softwares](https://bright-softwares.com/blog/en/google-workspace/the-50000-gmail-add-on-myth-what-google-s-casa-certification-really-costs). Note that `gmail.modify` is still restricted, so this avoids the broadest scope but not CASA.

### Inferences
- For a hosted consumer product that reads Gmail on a server, expect Tier 2:
  - out-of-pocket cost of about $0.5–2k per year
  - plus engineering time to pass the DAST/ASVS checks
  - about 2 months of calendar time
  - the whole process repeated every year
- Cost is no longer the barrier. The real burdens are the calendar time, the yearly re-test, the prompt-injection and AI-training policy obligations, and the fact that Google assigns the tier.
- Mimestream went through CASA even though it is a desktop client, so a "local-only" design shouldn't be treated as a guaranteed exemption. It may only lower the assessed tier, or restricted-scope verification may still be needed without CASA.
- For the founder's current personal dashboard, the "personal use" or "Testing" exemption (the founder's own OAuth client, up to 100 test users, 7-day token expiry) is enough. A BYO-client flow could extend this to technical early users without verification.

### Gaps
- Leviathan's current published price (not fetched). Whether TAC's $540 figure is still current in September 2026.
- A primary Google source for the September 2026 prompt-injection requirement.
- Google's official current wording for the 100-user cap. It appears in secondary sources but was not seen on the fetched Google page.

## B2. Alternatives: IMAP with app passwords, and Microsoft Graph for Outlook

### Takeaway
Gmail IMAP with a user-generated App Password (2-Step Verification required) avoids OAuth and CASA entirely, at a real cost in user experience and trust. IMAP over OAuth needs the restricted `mail.google.com` scope, so it saves nothing. For Outlook and Microsoft 365, mailbox permissions such as Mail.Read and Mail.ReadWrite increasingly need admin consent in work tenants, and publisher verification removes the "unverified" label.

### Cited Findings
- Less Secure Apps (plain-password IMAP) ended for personal Gmail in May 2022 and for Workspace in early 2025 (sources say March 14, 2025 or May 2025, which conflict). The replacements are OAuth or an App Password, and App Passwords require 2-Step Verification. — [Mailbird](https://www.getmailbird.com/gmail-oauth-changes-app-password-phase-out/); [Google Workspace Admin Help](https://support.google.com/a/answer/14114704?hl=en); [devanswers](https://devanswers.net/allow-less-secure-apps-access-gmail-account/)
- App Passwords are generated at myaccount.google.com/apppasswords. The page appears only once 2-Step Verification is on. — [devanswers](https://devanswers.net/allow-less-secure-apps-access-gmail-account/)
- `https://mail.google.com/`, the scope IMAP-over-OAuth uses, is restricted. — [Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa)
- Microsoft:
  - Mail.ReadWrite is "high impact" and is blocked from end-user consent under Microsoft's recommended consent policy. Under the Microsoft-managed default policy, Graph permissions that access Exchange mailbox data require admin consent. — [Unipile 2026 guide](https://www.unipile.com/microsoft-graph-oauth-email/); [Microsoft Learn: consent policies](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies); related Q&A on MC1163922: [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5572742/clarification-on-mc1163922)
  - Becoming a verified publisher through the Microsoft Partner Network removes the "unverified" label, and tenants set to "users can only consent to verified publishers" require it. — [Unipile](https://www.unipile.com/microsoft-graph-oauth-email/)
  - No Microsoft equivalent of CASA with a paid annual lab assessment was found for Graph Mail.

### Inferences
- A pragmatic launch path:
  1. Ship Gmail reading through the user's own App Password over IMAP, or a BYO OAuth client, for early adopters.
  2. Alternatively, have users forward mail or set up a filter that forwards job-related mail to an inbox the app owns, which avoids reading the user's mailbox at all.
  3. Start CASA Tier 2 only once the job-search wedge is validated.
- For personal Outlook.com accounts (Microsoft consumer accounts), admin consent doesn't apply. Work tenants are the harder case.
- Storing App Passwords server-side is a security liability, and it would likely create a new target for security review anyway.

### Gaps
- Microsoft's official current policy for consumer (MSA) accounts using Mail.Read, and whether publisher verification is mandatory for multi-tenant apps created after 2020. Primary Microsoft docs were not fetched in full.
- Whether Google has announced any further App Password restrictions for personal accounts in 2026. The Mailbird article title hints at a "phase-out", but that was not verified.
