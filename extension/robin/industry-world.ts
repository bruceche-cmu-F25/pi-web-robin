import type { CapabilityNode, CapabilityRole } from "./capability-map";

export type IndustryRegion = "core" | "extension" | "context";

export interface IndustryPillar {
  id: string;
  order: number;
  region: IndustryRegion;
  title: string;
  titleZh: string;
  question: string;
  questionZh: string;
  owns: string;
  ownsZh: string;
  boundary: string;
  boundaryZh: string;
}

export interface IndustryCluster {
  id: string;
  pillar: string;
  title: string;
  titleZh: string;
  nodeIds: string[];
}

/**
 * The industry model is deliberately independent from the job-derived domains.
 * Jobs recolour this world; they do not decide what land exists or where it sits.
 */
export const INDUSTRY_PILLARS: IndustryPillar[] = [
  {
    id: "coding",
    order: 1,
    region: "core",
    title: "DSA & computational thinking",
    titleZh: "01 · DSA 与计算思维",
    question: "How can a problem be represented, reasoned about, and solved within a resource budget?",
    questionZh: "问题怎样被表示、推导，并在有限时间和空间里解决？",
    owns: "Data structures, algorithms, invariants, correctness, complexity, and interview-style reasoning.",
    ownsZh: "数据结构、算法、不变量、正确性、复杂度，以及面试中的推导表达。",
    boundary: "It trains reasoning about computation; it does not teach how to build or operate a production product.",
    boundaryZh: "它训练的是计算推理，不负责教你怎样构建和运行一个生产产品。",
  },
  {
    id: "cs-fundamentals",
    order: 2,
    region: "core",
    title: "CS fundamentals",
    titleZh: "02 · 计算机基础",
    question: "What actually happens inside one machine and across a network?",
    questionZh: "一台机器内部，以及机器之间，实际发生了什么？",
    owns: "Language runtimes, memory, operating systems, concurrency, networking, and protocols.",
    ownsZh: "语言运行时、内存、操作系统、并发、网络与协议。",
    boundary: "It explains the substrate beneath applications; it does not decide product or service architecture.",
    boundaryZh: "它解释应用下面的底座，不负责决定产品或服务怎样划分。",
  },
  {
    id: "data",
    order: 3,
    region: "core",
    title: "Database & data",
    titleZh: "03 · 数据库与数据",
    question: "How is state represented, queried, moved, and kept correct over time?",
    questionZh: "状态怎样表示、查询、流动，并长期保持正确？",
    owns: "Data modelling, SQL, indexes, transactions, consistency, caching, and pipelines.",
    ownsZh: "数据建模、SQL、索引、事务、一致性、缓存和数据管道。",
    boundary: "It owns durable state and data semantics; APIs and business workflows belong to software construction.",
    boundaryZh: "它负责持久状态和数据语义；API 与业务流程属于软件开发。",
  },
  {
    id: "software-development",
    order: 4,
    region: "core",
    title: "Software development",
    titleZh: "04 · 软件开发",
    question: "How do people turn intent into code that remains safe to change?",
    questionZh: "怎样把意图变成可以长期、安全修改的软件？",
    owns: "Code structure, service and UI construction, APIs, auth, testing, Git, collaboration, and product delivery.",
    ownsZh: "代码结构、服务与界面、API、认证、测试、Git、协作和端到端交付。",
    boundary: "It owns the shape and changeability of an application; scale and multi-machine failure belong to system design.",
    boundaryZh: "它负责应用本身的形状和可修改性；规模与多机故障属于系统设计。",
  },
  {
    id: "systems-architecture",
    order: 5,
    region: "core",
    title: "Systems & architecture",
    titleZh: "05 · 系统与架构",
    question: "How should components interact when scale, latency, and partial failure matter?",
    questionZh: "当规模、延迟和部分失败出现时，组件应该怎样协作？",
    owns: "System boundaries, distributed systems, queues, replication, partitioning, resilience, and trade-offs.",
    ownsZh: "系统边界、分布式系统、队列、复制、分片、韧性与取舍。",
    boundary: "It chooses structures under constraints; it is not a catalogue of cloud products or interview templates.",
    boundaryZh: "它在约束下选择结构，不是云产品目录，也不是系统设计面试模板。",
  },
  {
    id: "production-cloud",
    order: 6,
    region: "core",
    title: "Production & cloud",
    titleZh: "06 · 生产环境与云",
    question: "How does a system keep running, changing, and recovering in the real world?",
    questionZh: "系统怎样在真实世界里持续运行、变化和恢复？",
    owns: "Linux, cloud, containers, CI/CD, observability, reliability, capacity, security, and platforms.",
    ownsZh: "Linux、云、容器、CI/CD、可观测性、可靠性、容量、安全和平台。",
    boundary: "It operates real workloads; it does not replace application design or justify unnecessary distribution.",
    boundaryZh: "它负责运行真实负载，不替代应用设计，也不为不必要的分布式复杂度背书。",
  },
  {
    id: "ai-engineering",
    order: 7,
    region: "extension",
    title: "AI engineering extension",
    titleZh: "AI 工程扩展层",
    question: "What changes when part of the system is probabilistic, data-dependent, and expensive to evaluate?",
    questionZh: "当系统的一部分变成概率性的、依赖数据且难以评估时，什么发生了变化？",
    owns: "Model literacy, context, retrieval, agents, evaluation, safety, inference, LLMOps, and feedback loops.",
    ownsZh: "模型基础、上下文、检索、Agent、评估、安全、推理、LLMOps 和反馈闭环。",
    boundary: "AI engineering extends data, software, architecture, and production; it does not replace their foundations.",
    boundaryZh: "AI 工程建立在数据、软件、架构和生产系统之上，并不替代这些基础。",
  },
  {
    id: "product-delivery",
    order: 8,
    region: "context",
    title: "Product & delivery context",
    titleZh: "产品与交付语境",
    question: "How do technical systems become valuable products adopted by real people and organisations?",
    questionZh: "技术系统怎样变成被真实用户和组织采用的有价值产品？",
    owns: "Discovery, requirements, metrics, prioritisation, product judgment, programmes, risk, and adoption.",
    ownsZh: "用户发现、需求、指标、优先级、产品判断、项目群、风险与采用。",
    boundary: "It supplies goals, constraints, and coordination; it should not prescribe implementation without understanding the system.",
    boundaryZh: "它提供目标、约束和协作，不应该在不了解系统时指定实现方式。",
  },
];

