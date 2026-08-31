import type { Bilingual } from "./research.ts";

/**
 * UR-RAG: a reading of the actual source repository.
 *
 * This is the fifth HEAT document and the first one about a different
 * codebase. The other four are all about `visualize.py` — the stack defines its
 * terms, the walkthrough reads it line by line, the report says what its
 * numbers are worth, the brief says what will bite you. All four were written
 * believing `~/heat` was the project.
 *
 * It is not. `~/heat` is one branch of `CMU-AGAI/visualization-hallucination-detection`,
 * and the trunk of that repository is a different and much larger system:
 * UR-RAG, a risk-controlled two-tier RAG controller. This page is an
 * orientation to that system, written to be read before opening the source —
 * what the pieces are, what order they run in, and which three definitions
 * everything else rests on.
 *
 * It deliberately stops at understanding. Nothing in the UR-RAG repository has
 * been changed; the observations in the last section are recorded, not fixed.
 */

export const ARCH_META = {
  title: { en: "UR-RAG, the system underneath", zh: "UR-RAG：底下真正的系统" },
  subtitle: {
    en: "An orientation to the source repository, written before changing any of it",
    zh: "在动任何一行之前，先把源码仓库读明白",
  },
  repo: "CMU-AGAI/visualization-hallucination-detection",
  branch: "samuel/eigenscore-hf",
  written: "2026-08-30",
  framing: {
    en: "Read this to know where things live and what order they run in. It is not a plan and not a review — the repository was read, not touched. Section 3 is the part to read twice: three integer labels defined in one function decide what every number in the project means.",
    zh: "这份用来搞清楚东西放在哪、按什么顺序跑。它不是计划也不是评审——仓库只被读过，没被改过。第 3 节值得读两遍：三个整数标签在一个函数里定义，而项目里每一个数字的含义都由它们决定。",
  },
} as const;

/**
 * The correction that reorganises the other four documents.
 *
 * Stated first and stated plainly, because every earlier page was written on
 * the wrong premise and a reader who has seen them needs the premise replaced
 * before anything else lands.
 */
export const ORIENTATION = {
  title: {
    en: "~/heat was never the project — it is one branch of it",
    zh: "~/heat 从来就不是这个项目——它只是其中一个分支",
  },
  body: {
    en: "`~/heat` is a clone of `samuelgiovanetti/heat`, Samuel's personal repository, which continues the history of this repo's `samuel/heatmaps_visualization` branch — the same commits up to that branch's tip, plus two more. All 368 files match by blob hash except `README.md`, and `~/heat` holds the newer one. Either way the contents are `visualize.py`, 359 generated heatmap reports, and one input JSON. Nothing else. The repository's trunk — `main`, and the `samuel/eigenscore-hf` branch that `origin/HEAD` points at — holds UR-RAG: an installable Python package (`se_crc_rag/`), a vendored semantic-entropy implementation, twenty-odd offline and online scripts, and per-dataset makefiles that wire them into one reproducible pipeline. The heatmap work sits beside that system, consuming its outputs; it is not a stage of it.",
    zh: "`~/heat` 是 `samuelgiovanetti/heat`——Samuel 个人仓库——的 clone，它延续了本仓库 `samuel/heatmaps_visualization` 分支的历史：到那个分支的 tip 为止提交完全相同，之后又多了两个。368 个文件按 blob 哈希逐一相同，只有 `README.md` 不同，而 `~/heat` 里那份是较新的。无论从哪边看，内容都只有 `visualize.py`、359 份生成的热力图报告和一个输入 JSON，再无其他。仓库的主干——`main` 以及 `origin/HEAD` 指向的 `samuel/eigenscore-hf`——装的是 UR-RAG：一个可安装的 Python 包（`se_crc_rag/`）、一份 vendored 的语义熵实现、二十多个离线/在线脚本，以及把它们串成一条可复现流水线的分数据集 makefile。热力图那套东西是挨着这个系统、消费它的输出，而不是它的一个阶段。",
  },
  soWhat: {
    en: "Anything phrased as \"the HEAT pipeline\" in the other four documents means the visualization branch specifically, not the system described here. The two share a repository and a research question; they do not share code, and neither imports the other.",
    zh: "另外四份文档里所有说“HEAT 流水线”的地方，指的都是可视化那个分支，不是这里讲的系统。两者共用一个仓库和一个研究问题；但不共用代码，谁也没 import 谁。",
  },
} as const;

export interface Branch {
  id: string;
  name: string;
  holds: Bilingual;
  note: Bilingual;
}

/**
 * Three branches, one repository.
 *
 * Kept as a table rather than prose because the whole point is that they are
 * siblings — a paragraph would imply an order between them that does not exist.
 */
export const BRANCHES: readonly Branch[] = [
  {
    id: "main",
    name: "main",
    holds: { en: "UR-RAG as published", zh: "已发布状态的 UR-RAG" },
    note: {
      en: "The package, the scripts, the makefiles, the alpha-sweep figures and the retrieval-proxy CSVs. `data/` and `experiments/` are gitignored, so a clean clone cannot run the README's examples without regenerating them first.",
      zh: "包、脚本、makefile、alpha sweep 图和检索代理 CSV 都在这。`data/` 和 `experiments/` 被 gitignore 了，所以干净 clone 出来跑不了 README 里的例子，得先自己生成。",
    },
  },
  {
    id: "eigenscore",
    name: "samuel/eigenscore-hf",
    holds: { en: "main + EigenScore, and it is what origin/HEAD points at", zh: "main + EigenScore，而且 origin/HEAD 指的就是它" },
    note: {
      en: "Seven files, +142 lines. Adds a second uncertainty signal alongside semantic entropy: sample K generations one at a time keeping hidden states, take the middle layer's last-token embedding, and score the spread of the resulting covariance spectrum. Because it is `origin/HEAD`, a plain `git clone` lands you here rather than on `main`.",
      zh: "七个文件，+142 行。在语义熵之外加了第二个不确定性信号：逐条采样 K 次并保留 hidden states，取中间层最后一个 token 的 embedding，再用协方差谱的分散程度打分。因为它是 `origin/HEAD`，直接 `git clone` 落地的是这里而不是 `main`。",
    },
  },
  {
    id: "heatmaps",
    name: "samuel/heatmaps_visualization",
    holds: { en: "visualize.py and its outputs — the same work as ~/heat", zh: "visualize.py 和它的产物——和 ~/heat 是同一摊东西" },
    note: {
      en: "No `se_crc_rag/`, no scripts, no makefiles. It shares no code with the trunk at all, which is why the other four documents can be entirely correct about it and still describe the wrong system. It stops two commits short of `~/heat`, whose extra pair rewrote the README and dropped a `.DS_Store`; read the README from `~/heat`, not from here.",
      zh: "没有 `se_crc_rag/`，没有脚本，没有 makefile，和主干一行代码都不共享。这就是为什么另外四份文档关于它可以句句正确，却仍然描述错了系统。它比 `~/heat` 少两个提交，那两个重写了 README 并删掉了一个 `.DS_Store`；要读 README 请读 `~/heat` 里那份，不是这里这份。",
    },
  },
] as const;

