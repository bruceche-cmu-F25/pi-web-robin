/**
 * The HEAT research stack — hand-curated reference data.
 *
 * HEAT (~/heat) is a black-box hallucination detection and visualization
 * pipeline inherited from a previous student. Taking it over means learning a
 * vocabulary that is spread across five papers, one 1,623-line Python file and
 * a handoff document — and none of those three say the same thing at the same
 * altitude. This file is the fourth thing: every noun the project uses, with
 * the definition, the reason it exists, and the line of `visualize.py` where
 * it actually shows up.
 *
 * Three fields per entry, and they are deliberately different questions:
 *   what — the definition you could find in a paper
 *   role — why the method needs it at all
 *   here — what this specific codebase does with it, including where it is wrong
 *
 * The third one is the whole point. A glossary that stops at `what` is a
 * glossary; a research stack has to say "and in our pipeline this is the step
 * that quietly breaks on SQuAD".
 *
 * Prose is authored in English and Simplified Chinese side by side rather than
 * routed through lib/i18n/messages: these are paragraphs about a research
 * method, not UI chrome, and they change when the research changes, not when
 * the interface does. Traditional Chinese is derived (see research-locales
 * usage in the component).
 */

export const RESEARCH_CATEGORIES = [
  "problem",
  "method",
  "model",
  "data",
  "metric",
  "tool",
  "artifact",
] as const;
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

/** One hue family per category, drawn from the shared event palette. */
export const CATEGORY_TONE: Readonly<Record<ResearchCategory, string>> = {
  problem: "clay",
  method: "sage",
  model: "teal",
  data: "slate",
  metric: "plum",
  tool: "honey",
  artifact: "fern",
};

export interface Bilingual {
  en: string;
  zh: string;
}

export interface ResearchReading {
  id: string;
  title: string;
  source: string;
  url: string;
}

export const PROJECT_REPOSITORY: ResearchReading = {
  id: "project-repository",
  title: "CMU-AGAI/visualization-hallucination-detection",
  source: "GitHub",
  url: "https://github.com/CMU-AGAI/visualization-hallucination-detection",
};

export const PROGRESS_SHEET: ResearchReading = {
  id: "progress-sheet",
  title: "Progress sheet",
  source: "Google Sheets",
  url: "https://docs.google.com/spreadsheets/d/1tT9t6KU_heFcKRpFsMzcG9LFajAfwWDd/edit?gid=574964456#gid=574964456",
};

export const PROJECT_DRIVE: ResearchReading = {
  id: "project-drive",
  title: "Project Google Drive",
  source: "Google Drive",
  url: "https://drive.google.com/drive/folders/1mp0UhY4jRTbd4RuvAQZlP8Fi2xm7ZywS",
};

export const STATUS_REPORT: ResearchReading = {
  id: "status-report",
  title: "Status report",
  source: "Google Docs",
  url: "https://docs.google.com/document/d/13cYycz0I0P7NIRAPI0sbVPrc9MPwQM2nzxpg1J1RDT8/edit?tab=t.0",
};

/** Papers collected for the current research thread, kept separate from the HEAT glossary. */
export const RESEARCH_READINGS: readonly ResearchReading[] = [
  {
    id: "evaluating-large-language-models-for-accuracy-incentivizes-hallucinations",
    title: "Evaluating large language models for accuracy incentivizes hallucinations",
    source: "Nature",
    url: "https://www.nature.com/articles/s41586-026-10549-w",
  },
  {
    id: "probe-process-based-benchmark-for-hallucination-detection",
    title: "PROBE: PROcess-Based BEnchmark for Hallucination Detection",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2026.findings-acl.2099/",
  },
  {
    id: "rlseek-evidence-grounded-reasoning-for-rag-hallucination-detection",
    title: "RLSeek: Evidence-Grounded Reasoning for RAG Hallucination Detection",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2026.acl-long.1492/",
  },
  {
    id: "fine-grained-detection-of-context-grounded-hallucinations-using-llms",
    title: "Fine-Grained Detection of Context-Grounded Hallucinations Using LLMs",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2026.findings-acl.1907/",
  },
  {
    id: "vista-verification-in-sequential-turn-based-assessment",
    title: "VISTA: Verification In Sequential Turn-based Assessment",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2026.acl-long.1890/?utm_source=chatgpt.com",
  },
  {
    id: "prism-probing-reasoning-instruction-and-source-memory-in-llm-hallucinations",
    title: "PRISM: Probing Reasoning, Instruction, and Source Memory in LLM Hallucinations",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2026.acl-long.1551/",
  },
  {
    id: "explainable-hallucination-mitigation-in-large-language-models-a-survey",
    title: "Explainable Hallucination Mitigation in Large Language Models: A Survey",
    source: "Wiley",
    url: "https://wires.onlinelibrary.wiley.com/doi/abs/10.1002/widm.70110",
  },
  {
    id: "hallucination-detection-verification-and-correction-in-generative-ai-a-comprehensive-survey",
    title: "Hallucination Detection, Verification, and Correction in Generative AI: A Comprehensive Survey",
    source: "ScienceDirect",
    url: "https://www.sciencedirect.com/science/article/pii/S2949719126000361?utm_source=chatgpt.com",
  },
];

/** The five core papers named in the previous independent-study report. */
export const PRIOR_WORK_READINGS: readonly ResearchReading[] = [
  {
    id: "selfcheckgpt",
    title: "SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2023.emnlp-main.557/",
  },
  {
    id: "halueval",
    title: "HaluEval: A Large-Scale Hallucination Evaluation Benchmark for Large Language Models",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2023.emnlp-main.397/",
  },
  {
    id: "inside",
    title: "INSIDE: LLMs' Internal States Retain the Power of Hallucination Detection",
    source: "ICLR 2024",
    url: "https://proceedings.iclr.cc/paper_files/paper/2024/hash/0d1986a61e30e5fa408c81216a616e20-Abstract-Conference.html",
  },
  {
    id: "semantic-entropy",
    title: "Detecting hallucinations in large language models using semantic entropy",
    source: "Nature",
    url: "https://www.nature.com/articles/s41586-024-07421-0",
  },
  {
    id: "dola",
    title: "DoLa: Decoding by Contrasting Layers Improves Factuality in Large Language Models",
    source: "ICLR 2024",
    url: "https://proceedings.iclr.cc/paper_files/paper/2024/hash/edc36117f795ca52a0cbf6a7b3882859-Abstract-Conference.html",
  },
  {
    id: "factscore-prior-work",
    title: "FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation",
    source: "ACL Anthology",
    url: "https://aclanthology.org/2023.emnlp-main.741/",
  },
  {
    id: "prometheus-prior-work",
    title: "PROMETHEUS: Inducing Fine-Grained Evaluation Capability in Language Models",
    source: "arXiv",
    url: "https://arxiv.org/abs/2310.08491",
  },
  {
    id: "ur-rag-paper",
    title: "UR-RAG: Unified Risk-Controlled Retrieval-Augmented Generation via Conformal Calibration of Retrieval and Semantic Entropy",
    source: "ResearchGate",
    url: "https://www.researchgate.net/publication/406947419_UR-RAG_Unified_Risk_Calibration_for_Retrieval-Augmented_Generation",
  },
  {
    id: "ur-rag-code",
    title: "UR-RAG: Risk-Controlled Multi-Tier RAG — code repository",
    source: "GitHub",
    url: "https://github.com/CMU-AGAI/urrag-hallucination-detection",
  },
];

export interface StackEntry {
  /** Stable slug; the URL hash and the filter state are keyed on it. */
  id: string;
  /** The canonical term. Never translated — you will meet it in English. */
  term: string;
  /** Other names the same thing travels under, when the mismatch costs time. */
  aka?: string;
  category: ResearchCategory;
  /** Pipeline steps (1-10) this appears in. Empty for framing-only vocabulary. */
  stages: readonly number[];
  /** Where to read the primary source. */
  url?: string;
  /** Where it lives in the codebase, as `visualize.py:NNN` or a filename. */
  ref?: string;
  /** The definition. */
  what: Bilingual;
  /** Why the method needs it. */
  role: Bilingual;
  /** What this repository actually does with it. */
  here: Bilingual;
}

export interface PipelineStep {
  step: number;
  title: Bilingual;
  /** The function that carries the step. */
  fn: string;
  ref: string;
  note: Bilingual;
}

/**
 * The ten steps, in the order a record walks them.
 *
 * Kept beside the stack rather than in the component because the stack entries
 * point back at these numbers: "which step is this noun in" is the question
 * that turns a glossary into a map.
 */
