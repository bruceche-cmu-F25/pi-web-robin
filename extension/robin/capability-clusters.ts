import type { CapabilityRole } from "./capability-map.ts";

export interface CapabilityCluster {
  id: string;
  domain: string;
  title: string;
  titleZh: string;
  nodeIds: string[];
}

/** UI-level grouping: capabilities stay atomic; clusters make the roadmap readable. */
export const CAPABILITY_CLUSTERS: CapabilityCluster[] = [
  { id: "cs-models", domain: "foundations", title: "Computer systems", titleZh: "计算机系统模型", nodeIds: ["problem-solving", "language-runtime", "networking-http", "os-concurrency"] },
  { id: "software-craft", domain: "foundations", title: "Software craft", titleZh: "软件工程实践", nodeIds: ["software-design", "engineering-quality"] },

  { id: "discovery", domain: "product-core", title: "Discovery & framing", titleZh: "发现与问题定义", nodeIds: ["problem-framing", "customer-discovery", "ux-judgment"] },
  { id: "planning", domain: "product-core", title: "Planning & scope", titleZh: "规划与范围", nodeIds: ["requirements", "prioritization"] },
  { id: "measurement", domain: "product-core", title: "Measurement & value", titleZh: "度量与价值判断", nodeIds: ["product-metrics", "experimentation", "business-value"] },

  { id: "service-boundary", domain: "backend-data", title: "Service boundaries", titleZh: "服务边界", nodeIds: ["api-contracts", "backend-services", "identity-security"] },
  { id: "data-correctness", domain: "backend-data", title: "Data & correctness", titleZh: "数据与正确性", nodeIds: ["relational-modeling", "transactions-consistency", "caching"] },
  { id: "async-data", domain: "backend-data", title: "Async & data movement", titleZh: "异步与数据流动", nodeIds: ["async-messaging", "data-pipelines"] },
  { id: "backend-quality", domain: "backend-data", title: "Service quality", titleZh: "服务质量", nodeIds: ["testing-strategy"] },

  { id: "web-architecture", domain: "frontend", title: "Web architecture", titleZh: "Web 架构", nodeIds: ["web-platform", "react-architecture", "client-data-state"] },
  { id: "product-experience", domain: "frontend", title: "Product experience", titleZh: "产品体验", nodeIds: ["design-accessibility", "frontend-performance", "realtime-experience"] },
  { id: "fullstack-ownership", domain: "frontend", title: "Full-stack ownership", titleZh: "全栈交付", nodeIds: ["fullstack-delivery"] },

  { id: "systems-architecture", domain: "platform", title: "Systems architecture", titleZh: "系统架构", nodeIds: ["system-design", "distributed-systems", "cloud-fundamentals"] },
  { id: "delivery-runtime", domain: "platform", title: "Runtime & delivery", titleZh: "运行时与交付", nodeIds: ["containers-orchestration", "delivery-automation"] },
  { id: "production-operations", domain: "platform", title: "Production operations", titleZh: "生产运维", nodeIds: ["observability", "reliability", "performance-capacity"] },
  { id: "platform-governance", domain: "platform", title: "Platform governance", titleZh: "平台治理", nodeIds: ["platform-security", "developer-platforms"] },

  { id: "model-literacy", domain: "ai-systems", title: "Model literacy", titleZh: "模型基础", nodeIds: ["ml-foundations", "llm-foundations"] },
  { id: "context-retrieval", domain: "ai-systems", title: "Context & retrieval", titleZh: "上下文与检索", nodeIds: ["context-engineering", "embeddings-retrieval", "rag"] },
  { id: "agent-systems", domain: "ai-systems", title: "Agent systems", titleZh: "Agent 系统", nodeIds: ["tool-use", "agent-orchestration"] },
  { id: "ai-quality", domain: "ai-systems", title: "Quality & trust", titleZh: "质量与可信", nodeIds: ["ai-evaluation", "ai-safety", "feedback-flywheel"] },
  { id: "ai-production", domain: "ai-systems", title: "AI production", titleZh: "AI 生产系统", nodeIds: ["model-serving", "llmops"] },
  { id: "model-adaptation", domain: "ai-systems", title: "Model adaptation", titleZh: "模型适配", nodeIds: ["multimodal-voice", "training-posttraining"] },

  { id: "technical-product", domain: "product-leadership", title: "Technical product", titleZh: "技术产品", nodeIds: ["technical-product-fluency", "platform-product"] },
  { id: "ai-product", domain: "product-leadership", title: "AI product judgment", titleZh: "AI 产品判断", nodeIds: ["ai-product-judgment"] },
  { id: "product-leadership-execution", domain: "product-leadership", title: "Product execution", titleZh: "产品执行", nodeIds: ["product-execution"] },

  { id: "program-structure", domain: "program-delivery", title: "Program structure", titleZh: "项目群结构", nodeIds: ["program-architecture", "dependency-management", "operating-cadence"] },
  { id: "risk-release", domain: "program-delivery", title: "Risk & readiness", titleZh: "风险与就绪", nodeIds: ["risk-decisions", "release-readiness", "vendor-capacity"] },
  { id: "alignment", domain: "program-delivery", title: "Alignment", titleZh: "协同与沟通", nodeIds: ["stakeholder-communication"] },
  { id: "adoption", domain: "program-delivery", title: "Field adoption", titleZh: "现场采用", nodeIds: ["field-deployment", "adoption-change"] },
];