/** What the system is for, in the smallest number of sentences that stay true. */
export const THESIS = {
  title: { en: "It is a decision layer, not a RAG system", zh: "它是一层决策，不是一套 RAG" },
  body: {
    en: "UR-RAG wraps a RAG stack rather than replacing one. Offline it learns risk thresholds on labelled QA data; online it applies them unchanged, using only signals available at inference time — a retrieval confidence and a generation uncertainty. Given those, it decides one of three things: ship the cheap tier's answer, escalate to an expensive tier, or abstain. No gold answers are involved at inference. The guarantee comes from Conformal Risk Control: for a target risk α, the error rate among shipped answers is bounded with high probability, and the bound holds for the score definitions used during calibration — change the retriever or the entropy estimator and the thresholds must be relearned.",
    zh: "UR-RAG 是包在一套 RAG 外面的，不是拿来替代它的。离线阶段在有标注的 QA 数据上学出风险阈值；在线阶段原样套用，只用推理时拿得到的信号——一个检索置信度和一个生成不确定性。有了这两个数，它在三件事里选一件：发便宜层的答案、升级到贵的一层、或者弃答。推理时完全不碰 gold answer。保证来自 Conformal Risk Control：给定目标风险 α，已发出答案里的错误率以高概率被上界控制住；而这个界只对标定时用的那套分数定义成立——换了检索器或熵估计器，阈值就得重学。",
  },
} as const;

export const MODULE_GROUPS = ["decide", "signal", "retrieve", "drive", "dead"] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

export interface ModuleRow {
  id: string;
  path: string;
  group: ModuleGroup;
  role: Bilingual;
  note: Bilingual;
  /** Where to start reading, if you only have an hour. */
  readFirst?: boolean;
}

/**
 * The package map.
 *
 * Grouped by what a file is *for* rather than alphabetically, because the
 * hard part of this codebase is not any single file — it is knowing which four
 * of the nineteen carry the argument and which fifteen are plumbing.
 */
