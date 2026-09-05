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
    categories: ["stack", "tool"],
  },
  {
    id: "improve",
    name: { en: "Improve", zh: "打磨" },
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
    categories: ["test", "tool"],
  },
  {
    id: "launch",
    name: { en: "Launch", zh: "分发" },
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
      en: "One repeatable way to get users that does not depend on you posting today.",
      zh: "有一条可重复的获客路径,而且不依赖你今天有没有发帖。",
    },
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