export const INDUSTRY_CLUSTERS: IndustryCluster[] = [
  { id: "computational-reasoning", pillar: "coding", title: "Computational reasoning", titleZh: "计算推理", nodeIds: ["problem-solving"] },

  { id: "runtime-machine", pillar: "cs-fundamentals", title: "Runtime & machine", titleZh: "运行时与机器", nodeIds: ["language-runtime", "os-concurrency"] },
  { id: "network-protocols", pillar: "cs-fundamentals", title: "Networks & protocols", titleZh: "网络与协议", nodeIds: ["networking-http"] },

  { id: "relational-state", pillar: "data", title: "Relational state", titleZh: "关系数据与状态", nodeIds: ["relational-modeling", "transactions-consistency"] },
  { id: "data-access-movement", pillar: "data", title: "Data access & movement", titleZh: "数据访问与流动", nodeIds: ["caching", "data-pipelines"] },

  { id: "software-craft", pillar: "software-development", title: "Software craft", titleZh: "软件工程实践", nodeIds: ["software-design", "engineering-quality", "testing-strategy"] },
  { id: "service-construction", pillar: "software-development", title: "Service construction", titleZh: "服务端开发", nodeIds: ["api-contracts", "identity-security", "backend-services"] },
  { id: "web-applications", pillar: "software-development", title: "Web applications", titleZh: "Web 应用", nodeIds: ["web-platform", "react-architecture", "client-data-state"] },
  { id: "product-experience", pillar: "software-development", title: "Product experience", titleZh: "产品体验", nodeIds: ["design-accessibility", "frontend-performance", "realtime-experience"] },
  { id: "end-to-end-ownership", pillar: "software-development", title: "End-to-end ownership", titleZh: "端到端拥有", nodeIds: ["fullstack-delivery"] },

  { id: "architecture-boundaries", pillar: "systems-architecture", title: "Architecture & boundaries", titleZh: "架构与边界", nodeIds: ["system-design", "distributed-systems"] },
  { id: "asynchronous-coordination", pillar: "systems-architecture", title: "Asynchronous coordination", titleZh: "异步协作", nodeIds: ["async-messaging"] },

  { id: "cloud-runtime", pillar: "production-cloud", title: "Cloud runtime", titleZh: "云与运行环境", nodeIds: ["cloud-fundamentals", "containers-orchestration"] },
  { id: "delivery-platform", pillar: "production-cloud", title: "Delivery & platform", titleZh: "交付与平台", nodeIds: ["delivery-automation", "developer-platforms"] },
  { id: "production-operations", pillar: "production-cloud", title: "Production operations", titleZh: "生产运维", nodeIds: ["observability", "reliability", "performance-capacity"] },
  { id: "production-security", pillar: "production-cloud", title: "Security & compliance", titleZh: "安全与合规", nodeIds: ["platform-security"] },

  { id: "model-literacy", pillar: "ai-engineering", title: "Model literacy", titleZh: "模型基础", nodeIds: ["ml-foundations", "llm-foundations"] },
  { id: "context-retrieval", pillar: "ai-engineering", title: "Context & retrieval", titleZh: "上下文与检索", nodeIds: ["context-engineering", "embeddings-retrieval", "rag"] },
  { id: "agent-systems", pillar: "ai-engineering", title: "Agent systems", titleZh: "Agent 系统", nodeIds: ["tool-use", "agent-orchestration"] },
  { id: "ai-quality", pillar: "ai-engineering", title: "Quality & trust", titleZh: "质量与可信", nodeIds: ["ai-evaluation", "ai-safety", "feedback-flywheel"] },
  { id: "ai-production", pillar: "ai-engineering", title: "AI production", titleZh: "AI 生产系统", nodeIds: ["model-serving", "llmops"] },
  { id: "model-adaptation", pillar: "ai-engineering", title: "Model adaptation", titleZh: "模型适配", nodeIds: ["multimodal-voice", "training-posttraining"] },

  { id: "discovery-framing", pillar: "product-delivery", title: "Discovery & framing", titleZh: "发现与问题定义", nodeIds: ["problem-framing", "customer-discovery", "ux-judgment"] },
  { id: "decision-measurement", pillar: "product-delivery", title: "Decision & measurement", titleZh: "决策与度量", nodeIds: ["requirements", "prioritization", "product-metrics", "experimentation", "business-value"] },
  { id: "technical-product", pillar: "product-delivery", title: "Technical product", titleZh: "技术产品判断", nodeIds: ["technical-product-fluency", "ai-product-judgment", "platform-product"] },
  { id: "product-execution", pillar: "product-delivery", title: "Product execution", titleZh: "产品执行", nodeIds: ["product-execution"] },
  { id: "programme-structure", pillar: "product-delivery", title: "Programme structure", titleZh: "项目群结构", nodeIds: ["program-architecture", "dependency-management", "operating-cadence"] },
  { id: "risk-readiness", pillar: "product-delivery", title: "Risk & readiness", titleZh: "风险与就绪", nodeIds: ["risk-decisions", "release-readiness", "vendor-capacity"] },
  { id: "alignment-adoption", pillar: "product-delivery", title: "Alignment & adoption", titleZh: "协同与采用", nodeIds: ["stakeholder-communication", "field-deployment", "adoption-change"] },
];