export const MODULES: readonly ModuleRow[] = [
  {
    id: "crc-math",
    path: "se_crc_rag/crc_math.py",
    group: "decide",
    readFirst: true,
    role: { en: "The guarantee, in eighty lines", zh: "全部保证，八十行" },
    note: {
      en: "`get_lhat` (:8) picks a threshold index on a discrete grid under a Hoeffding upper confidence bound with a union bound over the grid, δ fixed at 0.05. Three loss-matrix builders encode the three shipping rules: `r ≥ λ`, `SE ≤ λ`, `unified ≤ λ`. The older expectation-control version — `((n+1)/n)·mean` — is preserved commented out below the live one; the switch from it to a high-probability bound is a sentence the paper owes the reader.",
      zh: "`get_lhat`（:8）在离散网格上选阈值下标，用的是 Hoeffding 上置信界并对网格做 union bound，δ 固定 0.05。三个 loss matrix 构造函数编码三种发货规则：`r ≥ λ`、`SE ≤ λ`、`unified ≤ λ`。旧的期望控制版本——`((n+1)/n)·mean`——被注释保留在下面；从它换成高概率界这件事，论文欠读者一句交代。",
    },
  },
  {
    id: "offline",
    path: "se_crc_rag/offline.py",
    group: "decide",
    readFirst: true,
    role: { en: "Calibration: examples in, policy JSON out", zh: "标定：进样本，出 policy JSON" },
    note: {
      en: "Two calibrators side by side. `calibrate_thresholds` learns the decomposed pair (τ_ret then τ_se, the latter conditioned on examples that pass the retrieval gate). `calibrate_unified_thresholds` (:204) learns the single τ_unified that is the paper's main method. Both sanitise non-finite retrieval scores by flooring them and marking those rows as retrieval failures.",
      zh: "两个标定器并排。`calibrate_thresholds` 学分解式的一对（先 τ_ret 再 τ_se，后者只在通过检索门的样本上算）。`calibrate_unified_thresholds`（:204）学单一的 τ_unified，也就是论文的主方法。两者都会把非有限的检索分压到地板值，并把那些行标成检索失败。",
    },
  },
  {
    id: "data",
    path: "se_crc_rag/data.py",
    group: "decide",
    readFirst: true,
    role: { en: "The row schema and the risk formula", zh: "行的 schema 和风险公式" },
    note: {
      en: "`CheapExample`/`ExpExample` are the twenty-odd columns each collected example carries. `UnifiedPolicy.unified_risk` (:130) is the formula the whole method reduces to, and it is a `max`, not a weighted sum — any one channel running hot makes the row hot. Its normalisation constants are frozen into the policy JSON so online reproduces offline exactly.",
      zh: "`CheapExample`/`ExpExample` 是每条采集样本携带的二十来列。`UnifiedPolicy.unified_risk`（:130）是整个方法最后归结到的那个公式，而且它是 `max` 不是加权和——任一通道烧起来整行就烧起来。它的归一化常数被固化进 policy JSON，所以在线端能和离线端严格一致。",
    },
  },
  {
    id: "online",
    path: "se_crc_rag/online.py",
    group: "decide",
    role: { en: "The two-tier controller", zh: "两层控制器" },
    note: {
      en: "`CRAGUnifiedController.infer` (:671) is the live path; `CRCSEController` (:534) is the decomposed-threshold sibling kept for the ablation. Start reading at line 400 — everything above it is a commented-out earlier draft of the same two classes, 399 of the file's 769 lines.",
      zh: "`CRAGUnifiedController.infer`（:671）是实际走的路径；`CRCSEController`（:534）是分解式阈值的兄弟版，留着做 ablation。从第 400 行开始读——上面全是这两个类的旧稿注释，占了全文件 769 行里的 399 行。",
    },
  },
  {
    id: "rag-backend",
    path: "se_crc_rag/rag_backend.py",
    group: "signal",
    readFirst: true,
    role: { en: "One tier, end to end", zh: "一层，从头到尾" },
    note: {
      en: "`run` (:357) is the only place retrieval, generation and uncertainty meet: retrieve top-k, sample k generations, score each with an average-token log-probability (:311 — the docstring explains that a raw sum makes semantic entropy collapse through length bias), compute SE, optionally compute EigenScore, and return one `RAGResult` with timings and a metadata dict.",
      zh: "`run`（:357）是检索、生成、不确定性唯一交汇的地方：取 top-k，采样 k 条生成，每条用平均 token 对数概率打分（:311——docstring 解释了用原始求和会因长度偏置让语义熵塌掉），算 SE，可选地算 EigenScore，最后返回一个带 timings 和 meta 字典的 `RAGResult`。",
    },
  },
  {
    id: "se-calculator",
    path: "se_crc_rag/se_calculator.py",
    group: "signal",
    role: { en: "Semantic entropy, plus the diagnostics that gate it", zh: "语义熵，外加决定它算不算数的诊断量" },
    note: {
      en: "A thin wrapper over the vendored jlko implementation, but the interesting part is `compute_with_stats`: alongside the scalar it returns `se_valid`, `se_bad`, `se_capped`, `se_n_clusters`, `se_p_max_cluster` and `se_p_top2_gap`. Three of those become gate conditions and two become optional risk channels, so the wrapper is doing more work than the name suggests.",
      zh: "对 vendored jlko 实现的一层薄封装，但有意思的是 `compute_with_stats`：除了标量还返回 `se_valid`、`se_bad`、`se_capped`、`se_n_clusters`、`se_p_max_cluster` 和 `se_p_top2_gap`。其中三个变成门控条件、两个变成可选风险通道，所以这层封装干的事比名字看起来多。",
    },
  },
  {
    id: "eigenscore",
    path: "se_crc_rag/eigenscore.py",
    group: "signal",
    role: { en: "The branch's addition: spectral spread of hidden states", zh: "这个分支加的东西：hidden state 的谱分散度" },
    note: {
      en: "Forty-two lines. Clip the embedding at the p-th and (100−p)-th percentile, build the centred Gram matrix over K samples, add `alpha·I`, and take the mean log eigenvalue. Computed but not yet wired into any policy — it rides along in `RAGResult` and the collected rows, waiting for a calibrator that uses it.",
      zh: "四十二行。把 embedding 在第 p 和第 (100−p) 百分位裁剪，对 K 个样本建中心化 Gram 矩阵，加 `alpha·I`，取特征值对数的均值。算是算了，但还没接进任何 policy——它只是搭车躺在 `RAGResult` 和采集行里，等一个会用它的标定器。",
    },
  },
  {
    id: "verifier",
    path: "se_crc_rag/verifier.py",
    group: "signal",
    role: { en: "Is this answer supported by this document?", zh: "这个答案有没有被这篇文档支持？" },
    note: {
      en: "`EntailmentVerifier` runs DeBERTa-v2-xlarge-MNLI and reads off P(entailment), or asks an OpenAI model for YES/NO with backoff and a global rate limiter. `EvidenceSupportScorer` combines that with ROUGE-L recall as `max(entail, rouge)`, deliberately per document — its docstring is emphatic that concatenating documents first would be wrong.",
      zh: "`EntailmentVerifier` 跑 DeBERTa-v2-xlarge-MNLI 读 P(entailment)，或者让 OpenAI 模型回 YES/NO（带退避和全局限流）。`EvidenceSupportScorer` 把它和 ROUGE-L recall 按 `max(entail, rouge)` 合并，而且刻意逐文档算——docstring 特地强调先把文档拼起来是错的。",
    },
  },
  {
    id: "retriever",
    path: "se_crc_rag/retriever.py",
    group: "retrieve",
    role: { en: "The interface, and BM25 in memory", zh: "接口，以及内存版 BM25" },
    note: {
      en: "`Retriever` requires `retrieve` and supplies a default `compute_confidence` of softmax-over-top-1. `BM25Retriever` overrides it (:188) with something better suited to unbounded BM25 scores: combine strength (top-1 against the median) and margin (top-1 against top-2), squash each through a fixed-temperature sigmoid, take the geometric mean. The comment there is explicit that the constants are not tuned per dataset because CRC calibration absorbs the residual scale mismatch.",
      zh: "`Retriever` 要求实现 `retrieve`，并给了个默认的 `compute_confidence`（对 top-1 做 softmax）。`BM25Retriever` 把它覆写了（:188），换成更适合无界 BM25 分数的做法：把 strength（top-1 对中位数）和 margin（top-1 对 top-2）各自过一个固定温度的 sigmoid，再取几何平均。那里的注释明说这些常数不按数据集调，因为剩下的尺度错配由 CRC 标定吸收。",
    },
  },
  {
    id: "lucene",
    path: "se_crc_rag/lucene_bm25.py",
    group: "retrieve",
    role: { en: "The sparse baseline a reviewer will ask for", zh: "审稿人一定会问的 sparse baseline" },
    note: {
      en: "Lucene BM25 through Pyserini/Anserini at the standard k1=1.2, b=0.75. Builds its index on first use and keys the index directory on a hash of the corpus, so changing the corpus cannot silently reuse a stale index — the failure mode a hand-rolled cache usually has.",
      zh: "通过 Pyserini/Anserini 跑 Lucene BM25，用标准的 k1=1.2、b=0.75。首次使用时建索引，并把索引目录名和语料哈希绑定，所以换语料不会悄悄复用旧索引——手写缓存最常见的翻车方式。",
    },
  },
  {
    id: "dense",
    path: "se_crc_rag/dense_adapters.py",
    group: "retrieve",
    role: { en: "DPR and DRAGON+, faithful and cosine variants", zh: "DPR 和 DRAGON+，忠实版与 cosine 版" },
    note: {
      en: "Four factories. The two defaults are faithful to the original papers — DPR pooler output and DRAGON+ CLS, both unnormalised dot product. The two cosine variants L2-normalise and are labelled in the file as explicitly *not* the baselines, which is the right way to keep an ablation from quietly becoming the headline number.",
      zh: "四个工厂函数。两个默认版忠实于原论文——DPR 用 pooler output、DRAGON+ 用 CLS，都是不归一化的点积。两个 cosine 变体做 L2 归一化，并在文件里明确标注它们**不是** baseline——这是防止一个 ablation 悄悄变成头条数字的正确做法。",
    },
  },
  {
    id: "cli",
    path: "se_crc_rag/cli.py",
    group: "drive",
    role: { en: "The se-crc-rag entry point: one query, or a REPL", zh: "se-crc-rag 入口：单条查询，或者 REPL" },
    note: {
      en: "Loads two policy JSONs, builds two backends, runs the controller. The bring-your-own-RAG contract lives here: `--cheap_backend module:factory` accepts anything whose `run(query)` returns an answer, documents, a retrieval score and a semantic entropy.",
      zh: "加载两个 policy JSON，建两个 backend，跑控制器。自带 RAG 的契约就在这：`--cheap_backend module:factory` 接受任何 `run(query)` 能返回答案、文档、检索分和语义熵的东西。",
    },
  },
  {
    id: "scripts",
    path: "scripts/offline/ · scripts/online/",
    group: "drive",
    role: { en: "Twenty-two scripts; four of them matter", zh: "二十二个脚本，真正重要的是四个" },
    note: {
      en: "`collect_crc_ready_rag.py` (742 lines) generates the labelled rows; `split_crc_ready_rag.py` cuts CAL/VAL; the four `calibrate_*.py` produce the four competing policies; `eval_policy.py` scores all of them through one simulator. `posthoc/` turns saved artifacts into α-sweeps, risk-coverage curves and LaTeX tables without re-running retrieval or generation.",
      zh: "`collect_crc_ready_rag.py`（742 行）生成带标签的行；`split_crc_ready_rag.py` 切 CAL/VAL；四个 `calibrate_*.py` 产出四种互相竞争的 policy；`eval_policy.py` 用同一个模拟器给它们打分。`posthoc/` 把存好的产物转成 α sweep、risk-coverage 曲线和 LaTeX 表，不重跑检索和生成。",
    },
  },
  {
    id: "makefiles",
    path: "makefiles/Makefile.{triviaqa,hotpotqa,nqopen}",
    group: "drive",
    readFirst: true,
    role: { en: "The authoritative definition of a run", zh: "一次实验的权威定义" },
    note: {
      en: "Read `Makefile.triviaqa` before any script: every threshold, model name, sample count and retriever choice is a variable at the top, and `triviaqa_full_offline_with_data_load` names the stages in order. The root `Makefile` only dispatches by dataset. `triviaqa_eval_from_results` re-runs every evaluation against an existing results directory, which is what you want while reading rather than reproducing.",
      zh: "读任何脚本之前先读 `Makefile.triviaqa`：所有阈值、模型名、采样数、检索器选择都是顶部的变量，而 `triviaqa_full_offline_with_data_load` 按顺序列出了全部阶段。根 `Makefile` 只按数据集分发。`triviaqa_eval_from_results` 能对已有结果目录重跑全部评估——在“读懂”而不是“复现”阶段，你要的是这个。",
    },
  },
  {
    id: "semantic-uncertainty",
    path: "semantic_uncertainty/",
    group: "signal",
    role: { en: "Kuhn et al.'s semantic entropy, vendored unmodified", zh: "Kuhn 等人的语义熵，原样 vendor 进来" },
    note: {
      en: "The upstream implementation, copied in rather than depended on. `get_semantic_ids` clusters samples by bidirectional NLI entailment, `logsumexp_by_id` pools probability mass per cluster in log space, `predictive_entropy_rao` takes the entropy of the cluster distribution. Only these four symbols are used; the rest of the package — `p_ik`, `p_true`, the answer-generation harness — is unreferenced.",
      zh: "上游实现，直接拷进来而不是作为依赖。`get_semantic_ids` 用双向 NLI 蕴含把样本聚类，`logsumexp_by_id` 在对数空间按簇汇总概率质量，`predictive_entropy_rao` 取簇分布的熵。实际只用到这四个符号；包里其余部分——`p_ik`、`p_true`、答案生成脚手架——没人引用。",
    },
  },
  {
    id: "llm-backends",
    path: "se_crc_rag/llm_backends.py",
    group: "dead",
    role: { en: "Entirely commented out, imported nowhere", zh: "整个文件都被注释掉，也没人 import" },
    note: {
      en: "An earlier `HFLLM`/`OpenAILLM` split that `rag_backend.py` later absorbed as a `provider` switch. Every line is a comment and no module references it. `se_calculator copy.py` is a similar leftover — a near-identical duplicate of `se_calculator.py` differing only in imports and comment wording.",
      zh: "早期把 `HFLLM`/`OpenAILLM` 拆开的写法，后来被 `rag_backend.py` 用一个 `provider` 开关吸收掉了。全文件每一行都是注释，也没有任何模块引用它。`se_calculator copy.py` 是同类残留——和 `se_calculator.py` 几乎一模一样，只差 import 和注释措辞。",
    },
  },
] as const;

