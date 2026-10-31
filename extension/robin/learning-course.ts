import { WEB_LESSONS } from "./learning-course-web.ts";
import { AI_LESSONS } from "./learning-course-ai.ts";
import { DELIVERY_LESSONS } from "./learning-course-delivery.ts";
import { TRAINING_LESSONS } from "./learning-course-training.ts";

/** Authored teaching material, not extracted headings or model output generated on page open. */
export interface CourseLesson {
  id: string;
  stage: string;
  title: string;
  question: string;
  outcome: string;
  prerequisites: string[];
  takeaway: string;
  diagram: { caption: string; nodes: Array<{ label: string; detail: string }> };
  explanation: Array<{ title: string; body: string }>;
  worked: { title: string; body: string };
  misconception: { wrong: string; right: string };
  check: { question: string; choices: Array<{ text: string; feedback: string }>; answer: number };
  exercise: { title: string; task: string; hints: [string, string]; solution: string; rubric: string[] };
  notes: string[];
  sources: string[];
}

export const COURSE_STAGES = [
  { id: "orientation", title: "先看全景", question: "我究竟在学哪一层？", description: "先把产品、软件、模型、训练和基础设施放回各自的位置。", optional: false },
  { id: "web", title: "交付一个 Web 产品", question: "没有 AI，系统能可靠工作吗？", description: "浏览器 → API → 数据库 → 权限 → 部署，用工单系统串起来。", optional: false },
  { id: "model", title: "理解模型怎么工作", question: "模型到底学了什么？", description: "从 token、权重到训练目标，先建立可解释的心智模型。", optional: false },
  { id: "application", title: "做可靠的 AI 功能", question: "怎样证明它有用、不会越界？", description: "先评测，再接模型、检索和工具；学习输出不确定的系统。", optional: false },
  { id: "training", title: "深入训练与 Infra", question: "什么时候值得改权重、加算力？", description: "应用开发可先跳到交付；训练与基础设施方向在这里深入。", optional: true },
  { id: "delivery", title: "交给真实使用者", question: "客户怎样验收，出事谁接手？", description: "把需求、数据、集成、业务指标和故障恢复连成闭环。", optional: false },
] as const;

/** Official references checked during preparation; examples and exercises below are teaching designs. */
export const COURSE_SOURCES: Record<string, { title: string; url: string; focus: string }> = {
  promises: { title: "MDN · Using promises", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises", focus: "异步顺序、await、并发、错误传播与取消边界。" },
  closures: { title: "MDN · Closures", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures", focus: "词法环境、捕获变量与可变绑定。" },
  authorization: { title: "OWASP · Authorization Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html", focus: "默认拒绝、每次请求校验、服务端对象权限与最小权限。" },
  llm: { title: "Hugging Face · LLM Course", url: "https://huggingface.co/learn/llm-course/chapter1/1", focus: "Transformer、tokenizer、模型使用与后续训练课程；深入实践需要 Python 基础。" },
  rag: { title: "Microsoft · RAG design and evaluation", url: "https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide", focus: "切块、embedding、混合检索与逐层评测；Azure 实现是实例，不是本课程的必选平台。" },
  http: { title: "MDN · Overview of HTTP", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview", focus: "请求、响应、客户端与服务端；HTTP 无状态不等于不能有会话。" },
  react: { title: "React · Thinking in React", url: "https://react.dev/learn/thinking-in-react", focus: "组件划分、最小状态、派生数据与状态的归属。" },
  postgres: { title: "PostgreSQL · Transactions", url: "https://www.postgresql.org/docs/current/tutorial-transactions.html", focus: "事务如何把多个数据库步骤变成一个原子操作。" },
  sft: { title: "Hugging Face · SFT Trainer", url: "https://huggingface.co/docs/trl/en/sft_trainer", focus: "监督微调的数据格式、token loss、mask 和训练配置。" },
  dpo: { title: "Hugging Face · DPO Trainer", url: "https://huggingface.co/docs/trl/en/dpo_trainer", focus: "同一 prompt 的 chosen/rejected、参考模型与偏好目标。" },
  grpo: { title: "Hugging Face · GRPO Trainer", url: "https://huggingface.co/docs/trl/en/grpo_trainer", focus: "生成候选、奖励、组内相对优势，以及实现变体。" },
  lora: { title: "LoRA · 原论文", url: "https://arxiv.org/abs/2106.09685", focus: "冻结基座，学习低秩权重增量；论文实验不是通用性能承诺。" },
  qlora: { title: "QLoRA · 原论文", url: "https://arxiv.org/abs/2305.14314", focus: "冻结的量化基座与可训练 LoRA adapter 的区别。" },
  eval: { title: "Inspect · Evaluation framework", url: "https://inspect.aisi.org.uk/", focus: "Dataset、Solver、Scorer 如何构成可复现的评测。" },
  mcp: { title: "MCP · Architecture overview", url: "https://modelcontextprotocol.io/docs/learn/architecture", focus: "Host、Client、Server 和工具／资源／提示模板的职责。" },
  fsdp: { title: "PyTorch · FSDP2 tutorial", url: "https://docs.pytorch.org/tutorials/intermediate/FSDP_tutorial.html", focus: "对比 DDP 的副本与 FSDP 的参数、梯度、优化器状态分片。" },
  vllm: { title: "vLLM · 官方文档", url: "https://docs.vllm.ai/en/latest/", focus: "推理服务、KV 管理、continuous batching 与部署能力。" },
};

export const COURSE_LESSONS: CourseLesson[] = [...WEB_LESSONS, ...AI_LESSONS, ...TRAINING_LESSONS, ...DELIVERY_LESSONS];
export const COURSE_NAMESPACE = "@learning-course";
export const COURSE_PATH = "software-ai-foundations";