export const UNDERSTANDING_LEVELS = [
  { level: 0, label: "Recognise", labelZh: "见过", criterion: "Can recognise the term and point to where it belongs.", criterionZh: "能认出这个词，并知道它属于哪一块。" },
  { level: 1, label: "Explain", labelZh: "解释", criterion: "Can explain its purpose, mechanism, and boundary in plain language.", criterionZh: "能用自己的话解释它的目的、机制和边界。" },
  { level: 2, label: "Apply", labelZh: "使用", criterion: "Can implement or use it with guidance and verify the result.", criterionZh: "能在指导下实现或使用，并验证结果。" },
  { level: 3, label: "Own", labelZh: "拥有", criterion: "Can debug, test, operate, and improve it in a real system.", criterionZh: "能在真实系统中调试、测试、运行和改进它。" },
  { level: 4, label: "Design", labelZh: "设计", criterion: "Can choose it under constraints, reject alternatives, and explain the trade-off.", criterionZh: "能根据约束选择或拒绝它，并清楚解释取舍。" },
] as const;

export function targetUnderstanding(node: CapabilityNode, role: CapabilityRole): number {
  const demand = node.roles[role];
  if (demand === 3) return 4;
  if (demand === 2) return 3;
  if (demand === 1) return 1;
  return 0;
}

