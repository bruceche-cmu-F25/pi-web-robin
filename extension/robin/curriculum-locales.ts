import type { Locale } from "../../lib/i18n/types.ts";
import type { CurriculumModule, CurriculumModuleGuide } from "./curriculum.ts";
import { toTraditionalChinese } from "../../lib/i18n/zh-traditional.ts";

type GuideCopy = Omit<CurriculumModuleGuide, "minimumItemId">;

interface ModuleCopy {
  title: string;
  outcome: string;
  guide: GuideCopy;
}

/**
 * Curriculum prose is longer-lived than UI chrome, so it stays beside the
 * curriculum instead of being mixed into the app-wide message registry.
 * Resource titles remain in their official language; this translates the
 * explanation around them.
 */
const ZH_CN_ITEM_HINTS: Readonly<Record<string, string>> = {
  "odin-foundations": "选择其中的 Git、HTML/CSS、DOM 和 JavaScript 内容，作为进入 Full Stack Open 前较平缓的跑道。",
  "fcc-javascript-v9": "这是练习场，用它补薄弱点；证书不是目标。",
  "mdn-js-guide": "遇到问题时查阅的参考资料，不是开始前必须刷完的第二门课。",
  "js-video": "可选：当文字解释没有讲明白时，再用视频走一遍。",
  "js-core-milestone": "从零写出三者，再解释它们为什么需要闭包，以及没有闭包会坏在哪里。",
  fullstackopen: "这是主干课程。按照下面选出的部分依次学习，不要把它当成最后一次性完成的巨大课程。",
  "fso-part-0": "从 Network 面板和时序图开始，在 React 之前先建立完整系统图景。",
  "web-fundamentals-milestone": "选择一个常用应用里的按钮，用 DevTools 记录请求，再用自己的话画出浏览器与服务器的时序。",
  "fcc-frontend-libraries": "只作为补充：当 React 语法需要更多重复练习时再使用。",
  "frontend-libraries-milestone": "选择一个每天使用的面板重新实现，并说明每份状态为什么属于服务器、URL 或组件。",
  "fcc-backend-apis": "只作为补充：当 Express 和 REST 需要第二种解释时再使用。",
  "backend-apis-milestone": "验证所有输入，列出每种失败模式、状态码，以及客户端接下来能做什么。",
  "testing-auth-milestone": "选择一条从 UI 到数据库的写操作，要求登录，并在每个可能失败的边界留下测试。",
  "state-engineering-milestone": "找到两个事实来源，选择唯一所有者，把重复边界提取成 Hook，并解释为什么这个边界合理。",
  "ts-docs": "Part 9 之后使用的参考资料，不是第二门前置课程。",
  "ts-advanced-playlist": "加深材料：等 Part 9 的基础模型能够干净编译后再看。",
  "typescript-milestone": "给真实模块加入可辨识联合和有意义的泛型，让 strict 在没有 any 和类型断言的情况下通过。",
  "fcc-relational-database": "只作为补充：当 SQL 语法需要更多重复练习时再使用。",
  "relational-data-milestone": "画出模型，列出需要的索引，并找到当前代码中会逐行发起查询的位置。",
  "full-stack-open-milestone": "使用 CI 和环境配置部署，再故意发布一个错误版本，执行你声称可行的回滚。",
  cs50w: "使用安全与可扩展性内容获得第二种系统视角，不要重复刷完整套 Django 课程。",
  "roadmap-full-stack": "最后用于查缺补漏，不是阅读顺序，更不是把它列出的每项技术都加入课程的理由。",
  "security-scale-milestone": "指出信任边界、第一个可能的瓶颈、确认它所需的证据，以及你会做的最小修改。",
  "project-sources-milestone": "先写 README。如果不能用一段话描述项目，范围就太大了。",
  "cosmic-python": "这本书最直接对应 Robin 的现有结构：领域模块在内，HTTP 和工具适配器在外。",
  "fowler-architecture": "短篇文章。先读分层和演进式设计相关内容。",
  "architecture-in-the-small-milestone": "列出每个端口，再找出一处泄漏到领域中的框架类型——通常总会有一处。",
  ddia: "第 1–6 章是主干。慢慢读，每章用自己的话写下一项权衡。",
  "sre-book": "学习运行系统会教你的内容：SLO、过载和级联故障。",
  "distributed-fundamentals-milestone": "写下系统复制什么、分区什么、放弃哪种一致性，并记录每个结论来自什么观察。",
  "system-design-primer": "整个主题的索引。用来找缺口，不要把它当成阅读顺序。",
  "system-design-101": "以图为先，适合检查自己能否脱离原文重新画出系统。",
  "designing-a-system-milestone": "包含需求、粗略估算、API、数据模型、扩展路径，以及一节明确说明哪些事情故意没做。",
  "pi-web": "你自己的项目。把它当成别人写的，并假设下周一就要扩展它。",
  "reading-architectures-milestone": "写清边界、状态位置，以及一个你会做出不同决定的地方和理由。",
  "owasp-asc": "官方入门点。先暂存，等 fundamentals 吃透后启用。",
  "security-shepherd": "可选动手练；你的 practice-* 靶子已经覆盖同风格，同样暂存。",
  "owasp-web-courses": "评估型课程。只有当 ASC101 单读不够时再升级。",
  "otel-lfs148": "官方免费约 8–10 小时入门点。等准备好要实际接线时再启用。",
  "anthropic-context-engineering": "核心论证：context 是 curated working set，不是堆满 token。",
  "mcp-spec": "读懂边界规则：MCP 是集成边界，不是数据面。",
  "openai-agents-mcp": "实践层。与规范一起读，不要没看规范就上代码。",
};

