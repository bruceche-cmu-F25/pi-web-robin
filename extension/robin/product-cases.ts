/** Editorial research, not a live revenue feed. Read against the public video transcripts. */
export type ProductText = { zh: string; en: string };
export type CaseAngle = "improve" | "transfer";
export interface ProductCase {
  id: string;
  name: string;
  category: ProductText;
  job: ProductText;
  buyer: ProductText;
  model: ProductText;
  /** Editorial workflow illustration, not a screenshot or a complete product specification. */
  flow: [ProductText, ProductText, ProductText];
  source: string;
  checkedOn: string;
  signal: string;
  evidence: ProductText;
  sections: Array<{ label: ProductText; time: string; text: ProductText }>;
  caveat: ProductText;
  angles: Record<CaseAngle, { title: ProductText; proposal: ProductText; test: ProductText }>;
}

export const PRODUCT_CASES: ProductCase[] = [
  {
    id: "papermark", name: "Papermark", category: { zh: "B2B · 文档分享", en: "B2B · Document sharing" },
    job: { zh: "把文件变成可控的分享链接，让销售或融资团队知道对方看了什么。", en: "Turn documents into controlled sharing links and show sales or fundraising teams what readers viewed." },
    buyer: { zh: "销售与融资团队", en: "Sales & fundraising teams" },
    model: { zh: "托管订阅 + 企业许可", en: "Paid hosting + enterprise licenses" },
    flow: [{ zh: "上传文档", en: "Upload a document" }, { zh: "分享可控链接", en: "Share a controlled link" }, { zh: "了解阅读情况", en: "Understand reader activity" }],
    source: "https://www.starterstory.com/stories/how-we-built-it-900k-open-source-saas",
    checkedOn: "2026-10-13", signal: "$75K MRR",
    evidence: { zh: "10:06–10:35：创始人自述月经常性收入从第一年的 $20K 增至第二年中期的 $75K，约 1,000 个客户。是访谈时的自报，不是今天的审计数字。", en: "10:06–10:35: founders report growing from $20K MRR in year one to $75K mid-year two, with about 1,000 customers. Interview-time claims, not audited or current figures." },
    sections: [
      { label: { zh: "技术栈", en: "Tech stack" }, time: "11:02–11:41", text: { zh: "Next.js + TypeScript；GitHub、Vercel、PlanetScale Postgres、Trigger 后台任务、Resend 邮件；开发用 Cursor。营销站和应用是两个项目。", en: "Next.js + TypeScript, GitHub, Vercel, PlanetScale Postgres, Trigger background jobs and Resend email; Cursor for development. Separate marketing and app projects." } },
      { label: { zh: "获客", en: "Distribution" }, time: "01:24–01:59 · 09:20–10:01", text: { zh: "先公开提出 DocSend 开源替代品，周末做 MVP；持续在 X / LinkedIn 展示进展，参与 Hacktoberfest。传播与社区是渠道，不是开源就会自然有客户。", en: "Announced an open-source DocSend alternative, built a weekend MVP, shared progress on X / LinkedIn and joined Hacktoberfest. Community and public work are channels, not automatic demand." } },
      { label: { zh: "如何收费", en: "Monetization" }, time: "04:27–04:59", text: { zh: "免费自托管核心产品；不想自己管服务器的客户买托管服务；高级功能另售企业许可证。访谈没有列出具体套餐价。", en: "Free self-hosted core, paid hosting for customers who do not want to operate it, and enterprise licenses for advanced features. Plan prices are not given." } },
      { label: { zh: "维护与成本", en: "Operations & costs" }, time: "04:32–04:40 · 11:54–12:08", text: { zh: "替客户承担托管和维护，本身就是付费价值。团队自报支出大头是人员，其次营销和工具；没有披露绝对月成本、值班时间或备份流程。", en: "Taking hosting and maintenance off the customer's hands is paid value. The founders describe personnel as the largest expense, followed by marketing and tools; absolute monthly costs, on-call hours and backup procedures are not disclosed." } },
    ],
    caveat: { zh: "不是适合一个人照搬的全功能 data room：权限、敏感文档和企业安全承诺很重。开源许可证也不等于随意复制商标或资产。", en: "Do not clone an entire data room solo: permissions, sensitive documents and enterprise security promises carry substantial obligations. Open source does not license copying brands or assets." },
    angles: {
      improve: {
        title: { zh: "少一步，而不是多十个功能", en: "One less step, not ten more features" },
        proposal: { zh: "只面向小型咨询公司：给已有提案 PDF 加一个可撤销、会到期的客户链接，减少每次发送前的权限配置。", en: "For small consultancies: add revocable, expiring client links to existing proposal PDFs with less permission setup." },
        test: { zh: "找 5 家咨询公司，用同一份提案对照现有工具与手工原型；记录发送耗时和权限错误，再问是否愿意付费试用。目标节省 ≥10%，但不牺牲安全。", en: "With five consultancies, compare their current tool with a manual prototype on the same proposal. Measure send time and permission errors, then ask for a paid pilot. Target ≥10% time saved without weaker security." },
      },
      transfer: {
        title: { zh: "把文档交付用到设计工作室", en: "Apply document delivery to design studios" },
        proposal: { zh: "从融资文件转到设计方案交付：一个客户入口看当前版本、留言和确认，不做完整项目管理。", en: "Move from fundraising documents to design deliverables: one client page for the latest version, comments and approval, not a full project manager." },
        test: { zh: "先为 3 个真实设计项目人工整理交付页；测量来回确认次数，拿到一次实际付费后再自动化。新场景尚未验证。", en: "Manually prepare delivery pages for three real design projects. Count approval back-and-forth and seek one actual payment before automating. This new setting is unvalidated." },
      },
    },
  },
  {
    id: "subscribr", name: "Subscribr", category: { zh: "垂直 AI · 创作者工具", en: "Vertical AI · Creator tools" },
    job: { zh: "不做通用聊天窗口，专门解决 YouTube 创作者写脚本的瓶颈。", en: "Solve the YouTube creator's scriptwriting bottleneck rather than offer a generic chat window." },
    buyer: { zh: "YouTube 创作者", en: "YouTube creators" },
    model: { zh: "脚本工具月订阅", en: "Monthly scriptwriting subscription" },
    flow: [{ zh: "提供选题资料", en: "Bring topic material" }, { zh: "辅助生成脚本", en: "Draft a script with AI" }, { zh: "创作者审核修改", en: "Creator reviews & edits" }],
    source: "https://www.starterstory.com/gil", checkedOn: "2026-10-13", signal: "~$30K / month",
    evidence: { zh: "01:20–01:42：创始人自报约 $30K/月订阅收入；05:05–05:57：开发前卖出 50 份终身许可、约 $20K，并承诺交付日期与退款。预售收入不是 MRR。", en: "01:20–01:42: founder reports about $30K/month in subscriptions. 05:05–05:57: 50 lifetime licenses brought in roughly $20K before development, with delivery and refund commitments. Presales are not MRR." },
    sections: [
      { label: { zh: "技术栈", en: "Tech stack" }, time: "13:16–13:39", text: { zh: "Laravel / PHP，部署在 DigitalOcean，外部依赖主要是 AI 模型供应商；用 Claude Code 辅助开发。无需为了创业换成热门技术栈。", en: "Laravel / PHP on DigitalOcean, primarily relying on AI providers externally, with Claude Code for development. A familiar stack can be enough." } },
      { label: { zh: "获客", en: "Distribution" }, time: "04:09–04:55 · 01:33–01:42", text: { zh: "从零粉丝 X 账号给 YouTube 圈提供有用内容，建立千人邮件名单、逐个交流；后续靠口碑、社媒和程序化 SEO。名单和关系先于软件。", en: "Useful content from a new X account built a 1,000-person email list and individual conversations. Later channels include word of mouth, social media and programmatic SEO. Relationships preceded software." } },
      { label: { zh: "如何收费", en: "Monetization" }, time: "01:09–01:15 · 05:05–05:57", text: { zh: "访谈时套餐 $49–$300/月；早期用限量终身许可预售验证。不要照搬无限终身 AI 用量：一次收款不等于未来推理免费。", en: "Interview-time plans were $49–$300/month; limited lifetime presales validated initial demand. Do not copy unlimited lifetime AI usage: one payment does not fund inference forever." } },
      { label: { zh: "维护与成本", en: "Operations & costs" }, time: "13:44–14:07", text: { zh: "自报约 $3,500/月 AI、$2,000 广告、$1,500 爬取/托管/邮件。不是启动预算，也不是完整利润表；未披露客服工时、备份和故障处理。", en: "Reports roughly $3,500/month AI, $2,000 ads and $1,500 scraping / hosting / email. These are operating-scale costs, not a launch budget or a complete profit statement; support time, backups and incidents are undisclosed." } },
    ],
    caveat: { zh: "创始人已有多次创业和开发经验；其预售速度不能直接当你的基准。内容质量、版权和 AI 单次成本都要自己验证。", en: "The founder had substantial startup and engineering experience; his presale speed is not your baseline. Validate output quality, content rights and per-job AI costs yourself." },
    angles: {
      improve: {
        title: { zh: "把「更好」变成少一次返工", en: "Define better as one less revision" },
        proposal: { zh: "只服务知识类频道，交付带可检查来源的脚本草稿；优化查证与改稿，而不是承诺播放量。", en: "Serve educational channels with source-checkable script drafts; improve fact-checking and editing rather than promise views." },
        test: { zh: "请 5 位创作者用同一主题对照现有写作流程与人工版；测到可发布稿的编辑时间能否降低 ≥10%，同时记录事实错误。", en: "Ask five creators to compare their current workflow with a manual service for the same topic. Measure whether editing time to a publishable draft falls ≥10%, while tracking factual errors." },
      },
      transfer: {
        title: { zh: "把脚本工作流用到课程制作", en: "Apply the scripting workflow to courses" },
        proposal: { zh: "把资料→大纲→脚本的流程迁移到小型培训机构：从讲师已有材料生成短课脚本和练习题，由讲师审核。", en: "Transfer research → outline → script to small training businesses: turn instructors' existing materials into short lesson scripts and exercises for their review." },
        test: { zh: "先给 3 位讲师各做一节课的人工交付，问是否付费购买下一节；不把 YouTube 市场收入当课程市场的证据。", en: "Manually deliver one lesson to each of three instructors and ask them to buy the next. YouTube-market revenue does not validate the course market." },
      },
    },
  },
];

export function caseIdeaDraft(item: ProductCase, angle: CaseAngle, lang: "zh" | "en") {
  const chosen = item.angles[angle];
  return {
    name: `${item.name} · ${chosen.title[lang]}`,
    note: [
      `${lang === "zh" ? "参考案例（创始人自报，未独立核实）" : "Reference (founder-reported, not independently verified)"}: ${item.source}`,
      item.evidence[lang],
      `${lang === "zh" ? "我的切入假设（未验证）" : "My entry hypothesis (unvalidated)"}: ${chosen.proposal[lang]}`,
      `${lang === "zh" ? "最便宜的下一次测试" : "Cheapest next test"}: ${chosen.test[lang]}`,
      `${lang === "zh" ? "不能照搬的部分" : "What not to copy"}: ${item.caveat[lang]}`,
    ].join("\n\n"),
  };
}