export interface RoleStage {
  title: string;
  titleZh: string;
  domains: string[];
}

export const ROLE_STAGES: Record<CapabilityRole, RoleStage[]> = {
  backend: [
    { title: "Foundations", titleZh: "基础", domains: ["foundations"] },
    { title: "Build", titleZh: "构建", domains: ["backend-data"] },
    { title: "Operate", titleZh: "运行", domains: ["platform"] },
    { title: "Product context", titleZh: "产品语境", domains: ["product-core", "frontend", "ai-systems", "product-leadership", "program-delivery"] },
  ],
  fullstack: [
    { title: "Foundations", titleZh: "基础", domains: ["foundations", "product-core"] },
    { title: "Build product", titleZh: "构建产品", domains: ["frontend", "backend-data"] },
    { title: "Run product", titleZh: "运行产品", domains: ["platform"] },
    { title: "Lead delivery", titleZh: "推动交付", domains: ["product-leadership", "program-delivery", "ai-systems"] },
  ],
  ai: [
    { title: "Engineering base", titleZh: "工程底座", domains: ["foundations", "backend-data"] },
    { title: "Build intelligence", titleZh: "构建智能", domains: ["ai-systems"] },
    { title: "Productionize", titleZh: "产品化与生产化", domains: ["platform", "frontend"] },
    { title: "Create value", titleZh: "创造产品价值", domains: ["product-core", "product-leadership", "program-delivery"] },
  ],
  pm: [
    { title: "Understand", titleZh: "理解问题", domains: ["product-core"] },
    { title: "Shape", titleZh: "塑造方案", domains: ["product-leadership", "ai-systems"] },
    { title: "Work with systems", titleZh: "协作构建系统", domains: ["foundations", "backend-data", "frontend", "platform"] },
    { title: "Deliver adoption", titleZh: "交付与采用", domains: ["program-delivery"] },
  ],
  tpm: [
    { title: "Frame program", titleZh: "定义项目群", domains: ["program-delivery", "product-core"] },
    { title: "Understand systems", titleZh: "理解系统", domains: ["foundations", "backend-data", "platform"] },
    { title: "Drive execution", titleZh: "推动执行", domains: ["product-leadership"] },
    { title: "Integrate product", titleZh: "整合产品", domains: ["frontend", "ai-systems"] },
  ],
};
