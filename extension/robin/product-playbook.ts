import type { LibraryCategory } from "./product-shape.ts";

/**
 * How a product actually gets landed, written down once.
 *
 * The section used to run a six-column board — inbox, research, testing,
 * building, live, paused — and it was dead on arrival: a column is a bucket
 * you sort yourself into, so it assumes you already know the process and only
 * need somewhere to record your position in it. What was actually wanted is
 * the opposite. Tell me what the steps are. Tell me what this one means, what
 * to do in it, which tools, and when I am allowed to move on.
 *
 * So each step carries four things a bucket cannot:
 *
 * - **the question it exists to answer**, because a step you cannot state the
 *   purpose of is a step you will skip;
 * - **what to actually do**, in the imperative, few enough to finish;
 * - **what counts as done**, which is the only honest gate — everything here
 *   is advice except this, and even this does not lock the next step;
 * - **which library categories are its tools**, so the thirty-four links stop
 *   being a directory you have to visit and start being the shelf beside the
 *   bench you are standing at.
 *
 * The content is opinionated on purpose, and opinionated *for one person*: a
 * solo builder who can ship, has no ad budget, and whose failure mode is
 * starting rather than finishing. Generic advice ("validate your idea") is
 * what you get from a blog post; it is worth nothing at the moment you are
 * staring at the screen deciding what to do next.
 */

export const PLAYBOOK_STEPS = ["spot", "research", "validate", "build", "improve", "launch"] as const;
export type StepId = (typeof PLAYBOOK_STEPS)[number];

interface Bilingual {
  en: string;
  zh: string;
}

export interface PlaybookStep {
  id: StepId;
  name: Bilingual;
  /** The one question this step exists to answer. */
  question: Bilingual;
  /** What to do, in the imperative. Few enough to finish. */
  does: Bilingual[];
  /** What counts as finished. The only gate, and it is not enforced. */
  done: Bilingual;
  /** Concrete artifact to leave behind, rather than a vague stage label. */
  output: Bilingual;
  /** A more detailed execution checklist for the always-visible roadmap. */
  roadmap: Bilingual[];
  /** Short labels for the input → work → proof diagram, not a progress score. */
  visual: [Bilingual, Bilingual, Bilingual];
  /** Conditional distribution advice, not a universal ads recipe. */
  branch?: { web: Bilingual; mobile: Bilingual };
  /** First-hand examples supporting the advice; anecdotes, not universal rules. */
  sources: Array<{ title: string; url: string; takeaway: Bilingual }>;
  /** Which library shelves belong at this bench. */
  categories: LibraryCategory[];
  /** An action the page can run for you here, if there is one. */
  action?: "research";
}

