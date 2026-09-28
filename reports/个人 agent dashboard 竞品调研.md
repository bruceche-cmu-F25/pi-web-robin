# 拼图都已出货，但没人拼成一个

截至 2026 年 9 月 26 日，**还没有任何一家公司把"agent 用自然语言建立多个持久 workspace/tab，再由后台定时任务持续维护"做成一个完整的个人产品**。不过，这个形态的每一块能力都已经有巨头在卖。OpenAI 的 ChatGPT Sites 加上事件触发的 Scheduled Tasks，是最接近的一组。Claude 的 artifact 已经能带存储和 connector，并有云端定时任务。Notion Custom Agents 能按计划写入数据库。Google 把 Gmail 每日简报在美国免费化了，另有 24/7 后台 agent Spark 和实验性的 GenTabs。开源的 Hermes Agent 甚至有一个"每天自动刷新的 Live Dashboard"技能，几乎就是这个概念本身。几家巨头的共同短板是：都跑在云端，后台能力都锁在付费档，产品形态一年内反复推翻（Pulse、ChatGPT agent、Atlas 在约 12 个月内全部下线，Claude artifact 在 4 周里换了两次格式），而且主要围绕自家数据源。**真正的空档很窄**：一个本地优先、数据归用户所有、跨非 Google 来源（ATS、任意网站、非 Gmail 邮箱）、由用户显式定义每个 tab 和任务的持久可视工作台。对已经有成熟求职 workspace 的独立创业者，建议是：以"透明 rubric + 直连 ATS 的求职 tab"做切入点，走"开源核心 + 免费桌面 app + 付费云端 runner（含额度，支持 BYOK）"。Gmail 早期用 BYO OAuth client、IMAP 应用专用密码或邮件转发绕开 CASA；等云端 runner 需要在服务器上读信时，再预留约 2 个月和每年 $0.5–2k 做 CASA Tier 2。

## 竞品地图：按离"agent 建并维护持久 workspace"的距离分五层

下表按离目标形态的距离排序。"持久"指 workspace 能跨会话保留并被再次编辑；"后台维护"指无人值守的定时或事件任务会更新这个 workspace 本身，而不只是发一条消息。

| 距离 | 产品 | 持久 workspace | 后台维护 | 关键限制 |
|---|---|---|---|---|
| 最近 | OpenAI ChatGPT Sites + Scheduled Tasks | 有（托管站点，带 D1 数据库） | 有（定时刷新；Gmail/Slack/GitHub 事件触发） | 仅付费档；定位是"发布站点/应用"；频率下限约每小时一次 |
| 最近 | Hermes Agent Live Dashboard（开源技能） | 有（状态页） | 有（每日刷新） | 只是一个可选技能，成熟度未知 |
| 很近 | Claude artifacts + Cowork 定时任务 | 有（20 MB 存储） | 部分（任务输出与 artifact 分离） | 概念割裂；带 connector 的 artifact 不能公开分享 |
| 很近 | Notion Custom Agents | 有（页面/数据库） | 有（定时或事件触发） | 仅 Business/Enterprise，按额度计费；页面是通用形态 |
| 中 | Google：Spark / Daily Brief / Gemini Notebook / Disco GenTabs | 分散 | Spark 有，其余没有 | 能力拆在四个产品里；GenTabs 仍在候补名单阶段 |
| 中 | OpenClaw 等开源本地 agent | Control UI 有 workspace | 有（常驻进程） | 以消息应用为主界面；安全事故多 |
| 远 | Agent 浏览器（Comet、Dia、Neon） | Tasks/Cards 只是保存的 prompt | 定时摘要 | 没有持久的主题 UI |
| 远 | 初创公司（Instinct、Poke、Lindy、Fambot） | 没有，靠聊天线程 | 主动推送 | 消息优先，没有可视工作台 |
| 垂直 | 求职工具（Jobright、Teal、career-ops 等） | 单一求职看板 | 部分 | 只做一个领域；求职成功即流失 |

### OpenAI 离目标最近，但它的消费级 agent 产品线最不稳定