export const PIPELINE: readonly PipelineStep[] = [
  {
    step: 1,
    title: { en: "Sample 10 answers", zh: "采样 10 个回答" },
    fn: "generate_answers",
    ref: "visualize.py:181",
    note: {
      en: "1 main answer taken from the dataset's pred_answer, plus 9 alternatives generated live at temperature 0.9.",
      zh: "1 个 main answer 直接取数据集里的 pred_answer，另外 9 个 alternative 现场以 temperature 0.9 生成。",
    },
  },
  {
    step: 2,
    title: { en: "Judge the main answer", zh: "给 main answer 打分" },
    fn: "evaluate_prometheus_score",
    ref: "visualize.py:241",
    note: {
      en: "A Prometheus-style rubric scores main against gold, 1-5. This is the only label the whole project has.",
      zh: "用 Prometheus 风格 rubric 拿 main 对 gold 打 1-5 分。这是整个项目唯一的标签来源。",
    },
  },
  {
    step: 3,
    title: { en: "Split into atomic facts", zh: "拆成原子事实" },
    fn: "extract_facts_from_sentence",
    ref: "visualize.py:359",
    note: {
      en: "Short answers are expanded into a sentence first, then FActScore-style few-shot prompting breaks each sentence into single-claim facts.",
      zh: "先把短答案扩写成完整句子，再用 FActScore 风格的少样本提示把每句拆成只承载一个断言的 fact。",
    },
  },
  {
    step: 4,
    title: { en: "Deduplicate and filter", zh: "去重与相关性过滤" },
    fn: "deduplicate_facts / check_facts_relevance",
    ref: "visualize.py:418",
    note: {
      en: "Bidirectional NLI entailment >= 0.85 collapses duplicates; one LLM call drops conversational filler without being allowed to judge correctness.",
      zh: "双向 NLI 蕴含 >= 0.85 视为重复并剔除；再用一次 LLM 调用滤掉客套话，但明确禁止它顺手做事实判断。",
    },
  },
  {
    step: 5,
    title: { en: "Side evaluation against gold", zh: "对 gold 的旁路评估" },
    fn: "evaluate_facts_with_llm",
    ref: "visualize.py:525",
    note: {
      en: "Each fact is compared to the gold answer for display only. It does not feed any headline metric, and it is the main API cost.",
      zh: "每条 fact 直接和 gold 比，仅供 HTML 展示，不参与任何主指标——但它是最大的一笔 API 开销。",
    },
  },
  {
    step: 6,
    title: { en: "Build the NLI support matrix", zh: "构造 NLI 支持矩阵" },
    fn: "nli_support_matrix",
    ref: "visualize.py:647",
    note: {
      en: "For each alternative, a main-facts x alt-facts matrix. Premise is the alternative's fact, hypothesis is the main fact — the direction matters.",
      zh: "对每个 alternative 构造 main facts x alt facts 矩阵。前提是 alternative 的 fact，假设是 main 的 fact——方向不能反。",
    },
  },
  {
    step: 7,
    title: { en: "Match one-to-one", zh: "一对一最优匹配" },
    fn: "hungarian_match",
    ref: "visualize.py:609",
    note: {
      en: "The Hungarian algorithm stops one vague alternative fact from being reused to support every main fact at once.",
      zh: "用匈牙利算法防止一条很泛的 alternative fact 被重复用来支持多条 main fact，人为抬高支持度。",
    },
  },
  {
    step: 8,
    title: { en: "Aggregate into scores", zh: "聚合成分数" },
    fn: "evaluate_consistency_hungarian",
    ref: "visualize.py:686",
    note: {
      en: "Per fact: mean over 9 alternatives. Per sentence: mean over its relevant facts. Per record: mean over sentences — unweighted at every level.",
      zh: "每条 fact 取 9 个 alternative 的均值，每句取相关 fact 的均值，整条记录取句子均值——每一层都是不加权的算术平均。",
    },
  },
  {
    step: 9,
    title: { en: "Colour the original text", zh: "把分数映射回原文" },
    fn: "write_heatmap_html",
    ref: "visualize.py:744",
    note: {
      en: "hue = support x 120 (red to green), saturation = share of relevant facts. Three lines of code, and the entire contribution of the project.",
      zh: "hue = support x 120（红到绿），饱和度 = 相关 fact 占比。整个项目的核心 idea 就落在这三行上。",
    },
  },
  {
    step: 10,
    title: { en: "Calibrate and summarise", zh: "校准与汇总" },
    fn: "optimize_and_update_thresholds",
    ref: "visualize.py:1076",
    note: {
      en: "A PR curve over the support scores picks the max-F1 threshold, then accuracy and correlations are reported against it.",
      zh: "在 support score 上画 PR 曲线取 F1 最大点作为阈值，再用该阈值报准确率和相关系数。",
    },
  },
];

/**
 * Every noun the project runs on.
 *
 * Ordered by category rather than alphabetically, because the useful reading
 * order is "what problem, whose method, which model, what data, judged how,
 * built with what, producing what" — an A-Z list would put the answer to
 * "what is a support score" thirty rows from the thing it scores.
 */