export interface IndustryReference {
  label: string;
  url: string;
  pillarIds: string[];
  reuse: "link-only" | "MIT" | "CC-BY-4.0" | "official-reference";
  note: string;
  noteZh: string;
}

export interface RoadmapShCollection {
  pillarId: string;
  title: string;
  titleZh: string;
  roadmaps: string[];
}

export interface IndustryDiagram {
  id: string;
  title: string;
  titleZh: string;
  image: string;
  sourceUrl: string;
  author: string;
  license: "CC-BY-4.0";
  modification: "unmodified" | "adapted";
  pillarIds: string[];
}

export const INDUSTRY_DIAGRAMS: IndustryDiagram[] = [
  {
    id: "ai-engineer-roadmap",
    title: "AI Engineer Roadmap — twelve-stage overview",
    titleZh: "AI Engineer Roadmap · 十二阶段总览",
    image: "/robin/references/ai-engineer-roadmap.svg",
    sourceUrl: "https://github.com/bettyguo/ai-engineer-roadmap",
    author: "Betty Guo (Dongxin Guo)",
    license: "CC-BY-4.0",
    modification: "unmodified",
    pillarIds: ["ai-engineering"],
  },
];

export const ROADMAP_SH_HOMEPAGE = "https://roadmap.sh/";

/**
 * A classified index, not a copy of roadmap.sh content. Their current terms
 * permit homepage links but prohibit scraping, republication, framing, and
 * deep links, so these names are search cues and every outbound link stays on
 * the homepage.
 */
export const ROADMAP_SH_COLLECTIONS: RoadmapShCollection[] = [
  { pillarId: "coding", title: "Reasoning & algorithms", titleZh: "推理与算法", roadmaps: ["Data Structures & Algorithms", "LeetCode", "Computer Science"] },
  { pillarId: "cs-fundamentals", title: "Computer foundations", titleZh: "计算机底层", roadmaps: ["Computer Science", "Linux", "Cyber Security"] },
  { pillarId: "data", title: "Data systems", titleZh: "数据系统", roadmaps: ["SQL", "PostgreSQL", "Redis", "Data Engineer", "Data Analyst"] },
  { pillarId: "software-development", title: "Software construction", titleZh: "软件构建", roadmaps: ["Git and GitHub", "Frontend", "Backend", "Full Stack", "API Design", "Software Design & Architecture"] },
  { pillarId: "systems-architecture", title: "Architecture", titleZh: "架构", roadmaps: ["System Design", "Software Architect", "Software Design & Architecture", "API Design"] },
  { pillarId: "production-cloud", title: "Production", titleZh: "生产环境", roadmaps: ["Linux", "DevOps", "Docker", "Kubernetes", "AWS", "Cyber Security"] },
  { pillarId: "ai-engineering", title: "AI & ML", titleZh: "AI 与机器学习", roadmaps: ["AI Engineer", "Machine Learning", "AI and Data Scientist", "MLOps", "Prompt Engineering", "Data Engineer"] },
  { pillarId: "product-delivery", title: "Product & leadership", titleZh: "产品与领导力", roadmaps: ["Product Manager", "Engineering Manager", "Product Design"] },
];