OpenAI 在 2026 年 6 月 17 日下线 Pulse，理由是"主动更新转入 scheduled tasks"。重做后的 Scheduled Tasks 支持一次性、周期性和"监控变化"三种任务 ([OpenAI release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)，原页对抓取返回 403，内容来自搜索摘要，另有 [TechJack](https://techjacksolutions.com/ai-brief/agentic-ai-news-openai-launches-scheduled-tasks-in-chatgpt-a/) 佐证)。**8 月 25 日起，任务可以由 Gmail、Slack、GitHub 事件触发**，支持按发件人和主题过滤 ([ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog))。更关键的是 **ChatGPT Sites**：6 月 2 日在 Codex app 里开放预览，可以创建并部署由 OpenAI 托管的"网站、dashboard、内部工具、web app"，7 月 9 日加入自定义域名 ([changelog](https://learn.chatgpt.com/docs/changelog))。官方点名的用例正是"live dashboards、project trackers" ([OpenAI](https://openai.com/index/chatgpt-for-your-most-ambitious-work/)，同样只取到搜索摘要)。据二手资料，Sites 把数据存在自己的 Cloudflare D1 数据库里，支持定时刷新；Free 和 Go 档不可用，上线时 EEA、瑞士和英国也不可用 ([GenAI Unplugged](https://genaiunplugged.substack.com/p/chatgpt-sites-vs-claude-artifacts))。

能力上，这已经相当于"agent 建的、后台刷新的持久 dashboard"。差距在产品框架上：Sites 被放在 Work/Codex 里，叫"发布一个站点"，而不是"我的个人主页，由 agent 维护的 N 个 tab"。同一时期，ChatGPT agent 在 8 月初被无预告移除 ([usecarly](https://www.usecarly.com/blog/chatgpt-agent-mode/)，二手)，Atlas 浏览器 8 月 9 日停止工作 ([Search Engine Land](https://searchengineland.com/openai-chatgpt-atlas-deprecation-482003))。Atlas 的"浏览器记忆"原本是最接近"聚合用户常去网站"的一方功能，现在也没了。另有泄露的 Pro 升级页提到一个"always-on assistant 'o'" ([progressiverobot](https://www.progressiverobot.com/2026/09/26/openai-always-on-assistant-o/)，**低可信，未证实**)。

### Claude 和 Notion 已经能做，但一个要自己拼，一个按团队定价

Claude 付费用户今天就能拼出一个自动更新的个人 dashboard。artifact 支持 **20 MB 纯文本存储**（个人或共享）、连接应用、在 artifact 内直接调用 Claude ([Claude 帮助中心](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them))。Cowork 定时任务在 Anthropic 云端运行，电脑休眠时也会跑，频率可选每小时、每天、每周；这个功能不能绑定本地文件夹 ([Claude 帮助中心](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork))。弱点在于组合方式。定时任务的输出进"Scheduled tasks"区，而 artifact 打开时用的是**查看者自己的 connector** ([Cowork live artifacts](https://support.claude.com/en/articles/14729249-use-live-artifacts-in-claude-cowork))，所以"后台任务直接写进 dashboard"这件事没有文档说明。此外，2026-08-19 和 2026-09-16 两次格式迁移说明这个界面还没定型 ([Claude 帮助中心](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them))。

Notion 在"结构化持久 workspace + 定时 agent"这个维度上最成熟。Notion 3.3（2026-02-24）的 Custom Agents 可以**按计划或事件自主运行**，处理分诊、日报、邮件草稿等任务 ([Notion 3.3](https://www.notion.com/releases/2026-02-24))；3.4 又加入了会持续补全和分类数据库行的 AI Autofill ([Notion 3.4](https://www.notion.com/releases/2026-04-14))。但 Custom Agents **只对 Business/Enterprise 开放，从 5 月 4 日起按额度计费**，额度用完 agent 就暂停 ([Notion 定价](https://www.notion.com/help/custom-agent-pricing?indexHtmlPath=index-web-en-US-0e192f14766ed7cd))。二手资料称额度价格是 $10/1,000，有一位重度用户一个月用了 33,700 额度（$337） ([Matthias Frank](https://matthiasfrank.de/en/notion-agent-pricing/))。一个人想用上定时 agent，起步就是约 $20–24 的座位费加上用量费，这是 B2B 的价格结构。

### Google 把每块能力拆成独立产品，并把邮件简报做成了免费功能

Google 手里有全部零件，但它们分散在不同产品里。**Gemini Daily Brief 在 2026-09-08 对所有美国个人账户免费** ([Droid Life](https://www.droid-life.com/2026/09/08/google-makes-geminis-daily-brief-a-free-feature/)；[Gemini 帮助](https://support.google.com/gemini/answer/17077455?hl=en&co=GENIE.Platform%3DDesktop))，所以单靠"Gmail 每日摘要"已经无法收费。**Gemini Spark**（2026-05-19 发布）是 24/7 云端 agent，提供 Tasks、Skills、Schedules 三种机制，可以按时间或按邮件事件触发，官方示例里就有"追踪实习机会" ([Spark 官方页](https://gemini.google/overview/agent/spark/))，对 Pro 和 Ultra 开放。但它的输出进聊天、邮件或 Docs/Sheets，不会生成一个持续维护的可视界面。**Disco/GenTabs** 用自然语言把打开的 tab 变成交互式小应用，UI 层最接近 ([Google blog](https://blog.google/innovation-and-ai/models-and-research/google-labs/gentabs-gemini-3/))，但它只支持 macOS，需要排候补名单，官方也没说明是否持久或会定时刷新；2026 年的状态没有找到一手资料。NotebookLM 在 7 月 16 日改名 **Gemini Notebook**，每个 notebook 附带一台云端计算机 ([Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/))，但刷新要手动同步来源，没有网站监控。原来的 CC 在 9 月 18 日转型为家庭事务 agent ([TechCrunch](https://techcrunch.com/2026/09/18/googles-new-cc-is-an-ai-agent-that-helps-families-run-their-households/))。Gemini 与 Antigravity 是这些产品的共用基础设施，所以 Google 把它们合并起来的风险很高。

### 开源本地 agent：OpenClaw 验证了需求，Hermes 验证了形态

OpenClaw 是最有参考价值的先例。它 2025 年 11 月首发，2026 年 1 月两次改名；**截至 3 月 2 日有 247,000 stars** ([Wikipedia](https://en.wikipedia.org/wiki/OpenClaw))，3 月 3 日超过 React ([The New Stack](https://thenewstack.io/openclaw-github-stars-security/))。创始人 Steinberger 2 月 15 日加入 OpenAI，项目转入基金会 ([CNBC](https://www.cnbc.com/2026/02/15/openclaw-creator-peter-steinberger-joining-openai-altman-says.html))。他给出的理由是想做"an agent that even my mum can use" ([steipete.me](https://steipete.me/posts/2026/openclaw))，等于作者本人承认 OpenClaw 还不适合普通人。它的主界面是 Telegram、WhatsApp 等聊天应用，同时有本地 Control UI（`127.0.0.1:18789`）和一键安装脚本 ([docs.openclaw.ai](https://docs.openclaw.ai/))。7 月的 v2026.7.1 把 Control UI 改成"chat、sessions、workspaces、usage tracking"加 workspace 终端 ([release notes](https://docs.openclaw.ai/releases/2026.7.1))，和这位创业者现有的 pi-web 形态几乎一样。代价是安全：一次审计在 2,857 个 ClawHub 技能里发现 **341 个恶意技能（约 12%）**，多数投递 macOS 窃密木马 ([Trend Micro](https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html)；[eSecurity Planet](https://www.esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub/))，另有 30,000 多个实例暴露在公网 ([Conscia](https://conscia.com/blog/the-openclaw-security-crisis/))。常被引用的"3.2M MAU、50 万实例"来自托管商 openclawvps.io，**不可作为事实引用** ([openclawvps.io](https://openclawvps.io/blog/openclaw-statistics))。

Nous Research 的 **Hermes Agent** 在这次调研里只查到一条，但分量很重：它的 Live Dashboard 技能能把"为签证申请做一个 dashboard，每天从邮件线程和案件状态网站更新"这样的请求变成一个自动刷新的持久状态页 ([Hermes docs](https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/productivity/productivity-live-dashboard))。Hermes 的 stars、用户量和该技能的成熟度都没有查到，是本报告的一个缺口。其余开源项目，如 Goose ([Wikipedia](https://en.wikipedia.org/wiki/Goose_(AI_agent)))、AnythingLLM ([anythingllm.com](https://anythingllm.com/))、Eigent ([GitHub](https://github.com/eigent-ai/eigent))，都做通用聊天或 Cowork 形态，没有做垂直的个人 workspace。

### 初创公司和 agent 浏览器押注聊天与主动推送，没人做可视工作台

2026 年的资本流向了**消息优先的主动助手**。Instinct 通过短信或电话代办事务，8 月 26 日宣布累计融资 $350M、估值 $2.5B，同时因权限过宽受到隐私批评 ([TechCrunch](https://techcrunch.com/2026/08/26/viral-ai-startup-instinct-has-raised-350-million-at-a-2-5-billion-valuation/))。Poke 7 月被 Cognition 收购 ([TechCrunch](https://techcrunch.com/2026/07/24/why-cognition-bought-poke-ai-personality-is-becoming-a-competitive-advantage/))。Fambot 9 月 1 日推出家长版"AI chief of staff"，把邮件、日历、WhatsApp 群汇总成固定的清单视图，融资 $3.5M ([TechCrunch](https://techcrunch.com/2026/09/01/fambot-introduces-an-ai-chief-of-staff-for-families/))。Lindy 转型为消费级执行助理，定价据称 $49.99–199.99/月 ([getmacha](https://www.getmacha.com/blog/lindy-ai-pricing-explained)，**聚合站，与标题中的价格区间矛盾**)。这些产品都没有持久的可视界面。Agent 浏览器也一样。Dia 8 月 18 日推出付费档，$100/月的档位才有 Morning Brief 和 Reports ([PiunikaWeb](https://piunikaweb.com/2026/08/18/dia-announces-expensive-monthly-ai-plans/))。Perplexity 的 Personal Computer 可以在 Mac mini 上 24/7 运行，但只对 $200/月的 Max 用户开放 ([MacRumors](https://www.macrumors.com/2026/04/16/perplexity-personal-computer-for-mac/))。Comet 的定时任务只有第三方描述 ([eesel](https://www.eesel.ai/blog/perplexity-comet-pricing))。Taskade Genesis 用自然语言生成带定时更新的 web app ([Taskade blog](https://www.taskade.com/blog/ai-dashboard-examples))，面向团队。GitHub 上已经出现同名的业余项目"Personal Agent Dashboard" ([GitHub](https://github.com/matt-huesman/personal-agent-dashboard/pull/1))。

### 垂直求职工具：钱少，求职成功即流失，开源 career-ops 占据技术用户

个人侧求职工具的融资规模不大。Teal 累计 $19M ([PR Newswire](https://www.prnewswire.com/news-releases/teal-announces-series-funding-expand-its-ai-powered-careers-platform-bringing-total-financing-raised-to-19-million-302357544.html))，Jobright 累计 $7.7M ([Tracxn](https://tracxn.com/d/companies/jobright/__C3uOdHoPxR1xUlMQSwlRZ9KARuedthtYgO04KMkKLtM))。Jobright 约 $1M ARR 的估计来自 Latka，而 Latka 同时把它标成"bootstrapped"，与融资记录矛盾 ([GetLatka](https://getlatka.com/companies/jobrightai))，**可信度低**。定价普遍按求职周期设计。Teal 卖 7 天、30 天、90 天通行证（$13/$29/$79） ([ToolsForHumans](https://www.toolsforhumans.ai/ai-tools/teal)，聚合站)。LazyApply 卖年费和终身版 ([LazyApply](https://lazyapply-jobs.com/pricing/))。Sonara 2024 年因融资失败突然关停，用户的投递队列中途丢失 ([Resumly](https://www.resumly.ai/answers/what-happened-to-sonara-ai))。2026 年最大的一笔融资给了 **Jack & Jill（A 轮 $40M，累计 $60M）**，它完全绕开简历投递，是双边撮合、由雇主付费的模式 ([SiliconANGLE](https://siliconangle.com/2026/09/16/jack-jill-raises-40m-to-change-the-face-of-job-hunting-with-ai-agents/))。

对这位创业者最直接的对手是开源的 **career-ops**。它 MIT 许可，在 Claude Code、Codex 等 CLI 里本地运行；用 A–H 结构化报告加 1–5 分给职位打分，不消耗 token 扫描 150 多个来源（含 Greenhouse、Ashby、Lever），不上云、无遥测 ([GitHub](https://github.com/career-ops-hq/career-ops))。作者用它评估了 740 个职位，投了 68 份，拿到 12 次面试和 1 个 offer ([santifer.io](https://santifer.io/career-ops-system))。star 数的说法从 34k 到约 69.7k 不等 ([SkillsLLM](https://skillsllm.com/skill/career-ops)；[CLSkills Hub](https://clskillshub.com/blog/career-ops-claude-agent))，**均来自聚合站，没有在 GitHub 上核实**。career-ops 证明技术用户需要"可解释的自定义 rubric + 直连 ATS"，而它唯一的门槛是必须会用终端和 coding CLI。LinkedIn 据报道 2026 年 6 月上线 Premium Apply Assistant ([Jobsistant](https://www.jobsistant.com/guides/linkedin-2026-ai-changes)，**只有二手来源，未见 LinkedIn 官方公告**)。Indeed 有 Career Scout ([BusinessWire](https://www.businesswire.com/news/home/20250910809034/en/Indeed-Introduces-New-Suite-of-Hiring-Products-Career-Scout-Talent-Scout-Premium-Sponsored-Jobs-and-Indeed-Connect))。这两家平台都在用自己的分发渠道免费提供匹配分和投递辅助。

## 巨头的四个共同弱点，就是空档的边界

把各层放在一起看，弱点高度一致。**第一，全部跑在云端**：ChatGPT Sites、Claude 定时任务、Spark、Notion 都把用户数据和任务放在厂商服务器上，Claude 定时任务明确不能绑定本地文件夹。**第二，后台能力锁在付费档**：Sites 不对 Free/Go 开放，Claude 定时任务从 Pro 起，Spark 从 Pro 起，Notion 从 Business 座位起，Dia 的简报要 $100/月。OpenAI 定时任务还有约每小时一次的频率下限，用户不互动就会自动暂停 ([usecarly](https://www.usecarly.com/blog/chatgpt-scheduled-tasks/)；关于 Free 档是否有 3 个任务，二手来源互相矛盾，未解决)。**第三，形态反复推翻**：Pulse、ChatGPT agent、Atlas 在一年内接连下线，Claude artifact 四周内换了两次格式。用户交给它们维护的"持久"工作台，自己可能都不持久。**第四，偏向自家数据源**：Google 以 Workspace 为中心，Notion 以团队 SaaS connector 为中心。没有一家在持续监控用户常去的任意网站，或公司 career page 和 ATS。Atlas 的浏览器记忆是唯一接近的功能，已经被砍掉。

失败案例提供了另一个方向的教训。OpenAI 下线 Pulse 的原因据称是话题过时、打断时机差、只有卡片没有行动 ([prowlo](https://prowlo.com/blog/chatgpt-pulse-shut-down)，**聚合站，未与官方核对**)，替代方案是用户显式配置的任务。这支持"由用户用自然语言命名每个 tab 和任务，agent 负责维护"，而不是让 agent 自己推测用户想看什么。硬件路线（Humane、Rabbit、Limitless）要么失败，要么被收购 ([9to5Mac](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/)；[TechSpot](https://www.techspot.com/news/110256-rabbit-employees-they-havent-paid-months-but-r1.html))。老一代的起始页也没撑下来：Netvibes 2025 年 6 月 2 日关闭消费版，幸存者只剩静态 widget 页 ([Wikipedia](https://en.wikipedia.org/wiki/Netvibes))。一个合理的推论是：那一代 dashboard 死于配置成本太高，而 agent 用自然语言配置并维护 widget，正好解决这个问题。

因此，**空档是一个本地优先、数据归用户所有的持久可视工作台**：每个 tab 由用户定义，由定时任务拥有并刷新；数据来源跨越 Google 以外的 ATS、任意网站和非 Gmail 邮箱；结果同时出现在工作台里和 Telegram 这类消息通道里。"agent 生成 UI"本身已经商品化（GenTabs、Sites、artifacts、Taskade、Hermes），"每日邮件摘要"已经免费，"网站变更监控"每人每月约 $10–15 就能买到 ([Visualping](https://visualping.io/)；[pagecrawl](https://pagecrawl.io/blog/best-ai-website-monitoring-tools))。这三样单独都卖不出价钱。能守住的，是持久性、定时刷新、个人数据和本地所有权的组合，加上一个足够深的垂直 tab。

## 商业模式：额度订阅已成共识，开源项目的收入流向了托管商

2026 年，AI 工具的定价收敛到**订阅内含等额额度，再加 BYOK 或超额付费**。Cursor 2025 年 6 月改成与 API 成本挂钩的额度池，Pro $20 含 $20 前沿模型用量，并为意外扣费公开道歉退款 ([Vantage](https://www.vantage.sh/blog/cursor-pricing-explained)；[Finout](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips))。Warp 合并成 $20/月、1,500 额度加 BYOK 的单一方案 ([Warp blog](https://www.warp.dev/blog/warp-new-pricing-flexibility-byok))。Raycast 在 2026 年 9 月 10 日改为 $10/$20/$50 三档额度，并允许用户接入自己的 ChatGPT 或 Claude 订阅而不消耗 Raycast 额度，理由是"we can't subsidize it the way the big model labs can" ([Raycast blog](https://www.raycast.com/blog/changing-how-raycast-ai-is-priced))。这里有一个没解开的矛盾：Anthropic 从 2026 年 4 月 4 日起禁止第三方 harness 使用 Claude 订阅 OAuth ([MindStudio](https://www.mindstudio.ai/blog/anthropic-openclaw-ban-oauth-authentication))，Raycast 如何接入 Claude 订阅没有查到，可能是官方合作，**需要核实**。对一个独立的本地 agent 来说，暂时不能指望搭用户 $20 Claude 订阅的便车。

| 模式 | 先例（价格） | 对本项目的含义 |
|---|---|---|
| BYOK | OpenClaw 要求用户自带 API key ([docs](https://docs.openclaw.ai/))；Warp、Raycast 提供 BYOK 通道 | 零毛利风险，但主流用户卡在"去哪拿 key" |
| 订阅含额度 | Cursor $20/$60/$200；Warp $20；Raycast $10/$20/$50 | 从第一天就按额度计价，别等以后再迁移 |
| 免费本地 app + 付费同步/云 | Obsidian Sync $4–10/月 ([obsidian.md](https://obsidian.md/pricing))；Msty $149/年或 $349 终身 ([msty.ai](https://msty.ai/pricing/))；Ollama 云 $20/$100（聚合站） | 最贴合"开源 + 桌面 app"路线 |
| 云端 runner | 35+ 家 OpenClaw 托管商，$0.99/月起 ([clawdocs](https://clawdocs.org/guides/hosting-providers))；Cloudflare Moltworker $5/月加计算费 ([GitHub](https://github.com/cloudflare/moltworker))；AnythingLLM Cloud $50/$99 ([anythingllm.com/cloud](https://anythingllm.com/cloud)) | 电脑休眠时让任务照常运行，这是本地产品最自然的收费点 |
| Open-core + 托管 | n8n 2026 年 4 月 $100M ARR ([Sacra](https://sacra.com/c/n8n/))；Supabase 2026 年 5 月 $170M ARR ([Sacra](https://sacra.com/c/supabase/)) | 公开收入证据最强，但都是开发者/B2B 市场 |
| 按求职周期计费 | Teal $13/7 天、$79/90 天；Sonara $23.95/4 周 | 求职 tab 可以单独卖短期通行证 |

最值得记住的反面教训来自 OpenClaw：托管和常驻 runner 的收入**全部流向了第三方**，包括 35 家以上的托管商和 Cloudflare，项目本身没有商业实体 ([CNBC](https://www.cnbc.com/2026/02/15/openclaw-creator-peter-steinberger-joining-openai-altman-says.html))。一个开源本地 agent 如果不提供自己的托管档，就等于把最自然的收入让给别人。毛利风险同样真实。Anthropic 2025 年 8 月为 Claude Code 加周限额，理由之一就是 24/7 自动化 ([Portkey](https://portkey.ai/blog/claude-code-limits/))。一个全天候扫描职位、分诊邮件的个人 agent，结构上正是这种 24/7 自动化用户，所以额度池必须设硬上限，默认用便宜模型，同时保留 BYOK 通道。

## Gmail：CASA 已经不贵，真正的成本是两个月日历时间和每年重审

读取 Gmail 内容的所有 scope 都是 restricted：`gmail.readonly`、`gmail.metadata`、`gmail.modify`，以及走 OAuth 的 IMAP 所需的 `https://mail.google.com/` ([Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa)，二手来源；官方清单见 [Google FAQ](https://support.google.com/cloud/answer/9110914)，未抓取)。Google 官方规则是：请求 restricted 数据、并且**能通过第三方服务器访问这些数据**的应用，都必须做安全评估；评估每 12 个月至少重做一次 ([Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)，页面更新于 2026-08-19)。评估等级由 Google 指定，不能自选。小应用通常落在 Tier 2 / AL1，TAC Security 的报价约 **$540–1,800/年**，Tier 3 约 $4,500 ([DeepStrike](https://deepstrike.io/blog/google-casa-security-assessment-2025))；Google 本身不收费。常被引用的"$15,000–75,000"是 2019–2022 年渗透测试时代的旧数字，**已过时** ([GMass](https://www.gmass.co/blog/google-oauth-verification-security-assessment/))。时间上，restricted scope 审核约 6 周，CASA 测试 1–3 周，加上整改，**实际要预留约 2 个月** ([DeepStrike](https://deepstrike.io/blog/google-casa-security-assessment-2025))。有团队报告"一个周末通过 Tier 2" ([Orbis](https://meetorbis.com/blog/how-we-passed-google-casa-tier-2-with-claude))，属于个例。未验证的应用最多 100 个用户；Testing 模式下测试用户的授权 7 天过期 ([GMass](https://www.gmass.co/blog/google-oauth-verification-security-assessment/))。据二手来源，2025–2026 年又新增了两项政策义务：防 prompt 注入，以及禁止用用户数据训练通用模型 ([Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa))，**未与 Google 一手页面核对**。

规避方式有五种，各有代价。**其一，官方豁免**：个人使用、Testing 状态（最多 100 个测试用户）、单一 Workspace 组织内部使用都不需要验证 ([Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification))，创始人自用完全合规。**其二，BYO OAuth client**：每个用户注册自己的 OAuth 客户端，验证负担转给用户自己 ([Agentic Fabriq](https://www.agenticfabriq.com/blog/google-oauth-verification-casa))，适合早期技术用户。**其三，纯本地客户端**：数据只留在用户设备上时，"有理由"主张不需要 CASA，因为规则针对的是"第三方服务器"。但原生 Gmail 客户端 Mimestream 仍然做了 restricted 验证和 CASA Tier 2 ([Mimestream](https://mimestream.com/blog/casa-verified))，**本地不等于一定豁免**。**其四，IMAP 加应用专用密码**：完全绕开 OAuth 和 CASA，前提是用户开启两步验证 ([devanswers](https://devanswers.net/allow-less-secure-apps-access-gmail-account/))；代价是体验差、用户不放心，而且把密码存在服务器上本身就是安全负债。标题暗示 Google 将淘汰应用专用密码 ([Mailbird](https://www.getmailbird.com/gmail-oauth-changes-app-password-phase-out/))，**未核实**。**其五，邮件转发**：让用户用过滤器把求职相关邮件转发到应用自有的邮箱，根本不读用户的邮箱。另外，改用 `gmail.modify` 可以避开最宽的 scope，但它仍是 restricted，免不了 CASA。Outlook 方面，工作租户里读邮箱需要管理员同意，发布者验证可以去掉"未验证"标签 ([Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies))；没有找到 Microsoft 版的 CASA。

## 给本地优先独立创业者的定位建议

以下建议是基于上述证据的推断，不是调研直接给出的结论。

**不要把"AI 生成 dashboard"或"每日邮件简报"当卖点**，这两样已经分别被 Sites、artifacts、GenTabs 和免费的 Daily Brief 覆盖。建议的定位是**"你拥有的、agent 维护的个人工作台"**：本地运行，数据是用户硬盘上的文件；每个 tab 由用户用一句话定义，由定时任务负责刷新；结果同时推到 Telegram。这个定位同时击中巨头的四个弱点：云端、付费门槛、形态不稳定、偏向自家数据源。它也吸收了 Pulse 的教训：任务由用户显式定义，推送要带可执行的动作。

**用求职 tab 做切入点，并直接对标 career-ops 的用户群。** career-ops 的走红证明技术用户需要"可解释的自定义 rubric + 直连 career page 和 ATS"，而现有的 CV/rubric 打分、ATS 发现和每日 Telegram 推送，恰好补上了 career-ops 缺少的东西：不用终端、有常驻调度、有推送、有可视界面。可以考虑兼容或导入 career-ops 的配置，而不是和它正面竞争。求职成功就会流失，这是这个品类的结构问题。解法有两种：一是按求职周期卖短期通行证（参考 Teal），二是让用户找到工作后留在工作台的其他 tab 上，比如邮件、活动、研究、常去网站。后者正是单一用途求职工具做不到的，**但目前没有数据验证**。

**商业结构建议"开源核心 + 免费签名桌面 app + 付费云端 runner"。** 云端 runner 解决电脑休眠时任务停跑的问题，按额度计价，从第一天起支持 BYOK。价格可以参考 Obsidian Sync 和 Raycast 的 $10–20 入门档。这样既不重蹈 OpenClaw 把托管收入让给第三方的覆辙，也避开了 24/7 自动化用户击穿固定价订阅的毛利陷阱。开源许可可以参考 n8n 的 fair-code 思路，防止别人直接转售托管版；这一点需要单独评估。

**把安全当作卖点，而不是事后补丁。** OpenClaw 技能市场约 12% 恶意、3 万多个实例暴露在公网，说明面向非专家的本地 agent 最大的风险是供应链和默认配置。求职 tab 每天要读雇主写的职位描述，这正是 prompt 注入的入口；把打分环节的工具权限收到最窄，是可以对外讲的差异点。技能或插件应该经过审核，不要做开放市场。

**Gmail 分阶段处理。** 桌面阶段用 BYO OAuth client、Testing 模式、IMAP 应用专用密码或邮件转发，都不触发 CASA。只有当云端 runner 要在服务器上读用户邮件时，才启动 CASA Tier 2，预算约 2 个月和每年 $0.5–2k，并提前准备防 prompt 注入的说明。**最需要警惕的风险**有三个：OpenAI 传闻中的 always-on 助手，Google 把 Spark、GenTabs、Notebook 合并的可能，以及 Hermes 一类开源项目把 Live Dashboard 做成熟。这三者都可能在 6–12 个月内收窄空档。

## 可信度较低或可能过时的说法汇总

| 说法 | 来源 | 问题 |
|---|---|---|
| OpenClaw 3.2M MAU、50 万实例、生态月收入 $320K+ | openclawvps.io | 托管商自报，未经核实 |
| OpenClaw 2.0 与"shared cloud sessions"（2026-08-30） | mean.ceo | 低质量博客，未见一手来源 |
| OpenAI "o" always-on 助手 | progressiverobot（泄露截图） | 未证实 |
| Pulse 下线原因、定时任务上限 10 个 | prowlo | 聚合站；官方页面对抓取返回 403 |
| ChatGPT agent 8 月无预告移除；Sites 的 D1 数据库细节 | usecarly；GenAI Unplugged | 二手来源，官方帮助页 403 |
| ChatGPT 定时任务 Free 档是否可用 | usecarly | 同一来源内部矛盾 |
| Spark 已纳入 Pro、$19.99 | DataCamp、The Rundown | 第三方来源；官方页写明对 Pro 开放 |
| Disco 2026 年的状态、Windows 版计划 | The Rundown、DigitalApplied | 没有 2026 年一手来源 |
| Opera Neon 8 月改为免费 | ToolChase | 未经 Opera 确认 |
| career-ops 约 69.7k stars | SkillsLLM | 聚合站，未在 GitHub 核实 |
| Jobright 约 $1M ARR | GetLatka | 与"bootstrapped"标签自相矛盾 |
| LinkedIn Premium Apply Assistant | Jobsistant | 只有二手来源 |
| Lindy 定价 | getmacha | 与搜索标题中的价格区间矛盾 |
| CASA 新增防 prompt 注入和禁训练要求 | Agentic Fabriq | 未与 Google 一手页面核对 |
| CASA 费用 $15k–75k | GMass | 2019–2022 年旧数据，已过时 |
| Notion 额度 $10/1,000 | Matthias Frank、DEV | 二手来源；官方页未给单价 |
| Hermes Agent 的规模和成熟度 | — | 本次调研未覆盖，是主要缺口 |

## Conclusion

这次调研改变的核心判断是：竞争点已经不在"agent 能不能生成并刷新一个 dashboard"。OpenAI、Anthropic 和开源的 Hermes 都已经能做到，差别只在包装。真正的竞争点在**谁拥有这个工作台**。巨头的答案都是"放在我们的云里、付费才有后台、形态随时可能被推翻"。这让"本地、用户所有、形态稳定"从一个技术偏好变成了产品承诺，而 Pulse、Atlas、ChatGPT agent 一年内相继下线，正好给这个承诺提供了营销素材。

第二个启示是，这位创业者最有价值的资产，可能是求职 tab 里积累的领域深度（ATS 覆盖、rubric、推送节奏），而不是通用 dashboard 框架。通用框架正在被快速商品化，深度垂直的 tab 却很难被巨头的通用 agent 复制。合理的路线是：先把一个 tab 做到比 career-ops 更好用、比 Jobright 更透明，再用"找到工作后留下来的其他 tab"去验证工作台这个更大的命题。这个命题在今天还完全没有被数据证明。