export const RESEARCH_STACK: readonly StackEntry[] = [
  // ---------------------------------------------------------------- problem
  {
    id: "hallucination",
    term: "Hallucination",
    category: "problem",
    stages: [],
    url: "https://arxiv.org/abs/2202.03629",
    what: {
      en: "Model output that is fluent, confident and unsupported — either contradicting the source (faithfulness) or contradicting the world (factuality).",
      zh: "模型输出流畅、自信但没有依据：要么和给定材料矛盾（faithfulness），要么和真实世界矛盾（factuality）。",
    },
    role: {
      en: "The engineering problem is not that models are wrong, it is that a wrong answer and a right one look identical on the page.",
      zh: "真正麻烦的不是模型会错，而是错的输出和对的输出在表面上完全无法区分——同样流畅、同样自信、同样有细节。",
    },
    here: {
      en: "HEAT never claims to detect this directly. It detects instability, and the whole research question is how far the two overlap.",
      zh: "HEAT 从不声称直接检测幻觉，它检测的是不稳定性。这两者到底重合多少，正是本项目的研究问题。",
    },
  },
  {
    id: "zero-resource",
    term: "Zero-resource / black-box detection",
    aka: "sampling-based detection",
    category: "problem",
    stages: [1],
    url: "https://arxiv.org/abs/2303.08896",
    what: {
      en: "Detecting hallucination using only the ability to sample the model repeatedly — no logits, no hidden states, no training data, no external database.",
      zh: "只依赖“能对同一问题多次采样”这一个能力来检测幻觉：不需要 logits、hidden states、训练数据或外部数据库。",
    },
    role: {
      en: "White-box methods cannot be applied to GPT, Claude or Gemini, which are the models most systems actually ship on.",
      zh: "白盒方法用不了 GPT / Claude / Gemini 这类只给 API 的模型，而真实系统恰恰跑在它们上面。",
    },
    here: {
      en: "This is HEAT's defining constraint and the reason Phase III abandoned the internal-states line that Phase II built.",
      zh: "这是 HEAT 最根本的设定，也是 Phase III 放弃 Phase II 那条 internal states 路线的原因。",
    },
  },
  {
    id: "self-consistency",
    term: "Self-consistency assumption",
    category: "problem",
    stages: [1, 6],
    url: "https://arxiv.org/abs/2303.08896",
    what: {
      en: "If a model genuinely knows a fact, independent samples will agree; if it is improvising, they drift and contradict each other.",
      zh: "如果模型真的“知道”某个事实，多次独立采样应当互相支持；如果它只是在编，采样之间会漂移、互相矛盾。",
    },
    role: {
      en: "It is the assumption that makes a hallucination score computable without any external truth.",
      zh: "正是这个假设让“不需要任何外部真值也能算出一个幻觉分数”成为可能。",
    },
    here: {
      en: "Inherited wholesale from SelfCheckGPT, and its failure is the project's biggest open gap: a model can be stably, confidently wrong.",
      zh: "整套照搬 SelfCheckGPT。它的失效之处正是本项目最大的 gap：模型完全可以稳定地、自信地错。",
    },
  },
  {
    id: "atomic-fact",
    term: "Atomic fact",
    aka: "claim",
    category: "problem",
    stages: [3],
    url: "https://arxiv.org/abs/2305.14251",
    what: {
      en: "A statement small enough to carry exactly one independently falsifiable claim.",
      zh: "小到只承载一个可以被独立证伪的断言的陈述。",
    },
    role: {
      en: "Granularity is the point: a score attached to a paragraph tells a reader to be nervous, a score attached to a claim tells them which three words to check.",
      zh: "粒度就是价值所在：给整段一个分数只能让人紧张，给一条 claim 一个分数才能告诉人该去核对哪三个字。",
    },
    here: {
      en: "The unit everything downstream operates on. On these two short-answer datasets most records yield just one, which quietly disables step 7.",
      zh: "下游一切计算的基本单位。但这两个短答案数据集里多数记录只拆出一条 fact，导致第 7 步实际上没有被激活。",
    },
  },
  {
    id: "nli",
    term: "Natural Language Inference",
    aka: "NLI, textual entailment",
    category: "problem",
    stages: [4, 6],
    url: "https://cims.nyu.edu/~sbowman/multinli/",
    what: {
      en: "Given a premise and a hypothesis, classify their relation as entailment, contradiction or neutral.",
      zh: "给定前提（premise）和假设（hypothesis），判断二者关系是蕴含、矛盾还是中立。",
    },
    role: {
      en: "It is a logical relation, not a similarity score. Two sentences can be near-identical in wording and still contradict.",
      zh: "它判断的是逻辑关系而不是相似度：两句话措辞几乎一样，仍然可以互相矛盾。",
    },
    here: {
      en: "Used twice for different jobs — as the deduplication test in step 4, and as the support signal itself in step 6.",
      zh: "在两个地方被用于不同目的：第 4 步用它判重复，第 6 步用它算支持度本身。",
    },
  },
  {
    id: "neutral-drop",
    term: "Entailment / contradiction / neutral",
    category: "problem",
    stages: [6],
    ref: "visualize.py:672",
    what: {
      en: "The three NLI labels. HEAT computes softmax over only entailment and contradiction, discarding neutral entirely.",
      zh: "NLI 的三个标签。HEAT 只在 entailment 和 contradiction 两个 logit 上做 softmax，直接丢掉 neutral。",
    },
    role: {
      en: "Collapsing three classes into one continuous support-versus-refute axis is what makes the score colourable.",
      zh: "把三分类压成“支持 vs 反驳”的一条连续轴，才有可能把它映射成颜色。",
    },
    here: {
      en: "The side effect is that neutral — 'did not mention it, did not contradict it' — lands near 0.5 and becomes indistinguishable from genuine half-support. A real modelling choice worth revisiting.",
      zh: "副作用是：neutral（“没说，但也不矛盾”）会落在 0.5 附近，和“半支持”无法区分。这是一个值得重新审视的建模选择。",
    },
  },
  {
    id: "cross-encoder",
    term: "Cross-encoder",
    category: "problem",
    stages: [4, 6],
    url: "https://www.sbert.net/",
    what: {
      en: "An architecture that feeds premise and hypothesis into one transformer together and scores the pair, rather than embedding each separately.",
      zh: "把前提和假设一起送进同一个 transformer 打分的架构，而不是像双塔那样各自编码再比相似度。",
    },
    role: {
      en: "Joint attention over both sentences is what lets it catch negation, quantifiers and swapped entities; a bi-encoder cosine cannot.",
      zh: "两句话共享注意力，才能捕捉否定、量词和实体互换；双塔的余弦相似度做不到。",
    },
    here: {
      en: "The previous student tested cosine-similarity alternatives and reported all of them performing worse — this is an evidenced choice, not a default.",
      zh: "前一位学生实测过基于余弦相似度的替代方案，结论是全部更差。这是有实验支撑的选择，不是随手的默认值。",
    },
  },
  {
    id: "llm-as-a-judge",
    term: "LLM-as-a-judge",
    category: "problem",
    stages: [2, 5],
    url: "https://arxiv.org/abs/2306.05685",
    what: {
      en: "Using a strong LLM with a written rubric to score another model's output in place of a human annotator.",
      zh: "用一个强模型加一份成文 rubric 去给另一个模型的输出打分，替代人工标注。",
    },
    role: {
      en: "It is the only way to get labels at this scale for this budget — and it is the assumption every result inherits.",
      zh: "在这个预算下这是唯一能拿到规模化标签的办法——同时它也是所有结果都继承的一个假设。",
    },
    here: {
      en: "Every number the project reports is agreement with a judge, not with verified truth. There is not one human annotation in the repository.",
      zh: "项目报出的每一个数字都是“和一个 judge 有多一致”，不是“和事实有多一致”。仓库里没有任何一条人工标注。",
    },
  },
  {
    id: "semantic-entropy",
    term: "Semantic entropy",
    category: "problem",
    stages: [],
    url: "https://www.nature.com/articles/s41586-024-07421-0",
    what: {
      en: "Entropy computed over clusters of semantically equivalent generations rather than over token sequences.",
      zh: "先把语义等价的多次生成聚成簇，再在簇上算熵，而不是在 token 序列上算熵。",
    },
    role: {
      en: "The closest published relative of what HEAT measures: uncertainty about meaning, not about wording.",
      zh: "已发表工作中和 HEAT 最接近的一支：度量的是“意思”的不确定性，不是“措辞”的不确定性。",
    },
    here: {
      en: "Surveyed in Phase I and present as a field on some input records, but never computed by this pipeline. A natural baseline to compare against.",
      zh: "Phase I 调研过，输入记录里也带着这个字段，但本流水线从未计算它。是一个天然的对照基线。",
    },
  },
  {
    id: "rag",
    term: "Retrieval-Augmented Generation",
    aka: "RAG",
    category: "problem",
    stages: [1],
    url: "https://arxiv.org/abs/2005.11401",
    what: {
      en: "Retrieving documents at query time and conditioning generation on them, instead of relying on parametric memory alone.",
      zh: "在提问时检索文档并让生成基于这些文档，而不是只依赖模型参数里的记忆。",
    },
    role: {
      en: "An answer written with retrieved context and an answer written from memory are drawn from two different distributions.",
      zh: "看过检索文档写出的答案，和凭记忆写出的答案，来自两个不同的分布。",
    },
    here: {
      en: "The asymmetry at the heart of the pipeline: the main answer came out of a RAG system, the 9 alternatives are generated closed-book. Named 'Non-RAG' in the report title, applied to RAG output.",
      zh: "流水线核心的不对称正在这里：main answer 出自 RAG 系统，9 个 alternative 却是闭卷生成的。报告标题写着 Non-RAG，方法却被用在 RAG 的产物上。",
    },
  },
  {
    id: "gray-zone",
    term: "Gray-zone case",
    aka: "undecided case",
    category: "problem",
    stages: [],
    what: {
      en: "A sample the upstream risk framework can neither confidently accept nor confidently reject.",
      zh: "上游风控框架既不能自信接受、也不能自信拒绝的样本。",
    },
    role: {
      en: "It is where a detector is worth having: the easy cases were already decided upstream.",
      zh: "这正是检测器有价值的地方——容易的样本上游已经处理掉了。",
    },
    here: {
      en: "Both datasets are gray-zone slices from UR-RAG, not standard benchmark splits. Every number must be read as 'on the residue', which is exactly why a majority-class baseline is mandatory.",
      zh: "两个数据集都是 UR-RAG 切出的 gray-zone 子集，不是标准 benchmark 切片。所有数字都要按“在残余样本上”来读，这也正是必须报多数类基线的原因。",
    },
  },
  {
    id: "trust-calibration",
    term: "Trust calibration",
    category: "problem",
    stages: [9],
    url: "https://doi.org/10.1518/hfes.46.1.50_30392",
    what: {
      en: "Whether a person's reliance on an automated system tracks that system's actual reliability, instead of over- or under-trusting it.",
      zh: "人对自动化系统的依赖程度，是否与该系统的实际可靠度相匹配，而不是过度信任或过度怀疑。",
    },
    role: {
      en: "The end goal of a detector is not a correct score, it is a human who doubts in the right places.",
      zh: "检测器的终极目标不是给出一个正确的分数，而是让人在正确的地方产生怀疑。",
    },
    here: {
      en: "Completely untested. The project has measured whether the signal is accurate; it has never measured whether the heatmap makes a reader more accurate. That gap is a whole research direction.",
      zh: "完全没有被测过。项目测的是信号准不准，从没测过“人看了这张图之后判断是否更准”。这个缺口本身就是一整个研究方向。",
    },
  },
  {
    id: "localization",
    term: "Localization (as method, not packaging)",
    category: "problem",
    stages: [9],
    what: {
      en: "Taking an uncertainty number and pinning it to the exact span of text it belongs to.",
      zh: "把一个不确定性数值精确地钉在它所属的那一小段文字上。",
    },
    role: {
      en: "The same 0.42 spread over a paragraph and highlighted on the three characters '1992' are not the same information.",
      zh: "同一个 0.42，摊在整段文字上，和精确高亮到“1992 年”这三个字上，对人的决策价值完全不同。",
    },
    here: {
      en: "This is the argument for why visualization is part of the method rather than a front-end. Worth being able to say in one sentence at a meeting.",
      zh: "这是“可视化属于方法本身而不是包装”的论据。建议练到能在会上用一句话说清。",
    },
  },
  // ----------------------------------------------------------------- method
  {
    id: "selfcheckgpt",
    term: "SelfCheckGPT",
    category: "method",
    stages: [1, 6, 8],
    url: "https://arxiv.org/abs/2303.08896",
    what: {
      en: "The 2023 paper that established zero-resource hallucination detection by sampling several answers and measuring how much they agree.",
      zh: "2023 年确立零资源幻觉检测范式的论文：对同一问题采样多个回答，度量它们互相之间有多一致。",
    },
    role: {
      en: "It is the direct ancestor. HEAT's sampling strategy, its NLI variant, its arithmetic-mean aggregation and its dropped neutral class all come from here.",
      zh: "HEAT 的直系祖先。采样策略、NLI 变体、算术平均聚合、丢弃 neutral，全部来自这篇。",
    },
    here: {
      en: "HEAT = SelfCheckGPT + atomic-fact granularity + one-to-one matching + a heatmap. Being able to state that difference in one sentence is how you defend the contribution.",
      zh: "HEAT = SelfCheckGPT + 原子事实粒度 + 一对一匹配 + 热力图。能用一句话讲清这个差异，才守得住 contribution。",
    },
  },
  {
    id: "factscore",
    term: "FActScore",
    category: "method",
    stages: [3],
    url: "https://arxiv.org/abs/2305.14251",
    what: {
      en: "A method that decomposes long-form generation into atomic facts and scores the fraction supported by a knowledge source.",
      zh: "把长文本生成拆成原子事实，再统计其中被知识源支持的比例的评估方法。",
    },
    role: {
      en: "The source of the decomposition recipe: few-shot prompting with hand-written demonstrations rather than a parser.",
      zh: "原子事实拆分做法的出处：用手写示范的少样本提示来拆，而不是用句法解析器。",
    },
    here: {
      en: "The 8 demonstrations at visualize.py:290 deliberately show nested splitting, so 'Collins piloted the CM on Apollo 11 in 1969' becomes three facts, not one.",
      zh: "visualize.py:290 的 8 个示范刻意演示了嵌套拆分——“Collins 在 1969 年阿波罗 11 号任务中担任指令舱驾驶员”会被拆成三条而不是一条。",
    },
    ref: "visualize.py:290",
  },
  {
    id: "prometheus",
    term: "Prometheus",
    category: "method",
    stages: [2],
    url: "https://arxiv.org/abs/2405.01535",
    what: {
      en: "An open evaluator-LM family and, more importantly here, a rubric prompt format that produces a 1-5 score with a stated reason.",
      zh: "一个开源评估模型家族；在本项目里更重要的是它那套能产出 1-5 分并给出理由的 rubric 提示格式。",
    },
    role: {
      en: "It supplies the label. Every accuracy, correlation and threshold in the project is defined relative to it.",
      zh: "它提供标签。项目里所有准确率、相关系数和阈值都是相对它定义的。",
    },
    here: {
      en: "Only the prompt style is borrowed — the scoring call goes to Gemini at temperature 0, and a regex pulls `[RESULT] n`. A parse failure returns 0 and the record is silently skipped downstream.",
      zh: "只借用了提示风格：打分调用其实走 Gemini，temperature 0，用正则抓 `[RESULT] n`。抓不到就返回 0，该记录在下游被静默跳过。",
    },
    ref: "visualize.py:241",
  },
  {
    id: "inside-eigenscore",
    term: "INSIDE / EigenScore",
    category: "method",
    stages: [],
    url: "https://arxiv.org/abs/2402.03744",
    what: {
      en: "A white-box detector that takes hidden states from a middle layer across K samples and reads the eigen-spectrum of their covariance matrix as a dispersion score.",
      zh: "一种白盒检测方法：取 K 次采样在中间层的 hidden state，对其协方差矩阵的特征谱做度量，得到一个离散度分数。",
    },
    role: {
      en: "Phase II of this same project. It works, but needs a local open model and yields one score for the whole answer.",
      zh: "本项目 Phase II 做的就是它。能跑通，但必须用本地开源模型，而且只能给出整体一个分数。",
    },
    here: {
      en: "Not in this repository — the code lives with the previous student. White-box plus fact-level localization is the one combination nobody has built, and it is what the report's own title promised.",
      zh: "代码不在本仓库，在前一位学生手里。白盒 + fact 级定位是目前没人做过的交集，而这恰好是原报告标题所承诺的东西。",
    },
  },
  {
    id: "dola",
    term: "DoLa",
    category: "method",
    stages: [],
    url: "https://arxiv.org/abs/2309.03883",
    what: {
      en: "Decoding by contrasting layers: subtract an early layer's next-token distribution from a late layer's to amplify factual signal at generation time.",
      zh: "对比不同层解码：用后层的下一 token 分布减去前层的分布，在生成时放大事实性信号。",
    },
    role: {
      en: "The clearest example of true mitigation — it changes what the model emits, rather than scoring what it already emitted.",
      zh: "真正意义上 mitigation 的典型例子——它改变模型的输出过程，而不是给已经输出的内容打分。",
    },
    here: {
      en: "Surveyed in Phase I, never implemented. Useful as the contrast that shows what HEAT is not: HEAT detects, scores, localizes and displays. It does not make the model wrong less often.",
      zh: "Phase I 调研过，从未实现。它的价值在于反衬 HEAT 是什么：HEAT 做的是 detect / score / localize / visualize，并不让模型少犯错。",
    },
  },
  {
    id: "halueval",
    term: "HaluEval",
    category: "method",
    stages: [],
    url: "https://arxiv.org/abs/2305.11747",
    what: {
      en: "A large benchmark of generated and human-annotated hallucinated samples across QA, dialogue and summarization.",
      zh: "一个覆盖问答、对话、摘要的大规模幻觉基准，样本由生成加人工标注得到。",
    },
    role: {
      en: "The standard comparison point, and one of the few places human labels exist.",
      zh: "标准对照点之一，也是少数真的有人工标签的地方。",
    },
    here: {
      en: "Surveyed, not used. The obvious candidate if the next step is 'evaluate against something other than an LLM judge'.",
      zh: "只被调研过，没有使用。如果下一步是“换一个不是 LLM judge 的评估参照”，它是最直接的候选。",
    },
  },
  {
    id: "hungarian",
    term: "Hungarian algorithm",
    aka: "optimal assignment, Kuhn-Munkres",
    category: "method",
    stages: [7],
    url: "https://en.wikipedia.org/wiki/Hungarian_algorithm",
    what: {
      en: "A polynomial-time algorithm for the assignment problem: find the one-to-one matching between two sets that minimises total cost.",
      zh: "求解指派问题的多项式时间算法：在两个集合之间找出总代价最小的一对一匹配。",
    },
    role: {
      en: "Without it, one generic alternative fact ('this is a kind of food') can be reused to support every main fact at once, inflating confidence.",
      zh: "没有它的话，一条很泛的 alternative fact（比如“这是一种食物”）可能同时被多条 main fact 选中，人为放大支持度。",
    },
    here: {
      en: "Runs on cost = 1 - support with the matrix padded square. But at visualize.py:614 a single main fact short-circuits to plain argmin — so on these two datasets it mostly never runs. Its value is unproven, and long-answer stress testing is the way to prove it.",
      zh: "在 cost = 1 - support 上求解，矩阵先补成方阵。但 visualize.py:614 处，当 main 只有一条 fact 时会退化成直接取最小值——在当前两个数据集上它大部分时间是空转的。它的价值尚未被验证，长答案压力测试才能验证。",
    },
    ref: "visualize.py:609",
  },
  {
    id: "ur-rag",
    term: "UR-RAG",
    category: "method",
    stages: [],
    what: {
      en: "The upstream uncertainty-aware RAG framework, built by a colleague in the same group, that produced both input datasets.",
      zh: "上游那套带不确定性判别的 RAG 框架，由同组同事开发，两个输入数据集都是它产出的。",
    },
    role: {
      en: "It decides accept / reject / undecided. HEAT is only ever shown the undecided residue.",
      zh: "它负责判定接受 / 拒绝 / 未决，而 HEAT 只看到“未决”那部分残余样本。",
    },
    here: {
      en: "Its `pred_answer` is HEAT's main answer and its `retrieved_chunks` are sitting unused in the input file. Whoever owns it also knows how the gray-zone slice was cut — worth a meeting on its own.",
      zh: "它的 pred_answer 就是 HEAT 的 main answer，它的 retrieved_chunks 还原封不动躺在输入文件里没被用。它的作者同时知道 gray-zone 是怎么切出来的——值得单独约一次会。",
    },
  },
  // ------------------------------------------------------------------ model
  {
    id: "nli-deberta-v3-large",
    term: "cross-encoder/nli-deberta-v3-large",
    category: "model",
    stages: [4, 6],
    url: "https://huggingface.co/cross-encoder/nli-deberta-v3-large",
    what: {
      en: "A DeBERTa-v3-large cross-encoder fine-tuned on SNLI + MultiNLI, emitting three logits per sentence pair.",
      zh: "在 SNLI + MultiNLI 上微调过的 DeBERTa-v3-large 交叉编码器，对每个句子对输出三个 logit。",
    },
    role: {
      en: "The only non-API model in the pipeline, and the component that actually decides what 'support' means.",
      zh: "流水线里唯一不走 API 的模型，也是真正决定“支持”这个概念含义的那个组件。",
    },
    here: {
      en: "A lazily-loaded singleton, ~1.6 GB, pinned to CPU in three separate places. Label indices are looked up from `id2label` rather than hard-coded — a detail worth keeping if the model is ever swapped.",
      zh: "惰性初始化的单例，约 1.6 GB，在三处分别硬编码为 CPU。标签下标是从 id2label 反查的而不是写死的——将来换模型时要保留这个写法。",
    },
    ref: "visualize.py:653",
  },
  {
    id: "deberta-v3",
    term: "DeBERTa-v3",
    category: "model",
    stages: [6],
    url: "https://arxiv.org/abs/2111.09543",
    what: {
      en: "An encoder architecture with disentangled attention over content and position, trained with ELECTRA-style replaced-token detection.",
      zh: "一种编码器架构：把内容和位置解耦做注意力，并用 ELECTRA 风格的替换 token 检测来预训练。",
    },
    role: {
      en: "It is why a 400M-parameter encoder still beats far larger decoders at NLI — this task rewards precise pairwise reasoning, not world knowledge.",
      zh: "这解释了为什么一个 4 亿参数的编码器在 NLI 上仍然强过大得多的解码器：这个任务奖励的是精确的成对推理，不是世界知识。",
    },
    here: {
      en: "Background rather than a knob. Useful when someone asks 'why not just ask GPT whether these two sentences agree' — the honest answers are cost, latency and determinism.",
      zh: "属于背景知识而不是可调项。当有人问“为什么不直接让 GPT 判断这两句话一致不一致”时，诚实的回答是成本、延迟和确定性。",
    },
  },
  {
    id: "gemini-2-5-flash",
    term: "gemini-2.5-flash",
    category: "model",
    stages: [1, 2, 3, 4, 5],
    url: "https://ai.google.dev/gemini-api/docs/models",
    what: {
      en: "Google's fast, cheap Gemini tier, reached here through the Vertex AI generateContent endpoint.",
      zh: "Google 的快速低价 Gemini 档位，本项目通过 Vertex AI 的 generateContent 端点调用。",
    },
    role: {
      en: "It does five different jobs: generating alternatives, judging, extracting facts, filtering relevance and side-evaluating against gold.",
      zh: "它在五个环节干活：生成 alternative、打分、抽取 fact、过滤相关性、对 gold 做旁路评估。",
    },
    here: {
      en: "One model doing all five means one model's biases are baked into the signal and the label at once. Swapping the main model is one of the cheapest robustness experiments available.",
      zh: "同一个模型干完五件事，意味着它的偏差同时进入了信号和标签。换主模型是成本最低的鲁棒性实验之一。",
    },
    ref: "visualize.py:64",
  },
  {
    id: "smollm2",
    term: "SmolLM2-1.7B-Instruct",
    category: "model",
    stages: [],
    url: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct",
    what: {
      en: "A small open instruct model that runs locally and exposes its hidden states.",
      zh: "一个可以在本地跑、并且能拿到 hidden states 的小型开源指令模型。",
    },
    role: {
      en: "Phase II's subject: K=10 samples, middle-layer last-token hidden states, EigenScore over the covariance spectrum.",
      zh: "Phase II 的实验对象：K=10 采样，取中间层最后一个 token 的 hidden state，在协方差谱上算 EigenScore。",
    },
    here: {
      en: "Not used by HEAT, but it is the model any white-box continuation would come back to. Ask for that code before assuming it needs rebuilding.",
      zh: "HEAT 没有用它，但任何白盒方向的续作都会回到这个模型上。在动手重写之前，先去要 Phase II 的代码。",
    },
  },
  // ------------------------------------------------------------------- data
  {
    id: "triviaqa",
    term: "TriviaQA",
    category: "data",
    stages: [],
    url: "https://arxiv.org/abs/1705.03551",
    what: {
      en: "A reading-comprehension dataset of trivia questions with canonical short answers and distant supervision evidence.",
      zh: "一个阅读理解数据集：竞猜类问题，答案是规范化的短答案，配有远监督证据。",
    },
    role: {
      en: "Its questions are the kind a closed-book model plausibly knows from pretraining.",
      zh: "它的问题恰好是闭卷模型很可能在预训练里就已经知道的那一类。",
    },
    here: {
      en: "Where HEAT works: ROC-AUC 0.900, positive mean support 0.838 versus negative 0.232. That separation is real, not a threshold artefact.",
      zh: "HEAT 表现好的地方：ROC-AUC 0.900，正类平均 support 0.838、负类 0.232。这个分离是真的，不是调阈值调出来的。",
    },
  },
  {
    id: "squad",
    term: "SQuAD",
    category: "data",
    stages: [],
    url: "https://arxiv.org/abs/1606.05250",
    what: {
      en: "A reading-comprehension dataset whose answers are spans inside a specific supplied passage.",
      zh: "一个阅读理解数据集，答案是给定段落中的一个片段。",
    },
    role: {
      en: "Passage-dependent by construction: without the passage, the question often cannot be answered at all.",
      zh: "它天生依赖篇章：拿掉段落，问题往往根本无法回答。",
    },
    here: {
      en: "Where HEAT struggles, and the leading hypothesis is that this is an experimental-design artefact rather than difficulty — the alternatives never see the passage the answer lives in.",
      zh: "HEAT 吃力的地方。目前最有力的假说是：这更可能是实验设计造成的，而不是数据本身难——alternative 从来没见过答案所在的那个段落。",
    },
  },
  {
    id: "record-schema",
    term: "pred_answer / gold_answer_canonical",
    category: "data",
    stages: [1, 2],
    what: {
      en: "The two answer fields on every input record: the system's answer under test, and the reference answer.",
      zh: "每条输入记录上的两个答案字段：被检验的系统答案，和参照答案。",
    },
    role: {
      en: "`pred_answer` becomes the main answer scored and coloured; `gold_answer_canonical` is what the judge scores it against.",
      zh: "pred_answer 就是被打分、被着色的 main answer；gold_answer_canonical 是 judge 用来对照的参照答案。",
    },
    here: {
      en: "Note what does not happen: the main answer is never regenerated. HEAT audits an answer produced elsewhere, under different conditions from its own samples.",
      zh: "注意这里没有发生的事：main answer 从来不会被重新生成。HEAT 审计的是别处产出的答案，而它的采样条件和那个答案并不相同。",
    },
    ref: "visualize.py:181",
  },
  {
    id: "retrieved-chunks",
    term: "retrieved_chunks",
    category: "data",
    stages: [],
    what: {
      en: "Top-10 retrieved documents per question, already present in the TriviaQA input file.",
      zh: "每题 top-10 的检索文档，已经存在于 TriviaQA 输入文件里。",
    },
    role: {
      en: "An external correctness signal — the one thing self-consistency structurally cannot provide.",
      zh: "一个外部正确性信号，而这恰恰是 self-consistency 在原理上无法提供的东西。",
    },
    here: {
      en: "The pipeline never reads it. It is why the input JSON is 36 MB, and it is the cheapest available route to an evidence-aware second axis.",
      zh: "流水线完全没读它。输入 JSON 有 36 MB 就是因为它，而它也是通往“证据轴”这个第二维度最省事的路径。",
    },
  },
  {
    id: "input-files",
    term: "incorrect_caliberated_first_200.json / squad_failed_examples_requested_runs.json",
    category: "data",
    stages: [],
    what: {
      en: "The two input files, 200 TriviaQA and 256 SQuAD records respectively.",
      zh: "两个输入文件，分别是 200 条 TriviaQA 和 256 条 SQuAD 记录。",
    },
    role: {
      en: "They are the experiment. Everything reported is a property of these 456 rows, not of the source benchmarks.",
      zh: "它们就是实验本身。所有报告出来的结论都是这 456 行的性质，不是原始 benchmark 的性质。",
    },
    here: {
      en: "The dataset path is hard-coded at visualize.py:47, so switching datasets means editing source. Also: 40 of 256 SQuAD `pred_answer` values are refusals, which closed-book sampling can never reproduce.",
      zh: "数据集路径硬编码在 visualize.py:47，换数据集必须改源码。另外：256 条 SQuAD 里有 40 条 pred_answer 是拒答，而闭卷采样永远复现不出拒答。",
    },
    ref: "visualize.py:47",
  },
  // ----------------------------------------------------------------- metric
  {
    id: "support-score",
    term: "NLI support score",
    category: "metric",
    stages: [6, 8],
    what: {
      en: "HEAT's own output: a 0-1 number saying how strongly the sampled alternatives support a given fact of the main answer.",
      zh: "HEAT 自己的输出：一个 0-1 的数，表示采样出的 alternative 在多大程度上支持 main answer 的某条 fact。",
    },
    role: {
      en: "The system output — the thing being evaluated, and the thing that becomes a colour.",
      zh: "系统输出——被评估的对象，也是最终变成颜色的那个数。",
    },
    here: {
      en: "The single most confused pairing in the whole project is this against the Prometheus score. Keep them apart in every sentence you write.",
      zh: "整个项目最容易被混淆的一对概念，就是它和 Prometheus score。写任何一句话时都要把两者分清。",
    },
    ref: "visualize.py:672",
  },
  {
    id: "prometheus-score",
    term: "Prometheus score",
    category: "metric",
    stages: [2, 10],
    what: {
      en: "The judge's 1-5 rating of the main answer against the gold answer.",
      zh: "judge 拿 main answer 对照 gold answer 打出的 1-5 分。",
    },
    role: {
      en: "The evaluation reference — the label, not an output.",
      zh: "评估参照，是标签，不是系统输出。",
    },
    here: {
      en: "Binarised at >= 4 for the positive class. Every reported accuracy answers 'does the support score agree with this judge', never 'is HEAT right'.",
      zh: "以 >= 4 二值化为正类。所有报出的准确率回答的都是“support score 和这个 judge 一致吗”，从来不是“HEAT 对不对”。",
    },
    ref: "visualize.py:1110",
  },
  {
    id: "pr-curve",
    term: "Precision-Recall curve",
    category: "metric",
    stages: [10],
    url: "https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_curve.html",
    what: {
      en: "Precision plotted against recall as the decision threshold sweeps across the score range.",
      zh: "把决策阈值在分数区间上扫过一遍，画出精确率对召回率的曲线。",
    },
    role: {
      en: "On a rare positive class it is far more informative than an ROC curve, because it ignores the large true-negative mass.",
      zh: "在正类稀少时它比 ROC 更有信息量，因为它不受大量真负例的影响。",
    },
    here: {
      en: "Used to pick the max-F1 threshold: 0.5887 on TriviaQA, 0.3289 on SQuAD. Nearly a factor of two apart — threshold transfer across datasets is an open question, not a settled one.",
      zh: "用来选 F1 最大点作为阈值：TriviaQA 0.5887，SQuAD 0.3289，相差近一倍。阈值能否跨数据集迁移是一个未回答的问题。",
    },
    ref: "visualize.py:1119",
  },
  {
    id: "roc-pr-auc",
    term: "ROC-AUC vs PR-AUC",
    category: "metric",
    stages: [10],
    url: "https://doi.org/10.1145/1143844.1143874",
    what: {
      en: "Two threshold-free summaries of a ranker. ROC-AUC is invariant to class balance; PR-AUC is not, and is read against the positive base rate.",
      zh: "两种与阈值无关的排序质量指标。ROC-AUC 不受类别比例影响；PR-AUC 受影响，必须对照正类基准率来读。",
    },
    role: {
      en: "Reporting both is how you separate 'the signal ranks well' from 'the signal is usable at an operating point'.",
      zh: "同时报这两个，才能把“信号排序能力好”和“在某个工作点上真的可用”区分开。",
    },
    here: {
      en: "Neither is in the code — both were recomputed by hand during handoff. TriviaQA: ROC 0.900 / PR 0.774 on a 0.342 base rate. SQuAD: ROC 0.666 / PR 0.273 on 0.165, a lift of only 1.66x. Adding both to the summary page is a small, high-value first commit.",
      zh: "代码里两个都没有，是接手时手工复算出来的。TriviaQA：ROC 0.900 / PR 0.774，基准率 0.342；SQuAD：ROC 0.666 / PR 0.273，基准率 0.165，提升只有 1.66 倍。把这两个指标加进汇总页，是一个工作量小、价值高的第一个 commit。",
    },
  },
  {
    id: "majority-baseline",
    term: "Majority-class baseline",
    category: "metric",
    stages: [10],
    what: {
      en: "The accuracy you get by always predicting the more common class.",
      zh: "永远预测多数类所能得到的准确率。",
    },
    role: {
      en: "The floor any accuracy claim has to clear before it means anything.",
      zh: "任何关于准确率的说法，先要越过这条地板线才有意义。",
    },
    here: {
      en: "TriviaQA 65.8% versus HEAT's 82.4% — a real +16.6 points. SQuAD 83.5% versus HEAT's 70.3% — 13.2 points below always saying 'hallucination'. The README currently claims imbalance inflates the SQuAD number; the direction is the opposite, and that sentence needs correcting.",
      zh: "TriviaQA 基线 65.8%，HEAT 82.4%，实打实 +16.6 个百分点。SQuAD 基线 83.5%，HEAT 70.3%，比“永远说是幻觉”还低 13.2 个百分点。README 现在写的是类别不平衡让 SQuAD 的数字虚高——方向恰好反了，这句话需要改。",
    },
  },
  {
    id: "spearman-pearson",
    term: "Spearman / Pearson correlation",
    category: "metric",
    stages: [10],
    url: "https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html",
    what: {
      en: "Pearson measures linear agreement between two numbers; Spearman measures agreement in rank order only.",
      zh: "Pearson 度量两组数值之间的线性关系；Spearman 只度量排序上的一致性。",
    },
    role: {
      en: "Spearman is the fairer one here: the judge's 1-5 is ordinal, and nobody claims support is linear in it.",
      zh: "在这里 Spearman 更公平：judge 的 1-5 分是序数量表，也没人主张 support 和它是线性关系。",
    },
    here: {
      en: "TriviaQA 0.719 / 0.747; SQuAD 0.401 / 0.289. The SQuAD pair inverting (Spearman above Pearson) is itself a hint that the relationship there is monotone but not linear.",
      zh: "TriviaQA 0.719 / 0.747；SQuAD 0.401 / 0.289。SQuAD 上 Spearman 反超 Pearson 本身就是个信号：那里的关系是单调的，但不是线性的。",
    },
    ref: "visualize.py:1616",
  },
  {
    id: "in-sample",
    term: "In-sample vs held-out evaluation",
    category: "metric",
    stages: [10],
    url: "https://scikit-learn.org/stable/modules/cross_validation.html",
    what: {
      en: "Choosing a hyper-parameter on the same data you then report performance on, versus holding data back for the report.",
      zh: "在同一份数据上既选超参数又报性能，对比留出一部分数据专门用于报告结果。",
    },
    role: {
      en: "Without a split, a reported accuracy is an upper bound on a fitted threshold, not an estimate of future performance.",
      zh: "没有划分的话，报出的准确率只是拟合出来的阈值的上界，不是对未来表现的估计。",
    },
    here: {
      en: "The threshold is selected on all 199 records and accuracy is reported on the same 199. Every headline number is optimistic by an unknown amount. Adding a split and re-reporting is the single most defensible first contribution — and the previous report never discussed it, so it is genuinely new.",
      zh: "阈值在全部 199 条上选，准确率又在同样这 199 条上报。所有 headline 数字都偏乐观，偏多少不知道。加上划分再重报一次，是最站得住脚的第一个贡献——而且前一份报告完全没有讨论过这一点，是真的新东西。",
    },
    ref: "visualize.py:1119",
  },
  {
    id: "class-imbalance",
    term: "Class imbalance",
    category: "metric",
    stages: [10],
    what: {
      en: "When one label dominates, so that accuracy stops distinguishing a useful model from a constant one.",
      zh: "当某一类标签占绝大多数时，准确率就无法区分“有用的模型”和“恒定输出的模型”。",
    },
    role: {
      en: "It dictates which metrics are honest — at a 16% positive rate, accuracy is close to meaningless.",
      zh: "它决定了哪些指标是诚实的——在 16% 的正类率下，准确率几乎没有意义。",
    },
    here: {
      en: "TriviaQA is 34% positive, SQuAD 16%. A defensible reporting standard: base rate, majority baseline, ROC-AUC, PR-AUC, and lift over base rate — every time, on every dataset.",
      zh: "TriviaQA 正类 34%，SQuAD 16%。一个站得住的报告标准是：基准率、多数类基线、ROC-AUC、PR-AUC、相对基准率的 lift——每个数据集每次都报。",
    },
  },
  // ------------------------------------------------------------------- tool
  {
    id: "linear-sum-assignment",
    term: "scipy.optimize.linear_sum_assignment",
    category: "tool",
    stages: [7],
    url: "https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.linear_sum_assignment.html",
    what: {
      en: "SciPy's implementation of the assignment problem, returning row and column indices of the optimal matching.",
      zh: "SciPy 对指派问题的实现，返回最优匹配的行下标和列下标。",
    },
    role: {
      en: "One call replaces the whole matching step.",
      zh: "一次调用就完成整个匹配步骤。",
    },
    here: {
      en: "Fed a square-padded cost matrix; padded cells get a very large cost, and an unmatched main fact takes penalty_cost = 1.0, i.e. support 0.",
      zh: "输入是补成方阵的代价矩阵，补位填一个极大值；没配上的 main fact 拿 penalty_cost = 1.0，即 support 为 0。",
    },
    ref: "visualize.py:623",
  },
  {
    id: "sentence-transformers",
    term: "sentence-transformers (CrossEncoder)",
    category: "tool",
    stages: [4, 6],
    url: "https://www.sbert.net/",
    what: {
      en: "The library wrapping Hugging Face encoders for pair scoring and embedding, with a CrossEncoder class for pairwise tasks.",
      zh: "封装 Hugging Face 编码器做句对打分和嵌入的库，其中 CrossEncoder 类专门用于成对任务。",
    },
    role: {
      en: "Turns 'run NLI on these two strings' into one line, including tokenisation and batching.",
      zh: "把“对这两个字符串跑 NLI”变成一行代码，分词和批处理都由它负责。",
    },
    here: {
      en: "Instantiated three times with device='cpu' hard-coded. Moving to GPU is a three-line change and the single largest available speedup, since NLI dominates wall-clock after the API calls.",
      zh: "在三处分别实例化，device='cpu' 全部写死。改到 GPU 只要动三行，是当前最大的一处提速空间——除 API 调用外，NLI 占了大部分耗时。",
    },
    ref: "visualize.py:427",
  },
  {
    id: "nltk-punkt",
    term: "NLTK punkt",
    category: "tool",
    stages: [3],
    url: "https://www.nltk.org/api/nltk.tokenize.punkt.html",
    what: {
      en: "An unsupervised sentence-boundary detector, downloaded on first run.",
      zh: "一个无监督的句子边界检测器，首次运行时自动下载。",
    },
    role: {
      en: "Sentences are the unit the heatmap colours, so this decides the shape of the visual output.",
      zh: "热力图着色的单位就是句子，所以这一步决定了最终视觉输出的形状。",
    },
    here: {
      en: "Short answers are expanded into a full sentence first, because an NLI encoder cannot do much with a bare fragment like 'meat offal'.",
      zh: "短答案会先被扩写成完整句子——因为 NLI 编码器面对 “meat offal” 这样的裸片段几乎无法判断蕴含。",
    },
    ref: "visualize.py:210",
  },
  {
    id: "vertex-api",
    term: "Vertex AI generateContent",
    category: "tool",
    stages: [1, 2, 3, 4, 5],
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference",
    what: {
      en: "The HTTP endpoint every LLM call in the pipeline goes through, authenticated by GEMINI_API_KEY or GOOGLE_API_KEY.",
      zh: "流水线里所有 LLM 调用走的 HTTP 端点，用 GEMINI_API_KEY 或 GOOGLE_API_KEY 鉴权。",
    },
    role: {
      en: "It is the cost and the wall clock: roughly 2.2M tokens and an hour per dataset.",
      zh: "它就是成本和耗时本身：每个数据集大约 220 万 token、一小时上下。",
    },
    here: {
      en: "Exponential backoff retries — but 403 is treated as retryable, so an auth failure burns 62 seconds before it tells you. Token counts come from usageMetadata and land in the summary page.",
      zh: "重试用指数退避——但 403 也被当成可重试，鉴权失败要白等 62 秒才报错。token 数从 usageMetadata 读取，最后汇总到 summary 页。",
    },
    ref: "visualize.py:139",
  },
  {
    id: "output-cache",
    term: "Implicit Prometheus cache",
    category: "tool",
    stages: [2],
    what: {
      en: "If a record's HTML already exists, the pipeline regex-scrapes the old judge score out of it instead of re-scoring.",
      zh: "如果某条记录的 HTML 已经存在，流水线会用正则从旧 HTML 里把 judge 分数抠出来复用，而不重新打分。",
    },
    role: {
      en: "It saves money on reruns.",
      zh: "重跑时省钱。",
    },
    here: {
      en: "It also means reruns are not idempotent: change the judge prompt without clearing the output directory and you silently keep the old labels. Clear the directory before trusting any rerun, and sanity-check a few existing labels before trusting the current numbers.",
      zh: "但也意味着重跑不是幂等的：改了 judge prompt 却没清空输出目录，标签会静默沿用旧版本。信任任何一次重跑之前先清目录；信任现有数字之前，先抽几条重跑核对标签。",
    },
    ref: "visualize.py:1444",
  },
  // --------------------------------------------------------------- artifact
  {
    id: "visualize-py",
    term: "visualize.py",
    category: "artifact",
    stages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    what: {
      en: "The entire pipeline: 1,623 lines, one file, no modules, no tests, no CLI configuration.",
      zh: "整条流水线：1623 行，单文件，没有模块划分、没有测试、没有命令行配置。",
    },
    role: {
      en: "The normal state of a research prototype — and the reason any change lands without regression cover.",
      zh: "研究原型的正常状态——同时也意味着任何改动都没有回归保护。",
    },
    here: {
      en: "Roughly 20% of it is HTML string concatenation. The main loop catches bare `Exception` and prints only the type name, so a batch failure is close to undiagnosable. Both are worth fixing before the first real experiment, not after.",
      zh: "其中约 20% 是 HTML 字符串拼接。主循环用裸 except Exception 兜住一切，只打印异常类型名，批跑出错几乎无法诊断。这两点值得在第一个正式实验之前就修掉，而不是之后。",
    },
    ref: "visualize.py:1589",
  },
  {
    id: "heatmap-html",
    term: "heatmap_q<id>.html",
    category: "artifact",
    stages: [9],
    what: {
      en: "The per-question report: coloured answer, per-fact scores, expandable NLI matrices, and all 10 sampled answers in full.",
      zh: "单题报告：着色后的答案、逐 fact 分数、可展开的 NLI 矩阵，以及全部 10 个采样的原文。",
    },
    role: {
      en: "The contribution made visible, and the reason failure analysis is fast: you can see which step broke without instrumenting anything.",
      zh: "把贡献变成看得见的东西，也让失败分析变快：不用加任何埋点就能看出是哪一步崩的。",
    },
    here: {
      en: "359 of them are committed. Start with heatmap_q53798.html (a wrong answer at support 1.000) and heatmap_q75887.html ('halfpenny' vs 'new halfpenny' at support 0.000) — one shows why self-consistency is not correctness, the other why NLI is brittle to surface form.",
      zh: "仓库里已经有 359 张。先看 heatmap_q53798.html（错答案拿到 support 1.000）和 heatmap_q75887.html（halfpenny 对 new halfpenny，support 0.000）——前者说明 self-consistency 不等于正确性，后者说明 NLI 对表层差异有多脆。",
    },
  },
  {
    id: "execution-summary",
    term: "execution_summary_*.html",
    category: "artifact",
    stages: [10],
    what: {
      en: "The per-dataset rollup: PR curve plot, calibrated threshold, correlations, accuracy, token spend, runtime, and a sortable table of every record.",
      zh: "每个数据集的汇总页：PR 曲线图、校准后的阈值、相关系数、准确率、token 消耗、耗时，以及一张可排序的全记录表。",
    },
    role: {
      en: "The fastest way to find failure cases: sort by support and read the two ends.",
      zh: "找失败案例最快的入口：按 support 排序，看两头。",
    },
    here: {
      en: "It is also the only place the raw (support, judge) pairs survive, which is how the handoff's recomputed AUCs were obtained at all.",
      zh: "它也是原始 (support, judge) 数对唯一留存的地方——接手报告里那些复算出来的 AUC 就是从这里还原的。",
    },
  },
];