export interface Stage {
  id: string;
  step: number;
  name: Bilingual;
  script: string;
  input: string;
  output: string;
  does: Bilingual;
}

/**
 * The offline pipeline, in the order the makefile runs it.
 *
 * Input and output are given as literal paths because the single most common
 * way to get lost in this repository is not knowing which `.pkl` a script wants.
 */
export const OFFLINE_STAGES: readonly Stage[] = [
  {
    id: "jsonl",
    step: 1,
    name: { en: "Dataset to JSONL", zh: "数据集转 JSONL" },
    script: "scripts/offline/hf_to_jsonl.py",
    input: "configs/datasets/*_cal.json",
    output: "data/raw/*_cal.jsonl",
    does: {
      en: "Pulls the split named in the config off HuggingFace and normalises it to one object per line with `id`, question and answer-alias fields. The `id` key it writes is what every later stage joins on, so a custom JSONL with a different id field needs `ID_FIELD` overridden in the makefile.",
      zh: "按 config 里指定的 split 从 HuggingFace 拉数据，规整成一行一个对象，带 `id`、问题和答案别名字段。它写出的 `id` 是后面所有阶段的连接键，所以自带的 JSONL 如果 id 字段名不同，得在 makefile 里覆盖 `ID_FIELD`。",
    },
  },
  {
    id: "corpus",
    step: 2,
    name: { en: "Build the retrieval corpus", zh: "构建检索语料" },
    script: "scripts/online/build_corpus.py",
    input: "the same HF split",
    output: "data/corpus/*_evidence.txt",
    does: {
      en: "Writes one document per line — the format both BM25 retrievers and the CLI's `--reference_corpus` expect. Note this lives under `scripts/online/` while being an offline prerequisite; the directory split is about which half of the system the file serves, not when it runs.",
      zh: "一行一个文档——两个 BM25 检索器和 CLI 的 `--reference_corpus` 都要这个格式。注意它放在 `scripts/online/` 下却是离线阶段的前置；目录划分看的是文件服务于系统的哪一半，不是它什么时候跑。",
    },
  },
  {
    id: "collect",
    step: 3,
    name: { en: "Collect CRC-ready rows", zh: "采集 CRC-ready 行" },
    script: "scripts/offline/collect_crc_ready_rag.py",
    input: "jsonl + corpus",
    output: "cheap_rag_crc.pkl · exp_rag_crc.pkl",
    does: {
      en: "The expensive stage, run once per tier and parallelised across the two. Per example: retrieve, sample k generations, score each by average-token log-probability, cluster them into semantic entropy, then call `compute_labels` to produce the three integers section 3 is about. Checkpoints every `CHECKPOINT_EVERY` rows and writes atomically, so a run that dies at hour six resumes rather than restarts.",
      zh: "最贵的一步，每层跑一次、两层并行。逐样本：检索、采样 k 条生成、每条按平均 token 对数概率打分、聚类算出语义熵，然后调 `compute_labels` 产出第 3 节讲的那三个整数。每 `CHECKPOINT_EVERY` 行落一次 checkpoint 且原子写入，所以跑到第六小时挂掉是续跑而不是重来。",
    },
  },
  {
    id: "split",
    step: 4,
    name: { en: "Split calibration from validation", zh: "切分标定集与验证集" },
    script: "scripts/offline/split_crc_ready_rag.py",
    input: "both tier pickles",
    output: "*_cal.pkl · *_val.pkl",
    does: {
      en: "A 20% validation split at seed 0, applied identically to both tiers so that an id present in cheap-VAL is present in exp-VAL. The two-tier simulator joins on id and would silently under-count escalations if the splits diverged.",
      zh: "seed 0 下切 20% 验证集，两层用完全相同的切法，保证出现在 cheap-VAL 的 id 也出现在 exp-VAL。两层模拟器按 id 连接，切法一旦不一致，升级次数会被无声少算。",
    },
  },
  {
    id: "calibrate",
    step: 5,
    name: { en: "Calibrate — four policies in parallel", zh: "标定——四种 policy 并行" },
    script: "scripts/offline/calibrate_*.py",
    input: "*_cal.pkl",
    output: "*_policy_*.json · *_crag_unified.json",
    does: {
      en: "Retrieval-only, SE-only, decomposed, and unified, each written as a self-contained JSON holding its thresholds, its grids, and the normalisation constants used to build them. Those constants are why an online run can reproduce offline arithmetic exactly — nothing is recomputed from the live data.",
      zh: "只检索、只 SE、分解式、统一式，各自写成一个自包含 JSON，装着阈值、网格，以及构造它们时用的归一化常数。正是这些常数让在线端能严格复现离线的算术——没有任何东西是从线上数据重算的。",
    },
  },
  {
    id: "eval",
    step: 6,
    name: { en: "Evaluate all four through one simulator", zh: "用同一个模拟器评估这四种" },
    script: "scripts/offline/eval_policy.py",
    input: "*_val.pkl + two policy JSONs",
    output: "coverage · risk · tier rates",
    does: {
      en: "Replays the two-tier decision over saved rows, so every policy is compared under identical mechanics. Rows with `fail_ret == -1` — examples that had no gold answer and therefore cannot be scored — are dropped before anything is counted, and rows with `fail_sys == 1` are skipped inside the loop.",
      zh: "在存好的行上重放两层决策，所以每种 policy 都在完全相同的机制下比较。`fail_ret == -1` 的行——没有 gold answer、根本没法判分的样本——在计数前就被丢掉，`fail_sys == 1` 的行在循环里跳过。",
    },
  },
  {
    id: "posthoc",
    step: 7,
    name: { en: "Post-hoc: sweeps, curves, tables", zh: "事后分析：sweep、曲线、表格" },
    script: "scripts/offline/posthoc/",
    input: "saved pkls and curve JSONs",
    output: "alpha_sweep_all.csv · plots · .tex",
    does: {
      en: "Everything here operates on artifacts and re-runs no models: rescan thresholds across α, build risk-coverage curves per run, aggregate them across runs into mean±std with a risk-matched coverage table, and emit LaTeX. This is the layer to work in while writing up.",
      zh: "这里所有东西都只处理已有产物、不重跑模型：在 α 上重扫阈值、按 run 构建 risk-coverage 曲线、跨 run 聚合成 mean±std 并给出 risk-matched coverage 表、导出 LaTeX。写论文阶段就在这一层干活。",
    },
  },
] as const;

