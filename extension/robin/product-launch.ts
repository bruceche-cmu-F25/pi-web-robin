import type { ProductText } from "./product-cases.ts";

export const LAUNCH_NODE_IDS = ["market", "validation", "build", "billing", "distribution", "release", "operations", "economics"] as const;
export type LaunchNodeId = typeof LAUNCH_NODE_IDS[number];
export const LAUNCH_STATUSES = ["todo", "doing", "done", "skip"] as const;
export type LaunchStatus = typeof LAUNCH_STATUSES[number];
export interface LaunchDecision { status: LaunchStatus; note: string; updatedAt: string }
export type LaunchPlan = Partial<Record<LaunchNodeId, LaunchDecision>>;
export interface LaunchNode {
  id: LaunchNodeId;
  title: ProductText;
  question: ProductText;
  output: ProductText;
  tasks: ProductText[];
  lean: ProductText;
  risk: ProductText;
  caseId?: string;
}

/** A map of parallel responsibilities, not a second stage pipeline. Advice is editorial. */
export const LAUNCH_MAP: LaunchNode[] = [
  {
    id: "market", title: { zh: "需求与切入点", en: "Demand & positioning" },
    question: { zh: "谁已经付钱解决它，为什么还需要你？", en: "Who already pays to solve this, and why would they switch?" },
    output: { zh: "一句定位 + 3 个竞品 + 一个可测的差异。", en: "One positioning sentence, three competitors and one measurable difference." },
    tasks: [
      { zh: "选一个人群、一件反复发生的任务；记录他们现在用什么、花多少钱、哪里不满意。", en: "Pick one audience and recurring job; record their current solution, spend and dissatisfaction." },
      { zh: "保存 3 个竞品的价格、用户评论原话与日期。收入自报、估算、实际交易分开写；有竞品代表有供给，不自动代表你有客户。", en: "Save three competitors' prices, exact customer complaints and dates. Separate reported revenue, estimates and transactions; competition is not proof you have buyers." },
      { zh: "二选一：同一场景的一步快 10%，或把已验证工作流移到新场景。明确原来的基准、指标和你能触达的人。", en: "Choose: improve one measurable step in the same setting, or transfer a proven workflow to a new one. Name the baseline, metric and people you can reach." },
    ],
    lean: { zh: "先读差评、亲自试用和找人聊；不要先买市场数据库或注册一堆域名。", en: "Start with reviews, hands-on trials and conversations; skip paid market databases and domain collecting." },
    risk: { zh: "迁移场景后，付费人、采购流程、数据权限都可能变；原市场验证不能继承。", en: "A new context can change the buyer, procurement and data access. Validation does not transfer automatically." }, caseId: "papermark",
  },
  {
    id: "validation", title: { zh: "验证与 MVP 边界", en: "Validation & MVP scope" },
    question: { zh: "写代码前，最便宜的什么证据能让你继续或停下？", en: "What is the cheapest evidence that tells you to continue or stop?" },
    output: { zh: "目标用户 + 一次实验 + 成功/停止标准 + 决策日期。", en: "A target buyer, one experiment, pass/stop criteria and a decision date." },
    tasks: [
      { zh: "问过去的真实行为，而不是「你会不会用」。把访谈对象和后续跟进留在 CRM。", en: "Ask about past behavior, not hypothetical interest. Keep interview contacts and follow-ups in CRM." },
      { zh: "用演示或人工服务交付一个结果；记录使用、拒绝与实际付费，不拿点赞或候补名单冒充收入。", en: "Deliver one result via a demo or manual service. Record use, rejection and payment; likes and waitlists are not revenue." },
      { zh: "写明要做与不做的功能、实验预算、交付日期；预售必须明示未完成、退款规则，并留出履约资金。", en: "Define in/out scope, test budget and delivery date. Presales must disclose unfinished work, refund terms and leave funds for delivery." },
    ],
    lean: { zh: "先卖人工版，别用三个月开发代替一次令人不舒服的销售对话。", en: "Try selling a manual version before substituting months of coding for a difficult sales conversation." },
    risk: { zh: "人说愿意付费是弱信号；一笔预售也不是持续留存。不要验证不成就悄悄改指标。", en: "Stated willingness is a weak signal; one presale is not retention. Do not move the goalposts after a failed test." }, caseId: "subscribr",
  },
  {
    id: "build", title: { zh: "产品与技术栈", en: "Product & tech stack" },
    question: { zh: "陌生人怎样不用你指导，就拿到核心结果？", en: "How can a stranger get the core result without your help?" },
    output: { zh: "一条完整用户路径 + 技术选择及理由 + 明确不做清单。", en: "One complete user flow, justified stack choices and an explicit not-now list." },
    tasks: [
      { zh: "画到达→输入→处理→得到结果；考虑首次使用、空数据、失败重试和取消，不只画理想界面。", en: "Map arrival → input → processing → result, including first use, empty states, retry and cancellation." },
      { zh: "Web 先用熟悉的框架、一个数据库和一个部署平台；只在需要时加登录、对象存储、后台任务、事务邮件。App 再决定原生或跨平台，确认相机/离线/推送等必要能力。", en: "For web, start with a familiar framework, one database and one host; add auth, storage, jobs or email only when needed. For mobile, choose native or cross-platform based on camera, offline and push needs." },
      { zh: "测权限隔离、密钥保管、输入校验和限流；AI 功能保留质量样本、失败兜底和单次用量上限。让一个新用户独立走完核心路径。", en: "Test access isolation, secret handling, validation and rate limits. For AI, keep quality samples, fallback behavior and per-job limits. Have a new user finish the path unaided." },
    ],
    lean: { zh: "熟悉的单体应用优先；先不做微服务、团队权限系统或第二个平台，除非核心场景真的需要。", en: "Prefer a familiar monolith; defer microservices, elaborate team roles and a second platform unless the core job needs them." },
    risk: { zh: "免费额度不是生产 SLA。先查商用限制、休眠、配额和数据导出，避免上线后被套餐卡住。", en: "Free tiers are not production SLAs. Check commercial terms, sleep policies, quotas and export options." }, caseId: "subscribr",
  },
  {
    id: "billing", title: { zh: "收费与合规", en: "Billing & obligations" },
    question: { zh: "你卖的单位是什么，收了钱后承诺什么？", en: "What is the unit you sell, and what do you owe after payment?" },
    output: { zh: "价格与用量边界 + 收款/退款路径 + 必要的条款与隐私说明。", en: "Price and usage limits, payment/refund flows, necessary terms and privacy disclosures." },
    tasks: [
      { zh: "按次、按用量、订阅只先选一个；写清试用、额度、续费、取消与退款。收入确认、税和商户资格按所在地核查。", en: "Start with one of per-job, usage or subscription pricing. State trial limits, renewal, cancellation and refunds; check local tax and merchant eligibility." },
      { zh: "Web 确认支付服务或 Merchant of Record 是否支持你的地区与品类；App 核对当前商店内购与外链支付规则，不假设一套支付到处通用。", en: "For web, check payment provider or Merchant of Record coverage; for mobile, verify current store billing and external-link rules rather than assume one checkout works everywhere." },
      { zh: "测试成功、失败、重复 webhook、退款与取消后权限；准备隐私政策、条款、数据删除/导出和联系入口，列清第三方数据处理。", en: "Test success, failure, duplicate webhooks, refunds and entitlement after cancellation. Provide privacy/terms, deletion/export and contact paths, including third-party data processing." },
    ],
    lean: { zh: "合适且允许时，先用托管收银台或人工发票；不要自己保存卡号。按实际场景核查义务，不买一整套企业合规服务。", en: "Where suitable and permitted, use hosted checkout or manual invoicing; never store card numbers yourself. Check actual obligations before buying enterprise compliance tooling." },
    risk: { zh: "涉及健康、金融、儿童或博彩时，先评估法律与商店限制；这里是工作清单，不是法律意见。", en: "Health, finance, children or gambling require additional legal and store review. This is a work checklist, not legal advice." }, caseId: "papermark",
  },
  {
    id: "distribution", title: { zh: "获客与销售", en: "Distribution & sales" },
    question: { zh: "第一批客户具体在哪里，为什么会相信你？", en: "Where exactly are your first buyers, and why would they trust you?" },
    output: { zh: "一类买家 + 一条主渠道 + 一份可展示的结果 + 可追踪的转化。", en: "One buyer segment, one primary channel, a demonstrable result and measurable conversion." },
    tasks: [
      { zh: "B2B 先找能约到的目标客户做演示；消费者 App 先测与受众匹配的内容。不要默认 Product Hunt、SEO、短视频对所有产品都有用。", en: "For B2B, demo to reachable buyers; for consumer apps, test audience-fit content. Product Hunt, SEO and short video are not universal channels." },
      { zh: "用一句问题、一个前后对照和明确价格讲清价值；联系与回复进 CRM，先确认名单来源和联系许可，不自动群发。", en: "Explain value with a problem, before/after result and clear price. Track outreach and replies in CRM; check sourcing and consent rather than mass-send automatically." },
      { zh: "记录访问→激活→付费及获客来源；有转化再扩渠道或做封顶广告实验，把你的内容工时也算进去。", en: "Track visit → activation → payment by source. Expand or run capped ads only after conversion; include your own content-production time." },
    ],
    lean: { zh: "一个能触达买家的渠道，比同时维护五个平台更重要；人工找十个对的人比自动找一万个泛用户便宜。", en: "One reachable buyer channel beats maintaining five platforms; finding ten relevant people can be cheaper than automating a generic list of thousands." },
    risk: { zh: "播放量、下载量和关注数不能支付账单。先证明到达的是买家，别用流量掩盖产品没价值。", en: "Views, installs and followers do not pay bills. Check buyer intent instead of hiding low value behind traffic." }, caseId: "subscribr",
  },
  {
    id: "release", title: { zh: "上线与交付", en: "Release & delivery" },
    question: { zh: "今天有陌生人付款，你能安全地交付并处理失败吗？", en: "If a stranger pays today, can you deliver safely and handle failure?" },
    output: { zh: "可用的生产链接/商店版本 + 端到端验收 + 回滚与客服入口。", en: "A production URL / store release, end-to-end acceptance checks, rollback and support contact." },
    tasks: [
      { zh: "Web 配域名、DNS、HTTPS、生产环境变量、数据库迁移与邮件域名；用新设备检查注册、核心结果、支付、取消和找回账号。", en: "For web, configure DNS, HTTPS, production secrets, migrations and email domain; test signup, core result, payment, cancellation and recovery on a fresh device." },
      { zh: "App 准备开发者账号、签名、商店截图/说明、隐私标签、审核测试账号、TestFlight/内测和订阅恢复。按当前商店要求逐项核查。", en: "For apps, prepare developer accounts, signing, listings, privacy labels, reviewer access, beta testing and purchase restoration. Check current store requirements." },
      { zh: "先小范围发布；开错误告警、可联系的支持入口，做一次备份恢复和回滚演练。明确坏了时谁处理、如何通知用户。", en: "Release to a small group first. Enable error alerts and reachable support; rehearse restore and rollback. Decide who handles incidents and how users are told." },
    ],
    lean: { zh: "先把一个渠道的交付跑通，不同时上两个商店和 Web；发布会不是上线验收。", en: "Deliver through one platform before launching on web and two stores at once; a launch announcement is not an acceptance test." },
    risk: { zh: "支付成功却没有权限、演示环境混进生产、发不出的邮件，都是上线阻断项。", en: "Payment without entitlement, demo data in production and undeliverable email are release blockers." },
  },
  {
    id: "operations", title: { zh: "维护与留存", en: "Operations & retention" },
    question: { zh: "下个月还要有人用，你每周要做什么？", en: "What weekly work keeps people using it next month?" },
    output: { zh: "一页运行手册：告警、支持、备份、成本上限、留存复盘与停服预案。", en: "A runbook for alerts, support, backups, spending limits, retention review and shutdown." },
    tasks: [
      { zh: "设错误/可用性告警、失败任务重试和 API 额度告警；定期恢复备份，而不只是看到「备份成功」。", en: "Set error/uptime alerts, failed-job retries and API budget alerts; periodically restore a backup, not just check its success status." },
      { zh: "给客服留固定时间，分清阻断 bug 与新功能；安排依赖安全更新、密钥轮换、数据保留/删除。记录每周维护工时。", en: "Reserve support time, separate blocking bugs from requests, schedule security updates, secret rotation and retention/deletion, and track maintenance hours." },
      { zh: "按产品使用频率看分批用户复用、取消和退款；每周只改一个瓶颈。准备导出数据、通知客户、退款和关闭付费资源的停服方案。", en: "Review cohort repeat use, cancellation and refunds at the product's natural cadence. Improve one bottleneck weekly; plan export, notice, refunds and resource shutdown." },
    ],
    lean: { zh: "托管基础设施 + 简单告警 + 一份运行手册通常先够用；不要承诺一个人承担不了的 24/7 SLA。", en: "Managed infrastructure, simple alerts and one runbook are often enough initially; do not promise a 24/7 SLA you cannot staff." },
    risk: { zh: "Starter Story 很少完整披露维护工时；没有提到不代表没有成本。开源也不会自动替你负责生产事故。", en: "Founder interviews rarely disclose all maintenance hours; silence is not zero cost. Open source does not take responsibility for production incidents." }, caseId: "papermark",
  },
  {
    id: "economics", title: { zh: "成本与止损", en: "Costs & stop rules" },
    question: { zh: "赚到的是真利润，还是把你的时间和未来账单藏起来了？", en: "Is it profit, or are you hiding your time and future bills?" },
    output: { zh: "启动/月度预算、单用户贡献、时间上限和继续/暂停日期。", en: "Setup/monthly budgets, contribution per customer, a time limit and a continue/pause date." },
    tasks: [
      { zh: "分开一次性、固定月费、随用量变化的成本；记域名续费、商店账号、托管、数据库、AI、邮件、手续费、退款和获客。价格以官方当前条款为准。", en: "Separate setup, fixed monthly and usage costs: domain renewals, store accounts, hosting, database, AI, email, fees, refunds and acquisition. Verify current official pricing." },
      { zh: "按典型与重度用户分别算单次交付成本；免费层越界后会花多少？设置用量上限、预算告警与关闭开关。", en: "Model typical and heavy usage. What happens past free-tier limits? Set usage caps, spending alerts and a shutoff switch." },
      { zh: "写清最多投入的金额/每周小时/几周；到期用付费、留存和单位经济决定继续、换切口或暂停，不用已经投入的时间说服自己。", en: "Set maximum spend, hours/week and duration. At review time, decide from payment, retention and unit economics, not sunk time." },
    ],
    lean: { zh: "先不买年付、不叠 SaaS、不签长期创作者合同；能人工验证就先不自动化。低成本包括你的时间。", en: "Defer annual plans, SaaS stacking and long creator contracts. Test manually before automating. Low cost includes your time." },
    risk: { zh: "不要把 MRR 当利润，把历史收入当当前收入，或把某创始人的成熟运营账单当你的启动预算。", en: "Do not equate MRR with profit, historical with current revenue, or mature operating spend with your launch budget." }, caseId: "subscribr",
  },
];

export function breakEvenCustomers(fixed: number, price: number, variable: number): number | null {
  if (![fixed, price, variable].every((n) => Number.isFinite(n) && n >= 0) || price <= variable) return null;
  return Math.ceil(fixed / (price - variable));
}