export interface ResultRow {
  dataset: string;
  /** Records with a usable judge label. */
  n: number;
  positiveRate: number;
  majorityBaseline: number;
  agreement: number;
  threshold: number;
  spearman: number;
  pearson: number;
  rocAuc: number;
  prAuc: number;
}

/**
 * Where the project actually stands.
 *
 * The first six columns are read straight off the generated summary pages; the
 * last four were recomputed by hand during handoff from the per-record
 * (support, judge) pairs, because the pipeline never reported them. Keeping
 * both here, side by side, is the point: on SQuAD the reported agreement of
 * 70.3% sits 13 points *below* the majority baseline, and no column of the
 * original summary makes that visible.
 */
export const RESULTS: readonly ResultRow[] = [
  {
    dataset: "TriviaQA",
    n: 199,
    positiveRate: 0.342,
    majorityBaseline: 0.658,
    agreement: 0.824,
    threshold: 0.5887,
    spearman: 0.719,
    pearson: 0.747,
    rocAuc: 0.9,
    prAuc: 0.774,
  },
  {
    dataset: "SQuAD",
    n: 158,
    positiveRate: 0.165,
    majorityBaseline: 0.835,
    agreement: 0.703,
    threshold: 0.3289,
    spearman: 0.401,
    pearson: 0.289,
    rocAuc: 0.666,
    prAuc: 0.273,
  },
];