export const PLAYBOOK: PlaybookStep[] = [
  {
    id: "spot",
    name: { en: "Spot", zh: "发现" },
    question: {
      en: "Why this, and why you?",
      zh: "为什么是这个,以及为什么是你?",
    },
    does: [
      {
        en: "Write what you actually saw — your own recurring annoyance, or someone else's project that works.",
        zh: "写下你到底看到了什么——是你自己反复遇到的麻烦,还是别人做得很好的一个项目。",
      },
      {
        en: "If it is someone else's, name the 10% you would add. \"Same but better\" is not a 10%; \"same, for people who already use X\" is.",
        zh: "如果是别人的,写下你要多做的那 10% 是什么。「一样但更好」不算;「一样,但专给已经在用 X 的人」算。",
      },
      {
        en: "Name your unfair advantage: a channel you already have, a skill, or a group you belong to. If there is none, say so — it is not fatal, but it is the thing that will hurt later.",
        zh: "写下你的不公平优势:你已经有的渠道、技能,或者你本来就属于的圈子。如果没有,就写没有——不致命,但后面吃亏的就是这里。",
      },
    ],
    done: {
      en: "You can say in one sentence: who it is for, what it fixes, and why you are the one to do it.",
      zh: "你能用一句话说清:给谁、解决什么、凭什么是你。",
    },
    output: { en: "One sentence: audience + painful job + a narrow 10% wedge.", zh: "一页问题定义：用户是谁、痛点是什么、你的 10% 切口是什么。" },
    visual: [{ en: "An existing product", zh: "现有产品" }, { en: "One user pain", zh: "一个具体痛点" }, { en: "Your narrow wedge", zh: "你的 10% 切口" }],
    roadmap: [
      { en: "Write down one repeated task a specific group actually pays for or spends time on.", zh: "记录一类具体人反复做、愿意花钱或时间解决的任务。" },
      { en: "Record the original product link, its claimed revenue and whether that number is estimated, self-reported or verified.", zh: "保存原产品链接、收入数字及其口径：估算、自报还是已核实。" },
      { en: "Write a testable difference: a narrower user, faster workflow, or a missing integration — not just 'better'.", zh: "写下可检验的差异：更窄的人群、更快的流程或缺失的集成，别只写「做得更好」。" },
    ],
    sources: [
      { title: "Starter Story · The $1M Mobile App Playbook", url: "https://www.starterstory.com/stories/the-1m-mobile-app-playbook", takeaway: { en: "A founder starts with a lived problem and searches niche content for demand; this is an example, not proof of your market.", zh: "创始人从亲身问题出发，用细分内容观察需求；这只是案例，不是你市场的证明。" } },
    ],
    categories: ["source"],
  },
  {
    id: "research",
    name: { en: "Research", zh: "调研" },
    question: {
      en: "Is this market empty, crowded, or crowded and bad?",
      zh: "这个市场是空的、拥挤的,还是拥挤但做得都很烂?",
    },
    does: [
      {
        en: "Send the agent to look first — it will name the closest competitors, their prices, where the users gather, and what they complain about, and save every source.",
        zh: "先让 Agent 去看一遍——它会找出最接近的竞品、价格、用户聚在哪、他们在抱怨什么,并把每个来源都存下来。",
      },
      {
        en: "Then open the closest three yourself. The agent finds the sources; only you can tell whether the gap is one you would enjoy filling.",
        zh: "然后自己打开最接近的三个。Agent 找得到来源,但只有你能判断这个缺口是不是你愿意去填的。",
      },
      {
        en: "Find the price ceiling. If the category is free, the product has to be something else — a service, a tool for businesses, or not this.",
        zh: "找到价格天花板。如果这个品类是免费的,那产品就得是别的东西——服务、面向企业的工具,或者干脆不是这个。",
      },
    ],
    done: {
      en: "You know the closest three and what they charge, and whether there is still room for you.",
      zh: "你知道最接近的三个竞品和他们的定价,以及自己还有没有位置。",
    },
    output: { en: "Three competitors with links, prices, audience, complaints, and a reachable channel.", zh: "带链接的 3 个竞品对照：定价、目标用户、差评和可触达渠道。" },
    visual: [{ en: "3 competitors", zh: "3 个竞品" }, { en: "Prices + complaints", zh: "价格与差评" }, { en: "A reachable niche", zh: "可触达的人群" }],
    roadmap: [
      { en: "Open three competitors yourself. Record their onboarding, price, and one broken workflow per product.", zh: "亲自打开三个竞品，记录入门流程、价格和各自最碍事的一步。" },
      { en: "Read user reviews and communities; save the exact wording of repeated complaints, not AI summaries alone.", zh: "读评论与社区，保存重复抱怨的原话，不只看 AI 总结。" },
      { en: "Find where potential customers already look for this fix; for visual consumer apps, study niche video hooks too.", zh: "找潜在用户本来在哪里找解法；若是视觉化消费者 App，再研究同类短视频的开头。" },
    ],
    sources: [
      { title: "Starter Story · The $1M Mobile App Playbook", url: "https://www.starterstory.com/stories/the-1m-mobile-app-playbook", takeaway: { en: "Example: log a niche video's link, hook, story and call-to-action in a spreadsheet before making your own content.", zh: "案例方法：先把细分视频的链接、开头、叙事和行动引导记到表格里，再做自己的内容。" } },
    ],
    categories: ["source"],
    action: "research",
  },
  {
    id: "validate",
    name: { en: "Validate", zh: "验证" },
    question: {
      en: "Before writing code — what evidence would convince you someone wants this?",
      zh: "在写第一行代码之前——什么证据能让你相信真的有人要?",
    },
    does: [
      {
        en: "Write one claim that could turn out false, and a date to check it by. \"People would like this\" cannot be false; \"five of ten builders will pay $10/mo\" can.",
        zh: "写下一条**可能被证伪**的判断,和一个验证日期。「大家会喜欢」无法被证伪;「十个独立开发者里有五个愿意付 $10/月」可以。",
      },
      {
        en: "Pick the cheapest test below that could break it. Interviews cost days, a landing page costs an afternoon, a fake door costs an hour.",
        zh: "从下面挑一个**最便宜**、又真能推翻它的验证方法。用户访谈要几天,落地页要一下午,Fake door 要一小时。",
      },
      {
        en: "Run it, then come back and mark the claim held or broken. Marking it broken parks the idea — that is the point, not a punishment.",
        zh: "去做,然后回来标记成立或不成立。标记「不成立」会把这条想法搁置——这是它的用途,不是惩罚。",
      },
    ],
    done: {
      en: "The claim is marked held or broken. An unmarked claim means the step did not happen.",
      zh: "那条判断被标记成成立或不成立。没标记就等于这一步没做。",
    },
    output: { en: "A dated falsifiable claim and evidence from real users or an intent test.", zh: "一条有截止日期、可被证伪的判断，加上真实用户或意向测试的证据。" },
    visual: [{ en: "A claim", zh: "可证伪的假设" }, { en: "Interview / demo", zh: "访谈或演示" }, { en: "Real intent", zh: "实际行动证据" }],
    roadmap: [
      { en: "Pick one outcome and a buyer: '3 of 10 target users will pay for X' is testable.", zh: "明确买家和结果；「10 位目标用户中 3 位愿意为 X 付费」才可检验。" },
      { en: "Before building, try interviews, a manual service, a landing page or a demo video; track intent rather than likes.", zh: "开发前用访谈、人工服务、落地页或演示视频探路；记录意向，不只数点赞。" },
      { en: "Set a decision date. Record what failed as carefully as what held; do not quietly move the goalposts.", zh: "设定决策日；不成立和成立都要记录，别悄悄改成功标准。" },
    ],
    sources: [
      { title: "Starter Story · Fastlane launch case", url: "https://www.starterstory.com/stories/fastlane-create-winning-short-form-content-in-seconds", takeaway: { en: "Fastlane reports validating with a waitlist and two betas; its first sale came from a beta user.", zh: "Fastlane 自述通过候补名单和两轮内测验证；首笔收入来自内测用户。" } },
      { title: "Starter Story · Content-first validation", url: "https://www.starterstory.com/Mario", takeaway: { en: "A consumer-app example tested the content concept before building the product; views alone are not paid demand.", zh: "一个消费者 App 案例先用内容测试概念再开发；播放量不等于付费需求。" } },
    ],
    categories: ["test"],
  },
  {
    id: "build",
    name: { en: "Build", zh: "做" },
    question: {
      en: "What is the smallest thing a stranger could actually use?",
      zh: "能让一个陌生人真正用起来的、最小的东西是什么?",
    },
    does: [
      {
        en: "Pick the stack from the recipes below rather than assembling one. The choice is not where the product is won, and it is where weeks go.",
        zh: "从下面的配方里选技术栈,不要自己攒。选型不是产品的胜负手,却是最容易吃掉几周的地方。",
      },
      {
        en: "List what has to exist before a stranger can use it, then cut everything else. Everything you cut is still there tomorrow.",
        zh: "列出「陌生人能用起来」之前必须存在的东西,其余全部砍掉。砍掉的明天还在。",
      },
      {
        en: "Write down what it costs per month before you sign up for anything — the prices below are checked when you check them, not before.",
        zh: "在注册任何服务之前先写下每月要花多少钱——下面的价格是你核验过才作数,没核验过的写着未核验。",
      },
    ],
    done: {
      en: "Someone who has never met you can use it without you in the room.",
      zh: "一个没见过你的人,在你不在场的情况下能用起来。",
    },
    output: { en: "One usable path from signup to value, with price and event tracking working.", zh: "从注册到得到价值的一条可走通的路径，价格与关键事件可测。" },
    visual: [{ en: "Sign up", zh: "注册" }, { en: "Core action", zh: "核心动作" }, { en: "Result + price", zh: "结果与价格" }],
    roadmap: [
      { en: "Sketch one complete path: arrive → sign up → do the job → see the result. Cut anything outside it.", zh: "画一条完整路径：到达→注册→完成任务→看到结果；其余先砍掉。" },
      { en: "Ship basic billing or a manual payment path and a clear privacy/contact page; test the flow with a fresh account.", zh: "准备基本收费或人工收款，以及隐私/联系页；用全新账号自己走一遍。" },
      { en: "Track activation, repeat use and payment events before buying traffic; keep third-party spend visible.", zh: "投流前先能看到激活、复用和付款事件，并记清每月外部服务成本。" },
    ],
    sources: [
      { title: "Starter Story · Fastlane launch case", url: "https://www.starterstory.com/stories/fastlane-create-winning-short-form-content-in-seconds", takeaway: { en: "The team built for one content-production problem and iterated in beta instead of shipping every possible feature.", zh: "团队聚焦一个内容生产问题，在内测中迭代，而不是一次做全功能。" } },
    ],
    categories: ["stack", "tool"],
  },
  {
    id: "improve",
    name: { en: "Beta & iterate", zh: "内测与打磨" },
    question: {
      en: "Does anybody come back a second time?",
      zh: "有人会第二次回来用吗?",
    },
    does: [
      {
        en: "Get it in front of ten real users. Friends do not count — they are being kind, and kindness is not data.",
        zh: "找十个真实用户用一遍。朋友不算——他们是在照顾你,而照顾不是数据。",
      },
      {
        en: "Watch where they get stuck and say nothing. The urge to explain is the bug report.",
        zh: "看他们卡在哪,不要解释。你忍不住想解释的地方,就是 bug 报告本身。",
      },
      {
        en: "Fix the three that stopped people finishing. Ignore everything else, including the good suggestions.",
        zh: "只修让人没能走完流程的那三个。其余全部忽略,包括那些听起来很好的建议。",
      },
    ],
    done: {
      en: "A few people came back without being asked.",
      zh: "有几个人在你没催的情况下自己回来了。",
    },
    output: { en: "A beta log: who completed the core task, who returned or paid, and what blocked them.", zh: "内测记录：谁完成核心任务、谁回来或付费、谁卡在何处。" },
    visual: [{ en: "Real user", zh: "真实用户" }, { en: "Watch friction", zh: "观察卡点" }, { en: "Returns / pays", zh: "复用或付费" }],
    roadmap: [
      { en: "Invite a small group of target users to finish the core task without coaching; note drop-offs.", zh: "请一小组目标用户独立完成核心任务，记录卡住和放弃的位置。" },
      { en: "Fix blockers first. Ask at least one person to pay or explicitly refuse the price.", zh: "先修会阻断任务的问题；让至少一人实际付款，或明确拒绝你的价格。" },
      { en: "Check that a few users return without a reminder; if not, fix value or audience before scaling.", zh: "看有没有人无需提醒主动回来；如果没有，先改价值或人群，别急着放大。" },
    ],
    sources: [
      { title: "Starter Story · Fastlane launch case", url: "https://www.starterstory.com/stories/fastlane-create-winning-short-form-content-in-seconds", takeaway: { en: "Two betas and a beta customer's first payment gave a stronger signal than launch-day attention.", zh: "两轮内测和内测用户的首笔付款，比发布当天的热闹更有说服力。" } },
    ],
    categories: ["test", "tool"],
  },
  {
    id: "launch",
    name: { en: "Launch & grow", zh: "上线与增长" },
    question: {
      en: "Where do the next hundred come from, and can you get them without paying?",
      zh: "下一个 100 个用户从哪来,不花钱能不能拿到?",
    },
    does: [
      {
        en: "Pick one channel and go deep. Five channels at once is how a solo builder gets five sets of results too small to read.",
        zh: "选一条渠道打透。同时开五条,结果就是五组小到读不出信号的数据。",
      },
      {
        en: "Free channels first — the community these users already sit in, your own posts, a creator who serves them. Only spend once one of those converts.",
        zh: "先走免费渠道——这些用户本来就待着的社区、你自己发的内容、服务他们的创作者。等其中一条真的转化了再花钱。",
      },
      {
        en: "When you do pay, buy more of what already worked and watch for fatigue. New creative beats a bigger budget on the same creative.",
        zh: "真要投钱时,给已经有效的素材加码,并盯着素材疲劳。换新素材永远比给旧素材加预算有用。",
      },
    ],
    done: {
      en: "The product is public; one channel brings measurable active or paying users. Ads stay off unless their economics make sense.",
      zh: "产品公开可用；一条渠道带来可衡量的活跃或付费用户。投放不划算就暂停。",
    },
    output: { en: "A live link, first users, one measurable channel, and a keep/stop decision on paid spend.", zh: "可访问的产品、第一批用户、一条可衡量的渠道，以及是否投放的决策。" },
    visual: [{ en: "Public launch", zh: "公开上线" }, { en: "One channel", zh: "一条渠道" }, { en: "CAC vs value", zh: "获客成本与价值" }],
    roadmap: [
      { en: "Launch: test the public link, onboarding, pricing/checkout, analytics, support contact and rollback on a fresh device.", zh: "上线检查：用新设备验证公开链接、注册、定价/付款、统计、客服入口和回滚方案。" },
      { en: "Distribution: pick one channel where this buyer already is. Post a demo or case with a clear call-to-action; record visits → signups → active users → paid users.", zh: "分发：只选目标用户本来就在的一条渠道，发演示或案例并放清晰入口；记浏览→注册→激活→付费。" },
      { en: "Ads (optional): test a small capped budget only after one message converts and event tracking works. Compare acquisition cost to gross-margin-adjusted customer value; stop losers.", zh: "投放（可选）：素材已有转化且事件可追踪后，再用封顶小预算测试。用获客成本对比扣除成本后的客户价值；亏损就停。" },
      { en: "Iterate weekly: compare cohorts and retention, ask churned users why they left, then change one bottleneck before increasing traffic.", zh: "每周迭代：看分批留存、问流失原因，每次只改一个瓶颈；别靠加流量掩盖低留存。" },
    ],
    branch: {
      web: { en: "B2B/web SaaS: start with direct demos, communities or useful founder content; high-intent conversations matter more than video views.", zh: "B2B / Web SaaS：先做定向演示、社区交流或创始人内容；有效对话比播放量重要。" },
      mobile: { en: "Consumer/mobile: test repeatable short-video hooks organically; only turn winning creatives into ads after tracking installs, trials and purchases.", zh: "消费者 / 移动 App：先用自然流量测试可重复的短视频开头；能追踪安装、试用与付费后，再把有效素材用于广告。" },
    },
    sources: [
      { title: "Starter Story · The $1M Mobile App Playbook", url: "https://www.starterstory.com/stories/the-1m-mobile-app-playbook", takeaway: { en: "This mobile-app case researches hooks, tests organic content, then buys traffic from proven creatives while measuring funnel events and CAC vs LTV.", zh: "这个移动 App 案例先研究内容钩子、跑自然内容，再用有效素材投放，并跟踪漏斗事件及 CAC 与 LTV。" } },
      { title: "Starter Story · Fastlane launch case", url: "https://www.starterstory.com/stories/fastlane-create-winning-short-form-content-in-seconds", takeaway: { en: "Fastlane launched via an existing X audience, LinkedIn and Product Hunt; that route is not automatically suitable for every product.", zh: "Fastlane 借助已有 X 受众、LinkedIn 和 Product Hunt 上线；这些渠道并非适用于每个产品。" } },
    ],
    categories: ["distribution"],
  },
];

export function playbookStep(id: StepId): PlaybookStep {
  return PLAYBOOK.find((step) => step.id === id) ?? PLAYBOOK[0]!;
}

export function nextStep(id: StepId): StepId | null {
  const index = PLAYBOOK_STEPS.indexOf(id);
  return index >= 0 && index < PLAYBOOK_STEPS.length - 1 ? PLAYBOOK_STEPS[index + 1]! : null;
}