export const INDUSTRY_REFERENCES: IndustryReference[] = [
  { label: "roadmap.sh", url: ROADMAP_SH_HOMEPAGE, pillarIds: INDUSTRY_PILLARS.map((pillar) => pillar.id), reuse: "link-only", note: "Use the classified names as search cues on the original site. Its current terms permit a homepage link, not copying, framing, scraping, or deep links.", noteZh: "按本页分类名称在原站搜索。其现行条款允许链接首页，但不允许复制、嵌入、抓取或深链。" },
  { label: "OSSU Computer Science", url: "https://github.com/ossu/computer-science", pillarIds: ["coding", "cs-fundamentals"], reuse: "MIT", note: "A complete undergraduate-style CS curriculum used to validate the foundations layer.", noteZh: "完整的本科式计算机科学课程，用来校验计算机基础层的覆盖范围。" },
  { label: "System Design Mastery", url: "https://github.com/RIT-MESH/system-design-mastery", pillarIds: ["systems-architecture", "ai-engineering"], reuse: "CC-BY-4.0", note: "System-design and AI-system case studies with reusable Mermaid diagrams; attribution required.", noteZh: "系统设计与 AI 系统案例库，包含可复用 Mermaid 架构图；使用时需要署名。" },
  { label: "System Design Primer", url: "https://github.com/donnemartin/system-design-primer", pillarIds: ["systems-architecture"], reuse: "CC-BY-4.0", note: "Widely used system-design explanations and diagrams; attribution required.", noteZh: "广泛使用的系统设计解释与架构图；使用时需要署名。" },
  { label: "AWS Well-Architected", url: "https://aws.amazon.com/architecture/well-architected/", pillarIds: ["systems-architecture", "production-cloud"], reuse: "official-reference", note: "Operational excellence, security, reliability, performance, cost, and sustainability.", noteZh: "运营卓越、安全、可靠性、性能、成本和可持续性六大生产架构支柱。" },
  { label: "Google Cloud Well-Architected", url: "https://cloud.google.com/architecture/framework", pillarIds: ["systems-architecture", "production-cloud", "ai-engineering"], reuse: "official-reference", note: "Cloud architecture pillars plus an AI/ML perspective.", noteZh: "云架构支柱及跨支柱的 AI/ML 视角。" },
  { label: "Google SRE Book", url: "https://sre.google/sre-book/table-of-contents/", pillarIds: ["systems-architecture", "production-cloud"], reuse: "official-reference", note: "Risk, SLOs, monitoring, incident response, release engineering, and reliability practices.", noteZh: "风险、SLO、监控、事故响应、发布工程和可靠性实践。" },
  { label: "Made With ML", url: "https://github.com/GokuMohandas/Made-With-ML", pillarIds: ["data", "production-cloud", "ai-engineering"], reuse: "MIT", note: "Production ML lifecycle: design, develop, deploy, and iterate.", noteZh: "生产级 ML 生命周期：设计、开发、部署与迭代。" },
  { label: "AI Engineer Roadmap — Betty Guo", url: "https://github.com/bettyguo/ai-engineer-roadmap", pillarIds: ["data", "software-development", "systems-architecture", "production-cloud", "ai-engineering"], reuse: "CC-BY-4.0", note: "A 12-stage AI engineering taxonomy with explicitly reusable content and attribution.", noteZh: "十二阶段 AI 工程分类体系，内容明确允许在署名后复用。" },
  { label: "Azure MLOps v2", url: "https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/machine-learning-operations-v2", pillarIds: ["data", "production-cloud", "ai-engineering"], reuse: "official-reference", note: "Reference architectures for data, model development, deployment, CI/CD, and retraining.", noteZh: "覆盖数据、模型开发、部署、CI/CD 与再训练的参考架构。" },
];