export const GAP_KINDS = ["structural", "design", "protocol"] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export interface ResearchGap {
  id: string;
  title: Bilingual;
  /** structural = cannot be fixed by sampling harder; design = an experiment can settle it; protocol = a reporting fix. */
  kind: GapKind;
  body: Bilingual;
  /** A heatmap in the repo that shows it happening, when one exists. */
  evidence?: string;
}

/**
 * The known gaps, sorted by how much of the method they call into question.
 *
 * Written as gaps rather than as a to-do list on purpose: which of these gets
 * picked up is a decision for the advisor meeting, not something a reference
 * page should quietly pre-empt.
 */
export const GAPS: readonly ResearchGap[] = [
  {
    id: "confident-repeat",
    kind: "structural",
    title: {
      en: "Confidently repeated errors",
      zh: "自信地重复同一个错误",
    },
    body: {
      en: "All ten samples give the same wrong answer, support goes to 1.000, the text turns solid green, and the reader is actively misled. Self-consistency measures how sure the model is of itself, not whether the world agrees. No amount of extra sampling closes this — it needs an external signal.",
      zh: "10 次采样都说同一个错答案，support 到 1.000，整段涂成绿色，读者被主动误导。self-consistency 度量的是模型对自己有多确定，不是外部世界是否同意。再多采样也关不上这个缺口，它需要外部信号。",
    },
    evidence: "output_heatmaps_triviaqa/heatmap_q53798.html",
  },
  {
    id: "distribution-mismatch",
    kind: "design",
    title: {
      en: "Main answer and alternatives come from different distributions",
      zh: "main answer 与 alternative 的信息条件不对称",
    },
    body: {
      en: "The main answer was written with retrieved documents in context; the nine alternatives are generated from the question alone. So the pipeline is not measuring self-consistency — it is measuring agreement between a RAG answer and a different model's closed-book memory. This plausibly explains most of the SQuAD gap, since SQuAD answers live inside a passage the alternatives never see, and 16% of its predictions are refusals that closed-book sampling can never reproduce. Regenerating the alternatives with the same retrieved context and re-running SQuAD settles it either way, in days.",
      zh: "main answer 是看过检索文档写出来的，9 个 alternative 只拿到问题。所以流水线测的并不是 self-consistency，而是“一个 RAG 答案”和“另一个模型的闭卷记忆”之间的一致性。这很可能解释了 SQuAD 上的大部分差距：SQuAD 的答案存在于 alternative 从未见过的段落里，而且其中 16% 的预测是拒答，闭卷采样永远复现不出来。让 alternative 在相同检索上下文下重新生成并重跑 SQuAD，几天之内就能给出结论，无论哪个方向都是干净的发现。",
    },
  },
  {
    id: "judge-is-not-truth",
    kind: "protocol",
    title: {
      en: "The evaluation reference is itself an LLM",
      zh: "评估参照本身也是一个 LLM",
    },
    body: {
      en: "There is not one human annotation anywhere in the project. Strictly, the results show that a black-box signal tracks an LLM judge — not that it detects factual error. Any claim stronger than that needs either human labels or a benchmark that already has them.",
      zh: "整个项目没有任何一条人工标注。严格来说，现有结果证明的是“黑盒信号能追踪一个 LLM judge”，不是“它能测出事实正确性”。任何比这更强的说法，都需要人工标签，或者一个本身自带人工标签的 benchmark。",
    },
  },
  {
    id: "in-sample-threshold",
    kind: "protocol",
    title: {
      en: "The threshold is fitted and reported on the same data",
      zh: "阈值在同一份数据上选、又在同一份数据上评",
    },
    body: {
      en: "No train/test split anywhere. Every headline accuracy is in-sample and optimistic by an unknown amount. The previous report never raised this, so fixing it and re-reporting is both the easiest first contribution and a genuinely new one.",
      zh: "全程没有 train/test 划分，所有 headline 准确率都是 in-sample 的，偏乐观多少不知道。前一份报告完全没提过这一点，所以修掉它并重报一次，既是最容易的第一个贡献，也确实是新的。",
    },
  },
  {
    id: "multiple-valid-answers",
    kind: "design",
    title: {
      en: "Several answers can all be correct",
      zh: "多个都正确但互不蕴含的答案",
    },
    body: {
      en: "Ask which policies reduce inequality and the samples scatter across progressive taxation, safety nets, education and labour protection. All correct, none entailing another. HEAT reads legitimate diversity as hallucination risk, which is a set-valued answer problem, not a scoring bug.",
      zh: "问“哪些政策能减少不平等”，采样会分散到累进税、社会保障、教育、劳工保护——全都对，但互不蕴含。HEAT 把合法的多样性读成了幻觉风险。这是 set-valued 答案的问题，不是打分实现的 bug。",
    },
    evidence: "output_heatmaps_squad/heatmap_q5727ff083acd2414000df1ae.html",
  },
  {
    id: "aliases",
    kind: "design",
    title: {
      en: "Aliases and near-misses collapse the score",
      zh: "别名与近似答案会让分数直接塌掉",
    },
    body: {
      en: "'halfpenny' against 'new halfpenny', 'Strummerville' against 'The Joe Strummer Foundation' — the judge gives 4, the support score gives 0.000. NLI is brittle to surface form, and dropping the neutral class makes it worse by giving 'did not say' the same 0.5 as 'half agrees'.",
      zh: "halfpenny 对 new halfpenny，Strummerville 对 The Joe Strummer Foundation——judge 给 4 分，support 给 0.000。NLI 对表层差异很脆，而丢掉 neutral 让情况更糟：“没提到”和“半支持”都落在 0.5 附近。",
    },
    evidence: "output_heatmaps_triviaqa/heatmap_q75887.html",
  },
  {
    id: "hungarian-untested",
    kind: "design",
    title: {
      en: "The matching step has never actually been exercised",
      zh: "匹配这一步几乎从未真正被触发",
    },
    body: {
      en: "Both datasets are short-answer QA, so most records produce a single main fact — and with one fact the code short-circuits past the Hungarian solver entirely. The step exists for long, multi-claim answers that this experiment never contained. Its value is a claim, not a finding, until something long is run through it.",
      zh: "两个数据集都是短答案问答，多数记录只产生一条 main fact，而只有一条时代码会直接跳过匈牙利求解器。这一步是为长答案、多 claim 的场景准备的，但本实验里从来没有这种样本。在真正跑过长答案之前，它的价值只是一个主张，不是结论。",
    },
  },
];