export interface LabelRow {
  id: string;
  name: string;
  rule: string;
  meaning: Bilingual;
  why: Bilingual;
}

/**
 * The three integers everything rests on.
 *
 * Given its own section because it is the one place where a reader's
 * understanding can be wrong without anything looking wrong: every coverage
 * number, every risk bound and every ablation comparison is downstream of
 * these definitions, and they are forty lines in one function.
 */
export const LABELS: readonly LabelRow[] = [
  {
    id: "fail-ret",
    name: "fail_ret",
    rule: "0 if support ≥ 0.4 or (evidence_f1 ≥ 0.30 and rougeL_recall ≥ 0.20)",
    meaning: {
      en: "Did retrieval put the answer in front of the model at all?",
      zh: "检索到底有没有把答案摆到模型面前？",
    },
    why: {
      en: "Computed against gold answer aliases, not the prediction. The cheap lexical path runs first; only if it falls short does the expensive DeBERTa entailment loop run, over documents × aliases, breaking as soon as the threshold is met. With no gold answers the label is `-1` — not a failure, an unlabelled row, and `eval_policy.py` drops it.",
      zh: "是对着 gold answer 的别名算的，不是对着预测。先走便宜的词汇路径；只有它不够时才跑贵的 DeBERTa 蕴含循环，在文档 × 别名上遍历，一旦达标就 break。没有 gold answer 时标签是 `-1`——不是失败，是未标注行，`eval_policy.py` 会丢掉它。",
    },
  },
  {
    id: "is-correct",
    name: "is_correct",
    rule: "normalised gold substring in prediction, else token-F1 ≥ 0.5",
    meaning: { en: "Was the shipped answer right?", zh: "发出去的答案对不对？" },
    why: {
      en: "Substring first because QA aliases are short and exact containment is unambiguous; token-F1 as the fallback for phrasings that carry the answer without containing the alias verbatim. This is the only label that looks at what the model actually said.",
      zh: "先用子串，因为 QA 别名很短、精确包含没有歧义；token-F1 作为兜底，处理那些表达了答案但没原样包含别名的说法。这是唯一一个真正看模型说了什么的标签。",
    },
  },
  {
    id: "fail-gen",
    name: "fail_gen",
    rule: "1 if fail_ret == 0 and is_correct == 0",
    meaning: {
      en: "Retrieval did its job and the model still got it wrong",
      zh: "检索干了它该干的，模型还是答错了",
    },
    why: {
      en: "The conditioning is the load-bearing design decision in the whole repository. Because generation failure is only counted where retrieval succeeded, the retrieval and generation risks partition the errors instead of double-counting them — which is what makes the decomposed risk numbers add up and what lets a two-channel unified risk be interpreted at all. Read this line before you read any result.",
      zh: "这个条件化是整个仓库里最吃重的设计决定。因为生成失败只在检索成功的样本上计数，检索风险和生成风险是把错误划分开而不是重复计数——分解式的风险数字能对得上、双通道统一风险能被解释，全靠这个。读任何结果之前先读这一行。",
    },
  },
] as const;