const ZH_CN_MODULE_COPY: Readonly<Record<string, ModuleCopy>> = {
  "js-core": {
    title: "打牢 JavaScript 基础",
    outcome: "能自然地编写小程序、跟踪异步代码，并在猜测之前先检查页面实际发生了什么。",
    guide: {
      plainLanguage: "JavaScript 是后续浏览器和 Node.js 内容共同依赖的语言。本单元要让函数、对象、闭包和异步行为熟悉到不再被框架语法挡住。",
      prerequisites: "会基本使用电脑，并掌握足够的 Git，能保存和恢复自己的代码。",
      applicationRole: "这是浏览器界面和后续 Node.js 服务端共同使用的语言层。",
      jobRelevance: "面试和代码评审常用闭包、异步、对象与调试来判断你是真的理解 JavaScript，还是只记得框架写法。",
      smallExercise: "实现 debounce、throttle 和 event emitter，并解释每个实现把状态保存在什么地方。",
      exitCriteria: "当你能解释闭包和事件循环、跟踪异步代码，并且不照抄模板也能完成小型 JavaScript 练习时即可继续。",
    },
  },
  "web-fundamentals": {
    title: "看懂一个 Web 应用如何运转",
    outcome: "使用浏览器 Network 面板跟踪请求，并说明浏览器、服务器、HTTP、HTML 和 JavaScript 分别负责什么。",
    guide: {
      plainLanguage: "先别急着选框架，先观察页面如何加载：浏览器请求文件和数据，服务器返回响应，JavaScript 再修改屏幕上的内容。DevTools 会把这个过程显示出来。",
      prerequisites: "日常 JavaScript、基础 HTML，以及会打开浏览器 Console 和 Network 面板。",
      applicationRole: "这是连接浏览器运行时、HTTP 消息、服务端响应和页面渲染的整套系统视角。",
      jobRelevance: "调试面试和日常全栈工作都要求你能跟踪请求，并区分问题发生在浏览器、网络还是服务器。",
      smallExercise: "选择一次页面加载，使用 DevTools 记录请求，并用自己的话画出浏览器与服务器的时序。",
      exitCriteria: "当你能从输入 URL 一直解释到页面渲染，并能把故障定位到正确层级时即可继续。",
    },
  },
  "frontend-libraries": {
    title: "构建界面并连接数据",
    outcome: "构建 React 组件树，让每份状态都有明确的唯一所有者，并在不隐藏请求流程的前提下读取和更新服务端数据。",
    guide: {
      plainLanguage: "页面是一棵组件树，状态是会让这棵树重新渲染的信息。难点不是调用 setState，而是只保留一个可信来源，避免多份副本逐渐不一致。",
      prerequisites: "熟悉 JavaScript 函数、数组、对象、事件和异步回调。",
      applicationRole: "这是浏览器端边界：它把用户操作和服务端数据变成 UI，同时避免不同组件对现实产生冲突理解。",
      jobRelevance: "前端面试会考状态归属、渲染、Hooks 和共享状态，因为这些决定了功能变大后是否仍然可理解。",
      smallExercise: "构建一个可筛选列表，再移除一份重复状态，让筛选结果从唯一数据源推导出来。",
      exitCriteria: "当你能画出组件树、指出每份状态的所有者，并解释为什么派生数据不该成为独立状态时即可继续。",
    },
  },
  "backend-apis": {
    title: "把逻辑放到 API 后面",
    outcome: "构建 Node 与 Express 服务，使路由能验证输入、返回可操作的错误，并明确浏览器与服务器之间的边界。",
    guide: {
      plainLanguage: "服务器收到 HTTP 消息后，要检查输入是否合法、用户是否有权限、执行业务规则、访问存储，再把结果变成响应。把这些工作全塞进一个路由会让任何修改都很危险。",
      prerequisites: "理解 HTTP 请求与响应、JavaScript 异步代码，以及基础 Node.js 模块使用。",
      applicationRole: "这里决定应用允许发生什么，与浏览器如何画按钮、数据库如何存储结果相互独立。",
      jobRelevance: "后端面试会考验证、错误处理、服务边界和失败模式，因为生产代码拒绝错误操作的次数并不比接受正确操作少。",
      smallExercise: "添加一个创建接口，包含输入验证和三种明确失败，并写出客户端分别会收到什么响应。",
      exitCriteria: "当路由足够薄、业务规则可以脱离 HTTP 测试，并且每种预期失败都有明确状态码和消息时即可继续。",
    },
  },
  "testing-auth": {
    title: "添加测试、用户和认证",
    outcome: "保护路由、测试应用两端，并能区分认证失败、权限失败、验证失败和代码错误。",
    guide: {
      plainLanguage: "认证回答“你是谁”，授权回答“你能做什么”。即使 UI 已经隐藏按钮，安全的应用仍必须在服务器上再次检查。",
      prerequisites: "理解 HTTP 头、Cookie 或 Token、服务端验证，以及包含用户和资源归属的数据模型。",
      applicationRole: "这条边界横跨客户端、API 和数据库：凭证通过 HTTP 进入，服务端策略保护操作，资源归属保存在数据中。",
      jobRelevance: "登录流程和访问控制能暴露候选人是否真正理解信任边界，而不是把安全当成前端隐藏按钮。",
      smallExercise: "保护一个写操作：未登录用户得到 401，错误用户得到 403，资源所有者可以成功。",
      exitCriteria: "当你能跟踪登录如何贯穿整套系统，并用例子解释 401、403 和输入无效的区别时即可继续。",
    },
  },
  "state-engineering": {
    title: "让前端在变大后仍然稳固",
    outcome: "有意识地选择本地或共享状态，提取可复用 Hook，并解释应用周围的构建与路由机制。",
    guide: {
      plainLanguage: "页面变大后，状态会跨越组件边界，重复的 effect 也会变成隐藏基础设施。本单元要把这些边界说清楚，而不是条件反射地使用全局状态。",
      prerequisites: "已经能构建包含本地状态、effect、表单和服务端通信的 React 组件树。",
      applicationRole: "这是让大型前端功能在组件、路由和数据依赖增加后仍保持可预测的工程层。",
      jobRelevance: "React 面试常考 Hooks、共享状态、渲染和复用，因为多数前端复杂度来自归属和同步，而不是 JSX。",
      smallExercise: "在一个功能中找到两个事实来源，选择唯一所有者，并把一段重复的有状态边界提取成自定义 Hook。",
      exitCriteria: "当你能解释本地与共享状态的选择、Hook 依赖行为，并在不改变行为的前提下删除重复状态时即可继续。",
    },
  },
  typescript: {
    title: "用 TypeScript 排除错误状态",
    outcome: "使用联合类型、泛型和类型收窄建模领域，让不可能状态在编译期失败，而不是到生产环境才失败。",
    guide: {
      plainLanguage: "只有当类型描述了应用真实状态时，TypeScript 才有价值，而不是给每个值随手加注解。好的类型会把不可能组合变成编译错误。",
      prerequisites: "熟悉 JavaScript，并有一个已经理解其输入、输出和状态的真实模块。",
      applicationRole: "类型记录并约束 UI 内部、API 边界和领域模型之间的契约。",
      jobRelevance: "团队会考类型收窄、联合类型、泛型和 API 建模，因为粗糙类型会在增加虚假安全感的同时隐藏与无类型代码相同的错误。",
      smallExercise: "选择一个无类型模块，用可辨识联合建模状态，并让 strict 模式在没有 any 和类型断言的情况下通过。",
      exitCriteria: "当无效状态无法编译，并且你能解释每个联合、泛型和收窄分支为什么存在时即可继续。",
    },
  },
  "relational-data": {
    title: "设计能够保持正确的数据",
    outcome: "把领域转成带键、约束和索引的表，并识别那些在规模扩大后会变成 N+1 的查询。",
    guide: {
      plainLanguage: "数据库不是一个 JSON 抽屉。Schema 定义什么可以存在，约束拒绝不可能数据，查询提出精确问题，索引则用写入成本和空间换取读取速度。",
      prerequisites: "理解服务端业务规则，并具备足够的 HTTP 知识，知道每个请求真正需要哪些数据。",
      applicationRole: "这是应用的持久记忆。服务器把业务操作翻译成针对数据库的事务和查询。",
      jobRelevance: "全栈岗位常考 Schema、Join、索引、事务和 N+1，因为数据错误会跨越部署长期存在，并在规模扩大后变得昂贵。",
      smallExercise: "为一个项目画三张相关表，添加键和约束，再写一个 Join，并说明它需要什么索引。",
      exitCriteria: "当你能为 Schema 辩护、解释每个关系和索引，并发现代码中逐行查询的位置时即可继续。",
    },
  },
  production: {
    title: "发布并运行应用",
    outcome: "在 CI 中运行测试、用容器打包应用、管理环境配置，并能从一次失败发布中恢复。",
    guide: {
      plainLanguage: "发布是一条反馈回路：测试捕获已知故障，CI 重复执行检查，部署移动确定的产物，可观测性则告诉你发布后真实系统正在做什么。",
      prerequisites: "已经拥有值得保护的 UI、API、数据模型和完整认证用户流程。",
      applicationRole: "这一层包住整个技术栈，把一台电脑上的代码变成别人也能修改、观察和恢复的服务。",
      jobRelevance: "雇主需要工程师在合并后继续拥有变更，因此面试会考测试边界、CI/CD、容器、配置、日志和回滚决策。",
      smallExercise: "让一个仓库通过 CI，故意破坏测试来证明门禁有效，完成部署，再执行并记录一次回滚。",
      exitCriteria: "当干净检出的代码无需隐藏本地步骤也能通过 CI 和部署，并且你能找到并逆转失败发布时即可继续。",
    },
  },
  "security-scale": {
    title: "思考接下来会在哪里出问题",
    outcome: "从安全和规模压力审查应用，指出第一个瓶颈，并提出成本最低且能够辩护的应对方式。",
    guide: {
      plainLanguage: "架构是一组昂贵且难以改变的决定。规模化不是加入所有分布式工具，而是测量现有设计何时失效，再修改能换来足够空间的最小边界。",
      prerequisites: "已经端到端构建并部署一个应用，包括数据模型、失败行为和运行信号。",
      applicationRole: "这是高于单独技术层的视角：边界、所有权、数据流、故障传播、复制，以及修改系统的成本。",
      jobRelevance: "系统设计面试考察你能否从模糊需求走到接口、数据、估算、失败和明确权衡，而不是背诵产品名称。",
      smallExercise: "画出一个已部署项目，标出信任边界和故障边界，再指出第一个瓶颈以及什么证据能证明需要修改。",
      exitCriteria: "当你能口头为一个端到端设计辩护，包括明确说明哪些东西故意没做、什么证据会改变决定时即可继续。",
    },
  },
  "project-sources": {
    title: "项目从哪里来",
    outcome: "始终准备一个只比上个项目大一级的下一项目。",
    guide: {
      plainLanguage: "项目把分散课程变成一套系统。选择一个只比上次稍大的目标，收窄到一条有用流程，在添加下一项技术之前先把它完成。",
      prerequisites: "完成浏览器、UI、HTTP、服务端、数据、认证和部署等核心单元。",
      applicationRole: "这是整合能力的证明：一个实际产物，说明各层能够协作，并且你会控制范围。",
      jobRelevance: "完成的项目能为架构、调试、测试、部署和所有权等面试问题提供具体证据。",
      smallExercise: "先写一段项目 README，定义一条端到端用户流程，并在扩大范围之前先发布这条流程。",
      exitCriteria: "当项目已经部署、其他人能按照 README 运行，并且你能解释每一层和主要权衡时即可继续。",
    },
  },
  "architecture-in-the-small": {
    title: "小规模架构",
    outcome: "让领域逻辑摆脱框架依赖，理解 Repository、Service Layer、Unit of Work 和事件，并判断这种分离何时值得成本。",
    guide: {
      plainLanguage: "小规模架构决定哪些代码拥有业务含义，哪些代码只负责连接框架、数据库和 HTTP。目标是有用的分离，而不是为了分层而分层。",
      prerequisites: "已经修改过一个端到端应用中的路由、业务规则和持久化代码。",
      applicationRole: "它塑造单个服务内部的边界，让领域决策能够承受框架和存储方式的变化。",
      jobRelevance: "设计和高级编码面试会观察职责是否清晰、边界是否可测试，以及你能否判断抽象何时成本高于收益。",
      smallExercise: "把一个项目重新画成领域、应用和适配器边界，再找出一处向内泄漏的框架类型。",
      exitCriteria: "当你能为每条边界辩护，并指出一个不值得再加一层的地方时即可继续。",
    },
  },
  "distributed-fundamentals": {
    title: "分布式基础",
    outcome: "从第一原则思考复制、分区和一致性，而不是只会引用 CAP。",
    guide: {
      plainLanguage: "当数据和工作分布在多台机器上时，延迟和局部故障是常态。复制、分区和一致性是在决定哪些保证能够在这些故障中继续存在。",
      prerequisites: "理解已部署服务、关系型数据，并习惯分析失败而不只分析成功请求。",
      applicationRole: "它解释了当单个数据库或服务不再足够、状态必须跨机器传播时，系统发生了什么变化。",
      jobRelevance: "系统设计面试通过复制和一致性考察权衡推理，而不是考你背诵 CAP 定义。",
      smallExercise: "选择一个常用系统，判断它复制和分区了什么，并从可观察行为推断一项一致性取舍。",
      exitCriteria: "当你能推演一次网络分区，并明确说明保留什么保证、削弱什么保证以及原因时即可继续。",
    },
  },
  "designing-a-system": {
    title: "端到端设计系统",
    outcome: "在一小时内口头完成从需求、估算、接口和数据模型到可辩护权衡的开放式设计。",
    guide: {
      plainLanguage: "系统设计是从需求推导到决定的论证。先明确用户和负载，再选择接口、数据、边界和真正解决当前问题的扩展路径。",
      prerequisites: "构建过一套完整技术栈，并掌握架构、数据库和分布式系统的基础词汇。",
      applicationRole: "它在实现让决定变得昂贵之前，把所有层组合成一份能够辩护的计划。",
      jobRelevance: "系统设计面试直接考察需求发现、估算、数据建模、接口、瓶颈和在模糊条件下的沟通能力。",
      smallExercise: "设计一个短链接系统，包含需求、估算、API、Schema、瓶颈和一个明确推迟的功能。",
      exitCriteria: "当你能主导一小时口头设计，并且不跳过需求、数字、数据、失败或权衡时即可继续。",
    },
  },
  "reading-architectures": {
    title: "阅读真实架构",
    outcome: "快速理解陌生代码库，并借走其中真正好的做法。",
    guide: {
      plainLanguage: "真实代码库会暴露架构图省略的妥协。阅读代码库意味着找到入口、状态、边界、数据流，以及让陌生仓库变得连贯的关键决定。",
      prerequisites: "具备足够实现和架构经验，能识别框架，但不会把框架误认为领域本身。",
      applicationRole: "这是加入现有团队、安全扩展系统，并比较教材模式与生产约束的方式。",
      jobRelevance: "多数工作面对的是现有代码，因此面试和入职都奖励那些能快速定位、先解释系统再修改的工程师。",
      smallExercise: "阅读一个不是你写的仓库，写一页说明，包含边界、状态、请求流和一个有争议的决定。",
      exitCriteria: "当其他工程师能依靠你的说明找到主流程，并且每个判断都能指向具体文件或接口时就达标。",
    },
  },
  "appendix-security": {
    title: "附录：Shift-left 安全（以后再入正线）",
    outcome: "把三项安全资源暂存于货架，待基础学得扎实后再作为正式练习，而不是永远挂在'待办'。",
    guide: {
      plainLanguage: "做好安全不止靠一个'哪里先坏'的模块。这里的资源在你吃透 fundamentals 前一直处于暂存状态，之后会升级成关于信任边界、安全编码和威胁建模的正式 module。",
      prerequisites: "主线已读完整；'what breaks next' 已经读过并实操过一回。",
      applicationRole: "这个附录是待升队列，每个 item 都写明升级条件，也避免混进通用 review。",
      jobRelevance: "高级岗位越来越要求开发者变成'半个安全工程师'，正是吴恩达 AI Engineering Skills 文里强调的 shift-left 观点。",
      smallExercise: "挑一个 item，说出它为什么仍留在货架，以及什么样的升级 milestone 会让它进入主线。",
      exitCriteria: "当你能解释为什么安全需要有专属货架、而不是挤进通用 'breaks next' 的 review，便可继续。",
    },
  },
  "appendix-observability": {
    title: "附录：可观测性（以后再入正线）",
    outcome: "把 OpenTelemetry 入门和升级 milestone 暂存于货架：SRE Book 已把理论讲完，这个货架是为了动手技能不被丢失。",
    guide: {
      plainLanguage: "SRE Book 已解释了 observability 用来干什么。这里把 OpenTelemetry 官方免费课程作为具体入口暂存，等你真要给项目装 instrumentation 时再升成 architecture track。",
      prerequisites: "至少有一次你能回滚部署；是与 'Ship and operate' milestone 一同驱动。",
      applicationRole: "不是理论问题，是可见性问题。只有在你亲手给已有项目接 traces/alerts 时才赚得到。",
      jobRelevance: "生产就绪面试越来越多探 instrumentation 选择和告警设计，而不仅是 SLO 词汇。",
      smallExercise: "写下哪个触发条件会把 OTel 从这个货架升级成主线 module。",
      exitCriteria: "当 SRE Book 阅读配合一次真的 instrumentation + 告警尝试后，这个附录就可以升级了。",
    },
  },
  "appendix-agent-data": {
    title: "附录：Agent 数据基础设施（以后再入正线）",
    outcome: "把三篇教如何为 agent 建数据基础设施 — 不仅是给人或传统软件 — 的文档暂存于货架，直到某项目准备好了再实际读用。",
    guide: {
      plainLanguage: "Agent 需要为它们挑选数据，而不是全量 context 填满。这些文档解释为什么 MCP 是集成边界、context 为何变成 curated working set、治理为何仍然适用。直到项目准备好再读。",
      prerequisites: "至少有一个项目能让你讲清它的数据模型和 agent 面；这个附录就是那一讲前的阅读列表。",
      applicationRole: "吴恩达 AI Engineering Skills 明确说这是与基础并列、正在迅速演化的 gap。",
      jobRelevance: "现在用 coding agent 的人都会被问到 agent 上下文为什么选、如何保证治理这一块，这是 Ng 说没有教材的新领域。",
      smallExercise: "挑一个项目，列出它当前 agent 数据面，找出其中一处 context 仍是'随手塞满'而非 curated。",
      exitCriteria: "当三篇文档已放进队列，且下一项目的首次工程会话明确记下 agent context 如何选时，即可继续。",
    },
  },
};

export function localizeCurriculumModule(module: CurriculumModule, locale: Locale): CurriculumModule {
  if (locale !== "zh-CN" && locale !== "zh-TW") return module;
  const copy = ZH_CN_MODULE_COPY[module.id];
  if (!copy) return module;
  const translate = locale === "zh-TW" ? toTraditionalChinese : (value: string) => value;
  return {
    ...module,
    title: translate(copy.title),
    outcome: translate(copy.outcome),
    guide: module.guide
      ? {
          ...module.guide,
          plainLanguage: translate(copy.guide.plainLanguage),
          prerequisites: translate(copy.guide.prerequisites),
          applicationRole: translate(copy.guide.applicationRole),
          jobRelevance: translate(copy.guide.jobRelevance),
          smallExercise: translate(copy.guide.smallExercise),
          exitCriteria: translate(copy.guide.exitCriteria),
        }
      : module.guide,
    items: module.items.map((item) => {
      const hint = ZH_CN_ITEM_HINTS[item.id];
      return hint ? { ...item, hint: translate(hint) } : item;
    }),
  };
}

export function hasZhCNModuleCopy(moduleId: string): boolean {
  return Boolean(ZH_CN_MODULE_COPY[moduleId]);
}