export interface Formula {
  id: string;
  label: Bilingual;
  expression: string;
  gloss: Bilingual;
}

/** The arithmetic, written out so the code reads as an implementation of it. */
export const MATH: readonly Formula[] = [
  {
    id: "bound",
    label: { en: "Threshold selection (crc_math.py:67)", zh: "阈值选取（crc_math.py:67）" },
    expression: "upper_j = min(B, mean_j + B·√(log(2m/δ) / 2n)),   δ = 0.05\nλ* = the most permissive j with upper_j ≤ α",
    gloss: {
      en: "A Hoeffding bound on each grid point's mean loss, widened by a union bound over all m points so the whole grid is covered simultaneously. \"Most permissive\" means largest j when raising the threshold ships more, smallest when it ships less — the direction is a keyword argument, and getting it backwards would invert the guarantee. If no j qualifies it falls back to the end that ships least.",
      zh: "对每个网格点的平均损失做 Hoeffding 界，再用 union bound 在全部 m 个点上放宽，使整张网格同时被覆盖。“最宽松”是指：当抬高阈值意味着发得更多时取最大的 j，反之取最小的——方向由一个关键字参数决定，弄反了保证就反了。若没有 j 合格，则退到发得最少的那一端。",
    },
  },
  {
    id: "unified",
    label: { en: "Unified risk (data.py:130)", zh: "统一风险（data.py:130）" },
    expression: "risk_ret = 1 − clip01((r − ret_lo) / (ret_hi − ret_lo))\nrisk_se  = min(1, SE / se_scale)\nunified  = max( λ_ret·risk_ret,\n                max(λ_se·risk_se, w_agree·(1−p_max), w_sup·(1−support)) )\nship if unified ≤ τ_unified",
    gloss: {
      en: "`ret_lo`/`ret_hi` are the 5th and 95th percentiles of retrieval score on the calibration split; `se_scale` is a chosen quantile of valid SE. Both are stored in the policy. The outer `max` means the row is as risky as its worst channel — the design says a confidently-wrong retrieval should not be rescued by a low entropy. `w_agree` and `w_sup` default to zero, so the two optional channels are off unless a calibration turned them on.",
      zh: "`ret_lo`/`ret_hi` 是标定集上检索分的 5% 和 95% 分位；`se_scale` 是有效 SE 的某个分位。两者都存进 policy。外层的 `max` 意味着一行的风险等于它最差的那个通道——这个设计是在说：一个自信地检索错了的样本，不该被低熵救回来。`w_agree` 和 `w_sup` 默认为零，所以那两个可选通道除非标定时打开，否则是关的。",
    },
  },
] as const;

export interface AlignmentRule {
  id: string;
  rule: Bilingual;
  why: Bilingual;
}

/**
 * The online path's three invariants.
 *
 * All three exist to keep inference arithmetically identical to calibration.
 * They are the kind of thing that looks like defensive noise until you notice
 * the same three appear verbatim in `eval_policy.py`.
 */
export const ONLINE_RULES: readonly AlignmentRule[] = [
  {
    id: "se-invalid",
    rule: {
      en: "Invalid semantic entropy forces the tier to fail",
      zh: "语义熵无效就强制该层失败",
    },
    why: {
      en: "`se_valid != 1`, or zero clusters, or a non-finite value: the tier does not get evaluated against its threshold at all, it escalates or abstains. Treating an unmeasurable row as a passing one would ship exactly the cases the system exists to catch.",
      zh: "`se_valid != 1`、簇数为零、或者值非有限：这一层根本不进阈值比较，直接升级或弃答。把测不出来的行当成通过，等于恰好把这套系统存在的理由——那些样本——发出去。",
    },
  },
  {
    id: "conservative",
    rule: {
      en: "Unusable numbers become their worst plausible value",
      zh: "不可用的数字取它最坏的可能值",
    },
    why: {
      en: "A non-finite retrieval score becomes `-1e9`; a non-finite or negative SE becomes `1e9`. The offline calibrator makes the matching choice by flooring bad retrieval scores and marking those rows as retrieval failures. Neither side ever lets a missing measurement read as a good one.",
      zh: "非有限的检索分变成 `-1e9`；非有限或为负的 SE 变成 `1e9`。离线标定器做的是配套选择：把坏的检索分压到地板值，并把那些行标成检索失败。两边都不允许“测不到”被读成“测得好”。",
    },
  },
  {
    id: "nan-not-none",
    rule: {
      en: "Missing optional features are passed as NaN, never as None",
      zh: "缺失的可选特征传 NaN，绝不传 None",
    },
    why: {
      en: "Offline uses `np.isfinite` masks, under which NaN contributes zero risk. Passing `None` would take a different branch and produce a different number from identical inputs. `online.py` says so in a comment and converts explicitly — and then warns if the policy's weight on a feature is above zero while that feature is unavailable, which is the silent training/serving skew this whole section is guarding against.",
      zh: "离线用的是 `np.isfinite` 掩码，在它下面 NaN 贡献零风险。传 `None` 会走另一条分支，同样的输入会算出不同的数。`online.py` 在注释里写明了这点并做显式转换——而且当 policy 给某个特征的权重大于零、该特征却拿不到时会发警告，这正是整节在防的那种无声的训练/服务偏移。",
    },
  },
] as const;

export interface LadderRung {
  id: string;
  name: Bilingual;
  gate: string;
  reads: Bilingual;
}

/**
 * What `eval_policy.py` is actually comparing.
 *
 * Five rows, one simulator. Presented as a ladder because that is how the
 * argument is built: each rung adds one signal, and the paper's claim is that
 * the top rung beats every rung below it at matched risk.
 */
export const LADDER: readonly LadderRung[] = [
  {
    id: "always",
    name: { en: "Always ship", zh: "永远发" },
    gate: "—",
    reads: {
      en: "Coverage 1.0 by construction. The denominator for everything else: it says what the tier's raw error rate is, so any gate that does not beat it is costing coverage for nothing.",
      zh: "构造上 coverage 就是 1.0。其他一切的分母：它给出这一层的原始错误率，所以任何打不过它的门控都是白白牺牲覆盖率。",
    },
  },
  {
    id: "ret",
    name: { en: "Retrieval-only CRC", zh: "只用检索的 CRC" },
    gate: "r ≥ τ_ret",
    reads: {
      en: "Tests whether retrieval confidence alone predicts failure. It can only see the `fail_ret` half of the error, so where it does well the errors are mostly retrieval-side.",
      zh: "检验单靠检索置信度能不能预测失败。它只看得见错误里 `fail_ret` 的那一半，所以它表现好的地方，错误主要在检索侧。",
    },
  },
  {
    id: "se",
    name: { en: "SE-only CRC", zh: "只用语义熵的 CRC" },
    gate: "SE ≤ τ_se",
    reads: {
      en: "The mirror image, and the closest thing here to prior work — this is roughly what semantic entropy alone buys you as an abstention signal.",
      zh: "镜像的那一半，也是这里最接近既有工作的一档——大致就是单用语义熵作弃答信号能拿到多少。",
    },
  },
  {
    id: "decomposed",
    name: { en: "Decomposed CRC", zh: "分解式 CRC" },
    gate: "r ≥ τ_ret and SE ≤ τ_se",
    reads: {
      en: "Both gates, calibrated separately, with τ_se fitted only on rows that clear the retrieval gate. Two α budgets spent, and the conjunction makes it strictly more conservative than either alone.",
      zh: "两道门分别标定，τ_se 只在通过检索门的行上拟合。花掉两份 α 预算，而且合取让它严格比任何单独一门都更保守。",
    },
  },
  {
    id: "unified",
    name: { en: "Unified C-RAG — the method", zh: "统一 C-RAG——主方法" },
    gate: "unified_risk ≤ τ_unified",
    reads: {
      en: "One threshold on one scalar, so one α budget instead of two, with room for the two optional generation-risk channels. If the argument works, this is the rung that holds coverage highest at matched risk.",
      zh: "一个标量上一道阈值，所以只花一份 α 预算，还留了两个可选的生成风险通道。如果论证成立，这一档就是在同等风险下覆盖率保得最高的那一档。",
    },
  },
] as const;

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Observation {
  id: string;
  severity: Severity;
  where: string;
  what: Bilingual;
  why: Bilingual;
}

/**
 * Recorded, not fixed.
 *
 * These came out of the reading pass rather than a review, and the repository
 * was deliberately left untouched. Ordered by what they would cost, which is
 * not the order they would be found in.
 */
export const OBSERVATIONS: readonly Observation[] = [
  {
    id: "token-usage",
    severity: "high",
    where: "rag_backend.py:199 vs :426",
    what: {
      en: "Token counts are always zero on the HuggingFace path",
      zh: "HuggingFace 路径上的 token 计数恒为零",
    },
    why: {
      en: "The HF branch stores `prompt_tokens`/`completion_tokens`/`total_tokens`; the OpenAI branch stores the same numbers under `llm_`-prefixed keys; `run` reads only the prefixed ones. Every cost proxy and telemetry figure is therefore zero whenever `--provider hf` is used. The TriviaQA makefile currently runs both tiers through OpenAI, which is why nothing has surfaced.",
      zh: "HF 分支存的是 `prompt_tokens`/`completion_tokens`/`total_tokens`；OpenAI 分支把同样的数存在带 `llm_` 前缀的键下；`run` 只读带前缀的那组。于是只要用 `--provider hf`，所有成本代理和 telemetry 数字都是零。目前 TriviaQA 的 makefile 两层都走 OpenAI，所以一直没暴露。",
    },
  },
  {
    id: "prompt-typo",
    severity: "high",
    where: "rag_backend.py:136, :148",
    what: {
      en: "The generation prompt contains a typo and mislabels the retrieved passages",
      zh: "生成提示词里有拼写错误，还把检索到的段落叫错了名字",
    },
    why: {
      en: "The instruction reads \"followusinging the given context\", and the retrieved documents are introduced as \"Retrieved QA examples\" rather than as evidence. This prompt is what every sample in every run is conditioned on, so it sits upstream of the semantic entropy distribution itself — worth settling before a re-run, and worth mentioning in the write-up if the existing numbers are kept.",
      zh: "指令写的是 “followusinging the given context”，而检索到的文档被介绍成 “Retrieved QA examples” 而不是证据。每一次实验的每一条采样都以这段提示词为条件，所以它位于语义熵分布本身的上游——重跑之前值得先定下来；如果保留现有数字，写论文时也值得提一句。",
    },
  },
  {
    id: "to-py",
    severity: "medium",
    where: "offline.py:34",
    what: { en: "A serialisation helper's dict branch cannot run", zh: "一个序列化辅助函数的 dict 分支跑不起来" },
    why: {
      en: "`{k: _to_py(v) for v in x.items()}` iterates tuples while referring to an undefined `k`. It survives only because the values it is called on are always arrays. A future policy field that is a dict would raise `NameError` at save time, in the last line of a run that already cost hours.",
      zh: "`{k: _to_py(v) for v in x.items()}` 在遍历元组的同时引用了未定义的 `k`。它能活着只是因为传进去的值一直是数组。将来若有某个 policy 字段是字典，就会在保存那一刻抛 `NameError`——出现在一次已经跑了几小时的实验的最后一行。",
    },
  },
  {
    id: "dead-code",
    severity: "medium",
    where: "online.py:1–399 · llm_backends.py · se_calculator copy.py",
    what: { en: "Roughly a thousand lines of the package never execute", zh: "包里大约一千行永远不会执行" },
    why: {
      en: "`online.py` opens with 399 commented lines — 52% of the file — that are an earlier draft of the two classes below them. `llm_backends.py` is commented out end to end and imported nowhere. `se_calculator copy.py` is a near-duplicate. None of it is harmful; all of it costs the next reader time, and the `online.py` case actively misleads, since the commented `infer` differs from the live one in its return shape.",
      zh: "`online.py` 开头是 399 行注释——占全文件 52%——内容是它下面那两个类的旧稿。`llm_backends.py` 从头到尾都被注释掉且无人 import。`se_calculator copy.py` 是近乎重复的副本。这些都没有害处；但都要下一个读者花时间，而且 `online.py` 那处会主动误导，因为被注释的 `infer` 和现行版本的返回结构不一样。",
    },
  },
  {
    id: "delta-eff",
    severity: "low",
    where: "crc_math.py:66",
    what: { en: "A computed variable that is never used", zh: "算出来却从没被用的变量" },
    why: {
      en: "`delta_eff = delta/m` is assigned and then ignored; the union bound is actually applied inside the `log((2m)/delta)` on the next line. The result is correct. The line just makes a careful reader stop and check whether the correction was applied twice.",
      zh: "`delta_eff = delta/m` 赋了值就被忽略；union bound 实际是写在下一行的 `log((2m)/delta)` 里。结果是对的。这行只是会让认真的读者停下来，确认这个修正有没有被用两次。",
    },
  },
  {
    id: "readme-drift",
    severity: "low",
    where: "README.md",
    what: { en: "The README describes a directory tree the repository does not have", zh: "README 描述的目录树，仓库里并不存在" },
    why: {
      en: "It names the project `multi-agent-fact-checking/` and its inference examples point into `experiments/` and `data/`, both gitignored. Every command in the quick-start fails on a clean clone until the offline pipeline has been run once. The makefiles are accurate and should be treated as the documentation.",
      zh: "它把项目叫作 `multi-agent-fact-checking/`，推理示例指向 `experiments/` 和 `data/`，而这两个目录都被 gitignore 了。在干净 clone 上，快速开始里的每条命令都会失败，直到离线流水线跑过一次。makefile 是准确的，应该把它当文档看。",
    },
  },
] as const;
