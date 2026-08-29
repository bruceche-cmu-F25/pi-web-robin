import type { Bilingual } from "./research.ts";

/**
 * A line-by-line walkthrough of ~/heat/visualize.py.
 *
 * The file is 1,623 lines, one module, no tests. Reading it top to bottom is
 * how you learn the project, and it is also the only way to find the things
 * the report does not mention — because there is no test suite to tell you
 * what the code is supposed to do, only the code.
 *
 * The blocks below tile the file completely: every line from 1 to 1,623 is in
 * exactly one block, no gaps and no overlaps, and heat-walkthrough.test.mjs
 * asserts that. That property is the point. A walkthrough with holes in it
 * lets you believe you have read the file when you have read the interesting
 * parts, and in this codebase the defect that matters most is sitting in a
 * four-line string-cleaning helper nobody would think to look at.
 *
 * `kind` marks a block worth stopping at:
 *   bug    — it does not do what the surrounding code assumes it does
 *   trap   — it works, but it will surprise you
 *   dead   — it never runs, or its result is never read
 *   cost   — it is where the money and the wall clock go
 *   design — a deliberate choice with consequences worth defending or changing
 */

export const SOURCE_FILE = "visualize.py";
export const TOTAL_LINES = 1623;

export const BLOCK_KINDS = ["bug", "trap", "dead", "cost", "design"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface WalkBlock {
  from: number;
  to: number;
  title: Bilingual;
  note: Bilingual;
  kind?: BlockKind;
  /** The enclosing function, when the block is inside one. */
  fn?: string;
}

export interface WalkSection {
  id: string;
  title: Bilingual;
  /** The pipeline step this section implements, when it maps to one. */
  step?: number;
  from: number;
  to: number;
  blocks: readonly WalkBlock[];
}

/**
 * The extraction defect, stated separately because it is not a code-reading
 * opinion — it reproduces without an API key and it is visible in every one of
 * the 359 committed reports.
 *
 * It gets its own export rather than living only as a block because it changes
 * how you read the rest of the file: once you know facts are really sentences,
 * the "most records have one main fact" observation, the never-firing Hungarian
 * step, and the size of the token bill all stop being separate puzzles.
 */
export const EXTRACTION_DEFECT = {
  title: {
    en: "Atomic-fact extraction has never run",
    zh: "原子事实抽取从未真正生效",
  },
  mechanism: {
    en: "`_clean_generated_text` (:231) strips a leading `-` from every line, with re.MULTILINE. `vertex_generate` applies it at :169 before returning, so every reply is already dash-free by the time it reaches the caller. `extract_facts_from_sentence` then cleans it a second time at :388 and parses for lines that start with `-` at :396. Nothing matches, `facts` stays empty, and the fallback at :412 keeps the whole sentence as the single \"atomic fact\".",
    zh: "`_clean_generated_text`（:231）用 re.MULTILINE 把每一行开头的 `-` 去掉。`vertex_generate` 在 :169 返回前就已经调用了它，所以任何回复到达调用方时都已经没有短横线。`extract_facts_from_sentence` 在 :388 又清洗一遍，然后在 :396 要求每行以 `-` 开头才算一条 fact——一行都匹配不上，`facts` 为空，:412 的兜底把整句话当成唯一一条“原子事实”返回。",
  },
  evidence: {
    en: "Across all 359 committed reports, 385 of 385 main-answer sentences produced exactly one fact. 353 of them were longer than the 4-word short-circuit at :367, so they did make the few-shot API call — including an 18-word sentence that the demonstrations would split into five. Not one decomposed. The transformation also reproduces offline: run the 11 lines of `_clean_generated_text` over a well-formed reply and the parser accepts zero lines.",
    zh: "在全部 359 份已生成报告里，main answer 的 385 个句子中有 385 个只产出一条 fact。其中 353 个超过了 :367 的 4 词短路阈值，也就是真的发出了少样本 API 调用——包括一个 18 词的句子，按示范应当被拆成五条。没有一个被拆开。这个变换也可以离线复现：把 `_clean_generated_text` 那 11 行套在一段格式正确的回复上，解析器接受的行数是 0。",
  },
  consequences: {
    en: "Fact-level granularity — the project's stated advance over SelfCheckGPT — is not present in any artifact in the repository. Every \"fact\" is a sentence. That is also why main answers almost always carry exactly one fact, which makes `hungarian_match` short-circuit at :614, which means the matching step has never executed either; the handoff read that symptom as a property of short-answer datasets, but the cause is upstream. `deduplicate_facts` likewise returns immediately at :423 on a one-element list. And the ~985-token few-shot prompt is paid on roughly 3,900 calls per pair of runs — on the order of 3.9M tokens whose output is thrown away, against 4.34M reported in total.",
    zh: "fact 级粒度——这个项目相对 SelfCheckGPT 声称的进步——在仓库的任何产物里都不存在，每一条 “fact” 其实都是一个句子。这也解释了为什么 main answer 几乎总是只有一条 fact：于是 `hungarian_match` 在 :614 短路，匹配那一步同样从未执行过。接手报告把这个现象归因于短答案数据集，但真正的原因在上游。`deduplicate_facts` 也因为拿到单元素列表而在 :423 直接返回。此外，约 985 token 的少样本提示在两次跑批中被调用了约 3900 次——约 390 万 token 的输出被直接丢弃，而报告的总消耗是 434 万。",
  },
  fix: {
    en: "Parse the reply before cleaning it, or give the fact parser its own cleaner that leaves list markers alone. It is a small change with a large blast radius: every number in the report was produced by the broken path, so a corrected run is a new experiment, not a patch.",
    zh: "在清洗之前先解析，或者给 fact 解析器一个不动列表符号的清洗函数。改动很小，影响面很大：报告里每一个数字都是坏掉的那条路径产生的，所以修好之后重跑是一次新实验，不是打补丁。",
  },
} as const;

export const WALKTHROUGH: readonly WalkSection[] = [
  {
    id: "preamble",
    from: 1,
    to: 47,
    title: { en: "Preamble & configuration", zh: "文件头与配置" },
    blocks: [
      {
        from: 1,
        to: 16,
        title: { en: "Shebang and the ten-step docstring", zh: "Shebang 与十步 docstring" },
        note: {
          en: "The authoritative description of the pipeline, and the numbering every section comment below refers back to. Note the title: \"Semantic Entropy Heatmap Pipeline\". Nothing in this file computes entropy — the name is a leftover from the Phase II internal-states line, and it is why the record field at :1583 is called `overall_entropy` when it holds a mean support score.",
          zh: "整条流水线最权威的描述，下面每个分节注释的编号都指回这里。注意标题写的是 “Semantic Entropy Heatmap Pipeline”——但这个文件里没有任何地方计算熵。这个名字是 Phase II 内部状态那条线的遗留，也解释了为什么 :1583 那个字段叫 `overall_entropy`，实际存的却是平均 support。",
        },
        kind: "trap",
      },
      {
        from: 17,
        to: 22,
        title: { en: "Three env vars, set before any library loads", zh: "三个环境变量，早于任何库加载" },
        note: {
          en: "`import os` is hoisted alone so these land before torch, transformers and tokenizers read them: tokenizer parallelism off, macOS fork safety on, one OMP thread. This ordering is load-bearing — tidying the imports into one block at the top would silently undo it and reintroduce the fork crashes on macOS.",
          zh: "`import os` 被单独提到最前面，好让这三个变量在 torch / transformers / tokenizers 读取之前就设好：关闭 tokenizer 并行、打开 macOS fork 安全、限制单个 OMP 线程。这个顺序是有承重作用的——把 import 整理成开头一整块会静默地破坏它，macOS 上的 fork 崩溃会回来。",
        },
        kind: "design",
      },
      {
        from: 23,
        to: 38,
        title: { en: "The rest of the imports", zh: "其余的 import" },
        note: {
          en: "The whole dependency surface in 16 lines: requests for the LLM, scipy for the assignment solver and Spearman, sentence-transformers for NLI, sklearn for the PR curve, matplotlib for the plot. Two are dead — `gc` (:29) and `accuracy_score` (:37) are imported and never referenced.",
          zh: "整个依赖面就这 16 行：requests 打 LLM，scipy 提供指派求解和 Spearman，sentence-transformers 跑 NLI，sklearn 画 PR 曲线，matplotlib 出图。其中两个是死的：`gc`（:29）和 `accuracy_score`（:37）导入后从未被引用。",
        },
        kind: "dead",
      },
      {
        from: 39,
        to: 42,
        title: { en: "Warnings silenced, NLTK downloaded at import time", zh: "静音警告，import 时下载 NLTK" },
        note: {
          en: "`filterwarnings(\"ignore\")` is global and unconditional, so deprecation notices from transformers and sklearn never reach you — worth turning off while you are changing anything. The two `nltk.download` calls run on import, not on use: importing this module touches the network.",
          zh: "`filterwarnings(\"ignore\")` 是全局且无条件的，transformers 和 sklearn 的弃用警告一律看不到——改代码期间建议先关掉它。两个 `nltk.download` 在 import 时就执行，不是用到时才执行：导入这个模块就会联网。",
        },
        kind: "trap",
      },
      {
        from: 43,
        to: 47,
        title: { en: "The four configuration constants", zh: "四个配置常量" },
        note: {
          en: "The NLI checkpoint, two token caps, and `DATASET_PATH`. There is no CLI flag and no environment override for any of them: switching from SQuAD to TriviaQA means editing :47 and re-running. Parameterising this is the first thing to change, because every experiment you have planned is a sweep over it.",
          zh: "NLI 权重、两个 token 上限，以及 `DATASET_PATH`。这四个都没有命令行参数、也没有环境变量覆盖：从 SQuAD 换到 TriviaQA 必须改 :47 再重跑。把它参数化是第一件要改的事，因为你计划的每个实验都是在它上面做扫描。",
        },
        kind: "trap",
      },
    ],
  },
  {
    id: "state",
    from: 48,
    to: 61,
    title: { en: "Module-level mutable state", zh: "模块级可变状态" },
    blocks: [
      {
        from: 48,
        to: 55,
        title: { en: "API key, endpoint, model, token counter", zh: "API key、端点、模型、token 计数器" },
        note: {
          en: "Either `GEMINI_API_KEY` or `GOOGLE_API_KEY` works; the key is interpolated straight into the query string at :88. `_prompt_tokens` is a misnomer — :151 adds `usageMetadata.totalTokenCount`, which is prompt plus completion.",
          zh: "`GEMINI_API_KEY` 或 `GOOGLE_API_KEY` 都行，key 在 :88 被直接拼进 query string。`_prompt_tokens` 名不副实：:151 累加的是 `usageMetadata.totalTokenCount`，包含 prompt 和 completion 两部分。",
        },
      },
      {
        from: 56,
        to: 61,
        title: { en: "The NLI singleton and its label indices", zh: "NLI 单例与标签下标" },
        note: {
          en: "`_nli` is loaded lazily on first use (~1.6 GB). The label indices are looked up from the checkpoint's own `id2label` rather than hard-coded, which is the right call — but note the asymmetry: `_nli_neu_idx` is declared here and assigned at :657 yet never read anywhere, because neutral is discarded from the softmax, while `_nli_con_idx` is never declared here at all and only exists because :431 assigns to it under a `global`.",
          zh: "`_nli` 首次使用时才加载（约 1.6 GB）。标签下标是从 checkpoint 自己的 `id2label` 反查的而不是写死，这个写法是对的——但注意这里的不对称：`_nli_neu_idx` 在这里声明、在 :657 赋值，却从未被读取过（neutral 在 softmax 里被丢掉了）；而 `_nli_con_idx` 在这里根本没有声明，它的存在只是因为 :431 在 `global` 下给它赋了值。",
        },
        kind: "dead",
      },
    ],
  },
  {
    id: "vertex",
    from: 62,
    to: 177,
    title: { en: "The Vertex AI client", zh: "Vertex AI 客户端" },
    blocks: [
      {
        from: 62,
        to: 78,
        title: { en: "extract_vertex_text — the fallback parser", zh: "extract_vertex_text —— 兜底解析器" },
        fn: "extract_vertex_text",
        note: {
          en: "Walks candidates → content → parts and concatenates the text, returning it with the finish reason. It has exactly one call site, :167, reached only when `res.json()` raised — and :155-165 duplicates its body inline for the normal path. Two copies of the same parser is one more than you want when you change the response shape.",
          zh: "沿 candidates → content → parts 把文本拼起来，连同 finishReason 一起返回。它只有一个调用点 :167，且只有在 `res.json()` 抛异常时才会走到——而 :155-165 为正常路径把同样的逻辑又内联写了一遍。同一个解析器有两份拷贝，改响应结构时就会漏掉一份。",
        },
        kind: "trap",
      },
      {
        from: 79,
        to: 92,
        title: { en: "Signature, key check, endpoint", zh: "签名、key 检查、端点拼装" },
        fn: "vertex_generate",
        note: {
          en: "Everything after `messages` is keyword-only. The missing-key error raises rather than degrading, which is right. `retries=5` is the default every caller uses.",
          zh: "`messages` 之后的参数全部是关键字参数。缺 key 时直接抛错而不是降级，这是对的。`retries=5` 是所有调用方都在用的默认值。",
        },
      },
      {
        from: 93,
        to: 104,
        title: { en: "OpenAI-shaped messages → Gemini shape", zh: "OpenAI 风格消息 → Gemini 结构" },
        fn: "vertex_generate",
        note: {
          en: "System messages are pulled out into `systemInstruction`; `assistant` is renamed to `model`; empty content is dropped. This is the adapter that lets the rest of the file be written in the familiar role/content style.",
          zh: "system 消息被抽出来放进 `systemInstruction`，`assistant` 改名为 `model`，空内容被丢弃。正是这个适配层，让文件其余部分可以用熟悉的 role/content 写法。",
        },
      },
      {
        from: 105,
        to: 123,
        title: { en: "Payload, and the thinking budget", zh: "请求体，以及 thinking budget" },
        fn: "vertex_generate",
        note: {
          en: "`topP` and `thinkingConfig` are only attached when passed. Every caller in this file passes `thinking_budget=0` — reasoning is switched off everywhere, including for the Prometheus judge at :271. That is a defensible cost decision and an undefended quality one; it is worth measuring whether the judge's labels change when it is allowed to think.",
          zh: "`topP` 和 `thinkingConfig` 只在显式传入时才附加。这个文件里所有调用方都传 `thinking_budget=0`——推理在所有环节都是关闭的，包括 :271 的 Prometheus judge。作为成本决策它站得住，作为质量决策它没有被论证过；judge 允许思考之后标签会不会变，值得测一次。",
        },
        kind: "design",
      },
      {
        from: 124,
        to: 137,
        title: { en: "Retry loop, network errors", zh: "重试循环：网络错误" },
        fn: "vertex_generate",
        note: {
          en: "Timeouts and connection errors back off exponentially at 2, 4, 8, 16, 32 seconds. The request timeout is 120s, so a hung endpoint can hold one call for two minutes before the first retry even starts.",
          zh: "超时和连接错误按 2、4、8、16、32 秒指数退避。请求超时是 120 秒，所以一个卡住的端点可以先占用两分钟，之后才开始第一次重试。",
        },
      },
      {
        from: 138,
        to: 143,
        title: { en: "Retrying on 403", zh: "把 403 当成可重试" },
        fn: "vertex_generate",
        note: {
          en: "`403` sits in the retry set next to `429` and 5xx. But 403 is an authentication or permission failure — it will never succeed on retry, so a bad key costs 62 seconds of sleeping before you are told. Removing 403 from :139 is a one-token fix and the single best return on effort in this file.",
          zh: "`403` 和 `429`、5xx 并列在可重试集合里。但 403 是鉴权或权限失败，重试永远不会成功——一个错的 key 会让你白等 62 秒才看到报错。把 403 从 :139 拿掉是一个字符的修改，也是这个文件里性价比最高的一处。",
        },
        kind: "bug",
      },
      {
        from: 144,
        to: 146,
        title: { en: "Any other non-2xx raises", zh: "其余非 2xx 直接抛错" },
        fn: "vertex_generate",
        note: {
          en: "The message includes `res.text`, which for an auth failure can echo request details into stdout. Worth knowing before you paste a log into a shared document.",
          zh: "错误信息里带了 `res.text`，鉴权失败时可能把请求细节打到 stdout。把日志贴进共享文档之前要知道这一点。",
        },
      },
      {
        from: 147,
        to: 153,
        title: { en: "Token accounting", zh: "token 计数" },
        fn: "vertex_generate",
        note: {
          en: "The only place `_prompt_tokens` grows. It is inside the same `try` as `res.json()`, so a malformed body loses that call's token count silently — the reported totals are a lower bound, not a measurement.",
          zh: "`_prompt_tokens` 唯一增长的地方。它和 `res.json()` 在同一个 `try` 里，body 解析失败时这次调用的 token 数就静默丢失——所以报告里的总量是下界，不是准确测量。",
        },
        kind: "trap",
      },
      {
        from: 154,
        to: 167,
        title: { en: "Reading the text out of the response", zh: "从响应里取出文本" },
        fn: "vertex_generate",
        note: {
          en: "The inline copy of `extract_vertex_text` for the normal path, with :167 falling back to the function itself. `finish_reason` keeps only the last candidate's value, which is fine at n=1 candidates and wrong the moment anyone raises it.",
          zh: "正常路径上 `extract_vertex_text` 的内联副本，:167 才回退到函数本身。`finish_reason` 只保留最后一个 candidate 的值——candidate 数为 1 时没问题，一旦有人调高就是错的。",
        },
      },
      {
        from: 168,
        to: 177,
        title: { en: "Clean, warn on empty, return", zh: "清洗、空响应告警、返回" },
        fn: "vertex_generate",
        note: {
          en: "`:169` is the line that matters most in the whole file. Every LLM reply is run through `_clean_generated_text` before any caller sees it, which is what silently disarms the fact parser at :396 — see the extraction defect. An empty reply with a non-STOP finish reason prints a warning and still returns \"\", so truncation degrades quietly. :176 raises only after all five attempts.",
          zh: "`:169` 是整个文件里最关键的一行。任何 LLM 回复在到达调用方之前都会先过一遍 `_clean_generated_text`——正是它静默地废掉了 :396 的 fact 解析器（见抽取缺陷那一节）。空回复且 finishReason 不是 STOP 时只打一条告警、照样返回空串，所以截断是静默降级的。:176 要五次尝试全失败才抛错。",
        },
        kind: "bug",
      },
    ],
  },
  {
    id: "sampling",
    step: 1,
    from: 178,
    to: 237,
    title: { en: "Step 1 — sampling, and text hygiene", zh: "第 1 步 —— 采样与文本清洗" },
    blocks: [
      {
        from: 178,
        to: 183,
        title: { en: "Section divider and signature", zh: "分节注释与函数签名" },
        fn: "generate_answers",
        note: {
          en: "`num_answers=10` is the only place the sample size lives, and the caller at :1440 passes it explicitly anyway. K is not a config constant, which it should be for any sensitivity experiment.",
          zh: "`num_answers=10` 是采样数唯一的定义处，而 :1440 的调用方又把它显式传了一遍。K 不是配置常量——任何敏感性实验都需要它是。",
        },
      },
      {
        from: 184,
        to: 193,
        title: { en: "The system prompt that suppresses wording noise", zh: "刻意压低措辞噪声的 system prompt" },
        fn: "generate_answers",
        note: {
          en: "\"use slightly different wording each time while keeping the meaning and final answer consistent\". This deliberately narrows the sampling distribution so that surviving disagreement is semantic rather than lexical. It is a real methodological choice: it makes support scores cleaner, and it also makes the samples less independent than the self-consistency assumption wants them to be.",
          zh: "“每次换一点措辞，但保持含义和最终答案一致”。这是刻意收窄采样分布，让残余的分歧尽量是语义分歧而不是用词分歧。这是个实打实的方法论选择：它让 support 更干净，同时也让采样之间比 self-consistency 假设所要求的更不独立。",
        },
        kind: "design",
      },
      {
        from: 194,
        to: 196,
        title: { en: "The main answer is not generated", zh: "main answer 不是生成出来的" },
        fn: "generate_answers",
        note: {
          en: "`main_output` is `pred_answer` straight from the dataset, cleaned. Nothing here re-generates it. So the \"main\" answer came from an upstream RAG system that had retrieved documents in context, while the alternatives below get only the question — the distribution mismatch, in three lines.",
          zh: "`main_output` 就是数据集里的 `pred_answer`，只做了清洗。这里没有任何重新生成。也就是说 main answer 来自上游那个看过检索文档的 RAG 系统，而下面的 alternative 只拿到问题——分布错配就在这三行里。",
        },
        kind: "design",
      },
      {
        from: 197,
        to: 208,
        title: { en: "Nine alternatives, closed-book", zh: "九个 alternative，闭卷生成" },
        fn: "generate_answers",
        note: {
          en: "Nine sequential calls at `temperature=0.9, top_p=0.9`, thinking off, capped at 1024 tokens. Sequential, not batched — nine round trips per record before any analysis starts. `messages` is rebuilt outside the loop and reused, so every sample sees exactly the same prompt; the only source of variation is the sampler.",
          zh: "九次串行调用，`temperature=0.9, top_p=0.9`，关闭思考，上限 1024 token。是串行不是批量——分析开始之前每条记录先走九个来回。`messages` 在循环外构造好复用，所以每次采样看到的 prompt 完全一样，唯一的变化来源是采样器本身。",
        },
        kind: "cost",
      },
      {
        from: 209,
        to: 217,
        title: { en: "expand_short_answer and the 6-word gate", zh: "expand_short_answer 与 6 词阈值" },
        fn: "expand_short_answer",
        note: {
          en: "Answers of 6 words or more pass through untouched; anything shorter becomes \"The answer is X.\" An NLI cross-encoder can do very little with a bare fragment like \"meat offal\", so this gives it a sentence to reason about. Note the gate here is 6 and the one at :367 is 4 — two different thresholds, three lines of code apart in effect.",
          zh: "6 词及以上原样返回，更短的改写成 “The answer is X.”。NLI 交叉编码器面对 “meat offal” 这种裸片段几乎无从判断，所以这里先给它一个完整句子。注意这里的阈值是 6，而 :367 的是 4——两个不同的门槛，实际效果上只隔了几行代码。",
        },
        kind: "design",
      },
      {
        from: 218,
        to: 224,
        title: { en: "q_clean is built and thrown away", zh: "q_clean 构造完就被丢掉" },
        fn: "expand_short_answer",
        note: {
          en: "Three lines normalise the question — strip the question mark, collapse newlines, drop trailing punctuation, swap quotes — and then :223 returns a string that does not mention `q_clean` at all. Someone intended \"Regarding <question>, the answer is X\" and the question half never landed. Compare :589, where the gold-side NLI does build exactly that template.",
          zh: "三行代码把问题规范化——去问号、合并换行、去尾部标点、替换引号——然后 :223 返回的字符串里根本没有 `q_clean`。原本显然想拼成 “Regarding <question>, the answer is X”，但问题那一半始终没有落地。对照 :589，gold 侧的 NLI 恰恰构造了这个模板。",
        },
        kind: "dead",
      },
      {
        from: 225,
        to: 237,
        title: { en: "_clean_generated_text — four regexes", zh: "_clean_generated_text —— 四条正则" },
        fn: "_clean_generated_text",
        note: {
          en: "Strip bold/italic/backtick markers; strip leading `>`, `-` and `#` from every line under re.MULTILINE; collapse runs of spaces and tabs; collapse indented newlines. The second one, :231, is the defect: it removes list markers from every line of every LLM reply, including the fact lists that :396 then tries to recognise by their list markers. Everything else in this helper is harmless.",
          zh: "去掉粗体/斜体/反引号标记；在 re.MULTILINE 下去掉每行开头的 `>`、`-`、`#`；合并连续空格与制表符；合并带缩进的换行。问题出在第二条 :231：它把每一条 LLM 回复的每一行的列表符号都删掉了，包括 :396 随后要靠列表符号来识别的 fact 列表。这个函数里其余三条都无害。",
        },
        kind: "bug",
      },
    ],
  },
  {
    id: "judge",
    step: 2,
    from: 238,
    to: 287,
    title: { en: "Step 2 — the Prometheus judge", zh: "第 2 步 —— Prometheus 打分" },
    blocks: [
      {
        from: 238,
        to: 242,
        title: { en: "Divider and signature", zh: "分节与签名" },
        fn: "evaluate_prometheus_score",
        note: {
          en: "Returns an int. The `0` it returns on failure is not a score — downstream, `prom_val > 0` is what separates a real label from a parse failure.",
          zh: "返回一个整数。失败时返回的 `0` 不是分数——下游是靠 `prom_val > 0` 来区分真实标签和解析失败的。",
        },
      },
      {
        from: 243,
        to: 264,
        title: { en: "The rubric", zh: "评分 rubric" },
        fn: "evaluate_prometheus_score",
        note: {
          en: "Standard Prometheus formatting: task description, response, reference answer, and a 1-5 rubric anchored on agreement with the reference. Read score 4 carefully — \"mostly correct... with only minor formatting or supplementary errors\" — because the binarisation at :1110 puts the positive/negative boundary exactly there. The whole evaluation hinges on how one sentence of a prompt is interpreted.",
          zh: "标准 Prometheus 格式：任务说明、待评回答、参考答案，以及一份以“是否与参考一致”为锚的 1-5 分 rubric。要仔细读第 4 档——“基本正确……只有轻微格式或补充性错误”——因为 :1110 的二值化正负边界正好落在这里。整个评估都系在这一句提示词怎么被理解上。",
        },
        kind: "design",
      },
      {
        from: 265,
        to: 272,
        title: { en: "One user message, temperature 0", zh: "单条 user 消息，temperature 0" },
        fn: "evaluate_prometheus_score",
        note: {
          en: "The rubric goes in as a `user` message rather than a system one, so it does not take the `systemInstruction` path at :100. Deterministic decoding, 256 output tokens, thinking off.",
          zh: "rubric 是以 `user` 消息送进去的而不是 system，所以走不到 :100 那条 `systemInstruction` 路径。确定性解码，输出上限 256 token，关闭思考。",
        },
      },
      {
        from: 273,
        to: 287,
        title: { en: "Regex out the score, 0 on failure", zh: "正则抓分数，失败返回 0" },
        fn: "evaluate_prometheus_score",
        note: {
          en: "`\\[RESULT\\]\\s*([1-5])`. Anything else — a refusal, a truncation at 256 tokens, a score of 0 or 6 — becomes `0` and the record silently drops out of every metric. Across the two runs that happened once in 200 and once in 159, which is why the reported denominators are 199 and 158 rather than 200 and 159.",
          zh: "`\\[RESULT\\]\\s*([1-5])`。其余任何情况——拒答、256 token 处被截断、打出 0 或 6 分——都会变成 `0`，这条记录随后从所有指标里静默消失。两次跑批里各发生了一次（200 里 1 条、159 里 1 条），这正是报告分母是 199 和 158 而不是 200 和 159 的原因。",
        },
        kind: "trap",
      },
    ],
  },
  {
    id: "extraction",
    step: 3,
    from: 288,
    to: 417,
    title: { en: "Step 3 — atomic fact extraction", zh: "第 3 步 —— 原子事实抽取" },
    blocks: [
      {
        from: 288,
        to: 291,
        title: { en: "Divider and the start of the few-shot prompt", zh: "分节与少样本提示开头" },
        note: {
          en: "`_FACT_FEW_SHOT` is a module-level string, so it is built once and reused — the only thing in this section that costs nothing.",
          zh: "`_FACT_FEW_SHOT` 是模块级字符串，只构造一次然后复用——这一节里唯一不花钱的东西。",
        },
      },
      {
        from: 292,
        to: 358,
        title: { en: "Eight hand-written demonstrations", zh: "八个手写示范" },
        note: {
          en: "The FActScore recipe: show the model what decomposition looks like rather than parsing syntax. The demonstrations deliberately include nested splitting — \"Collins was the CM Pilot\" / \"...for the Apollo 11 mission\" / \"...in 1969\" all coexist — so each fact carries one independently falsifiable claim. This is the intellectual core of the granularity claim, it is ~985 tokens, it is prepended to every extraction call, and because of the defect at :231 its output is discarded every single time.",
          zh: "FActScore 的做法：不用句法解析，而是直接示范“拆分长什么样”。示范里刻意包含嵌套拆分——“Collins 是指令舱驾驶员”／“……在阿波罗 11 号任务中”／“……在 1969 年”三条并存——好让每条 fact 只承载一个可独立证伪的断言。这是“细粒度”这个主张的思想核心，约 985 token，每次抽取调用都会被前置一遍，而由于 :231 的缺陷，它的输出每一次都被丢弃。",
        },
        kind: "cost",
      },
      {
        from: 359,
        to: 365,
        title: { en: "Clean and empty guard", zh: "清洗与空值保护" },
        fn: "extract_facts_from_sentence",
        note: {
          en: "A third pass of `_clean_generated_text`, this time over the input sentence rather than the reply. Harmless here.",
          zh: "第三次调用 `_clean_generated_text`，这次作用在输入句子而不是回复上。这里是无害的。",
        },
      },
      {
        from: 366,
        to: 369,
        title: { en: "The 4-word short circuit", zh: "4 词短路" },
        fn: "extract_facts_from_sentence",
        note: {
          en: "Sentences of 4 words or fewer skip the LLM entirely and are returned as one fact — correct and free. But `expand_short_answer` produces \"The answer is X.\", which is 4 words when X is one word and 5 when it is two. So \"The answer is halfpenny.\" costs nothing and \"The answer is Von Miller.\" costs a 985-token call, for the same amount of information. Aligning the two gates would cut the bill measurably.",
          zh: "4 词及以下的句子完全跳过 LLM，直接作为一条 fact 返回——正确而且免费。但 `expand_short_answer` 产出的是 “The answer is X.”：X 是一个词时正好 4 词，两个词时 5 词。于是 “The answer is halfpenny.” 一分钱不花，“The answer is Von Miller.” 却要花一次 985 token 的调用，而两者信息量相同。把这两个阈值对齐能明显降低开销。",
        },
        kind: "cost",
      },
      {
        from: 370,
        to: 387,
        title: { en: "Prompt assembly and three attempts", zh: "拼装提示与三次尝试" },
        fn: "extract_facts_from_sentence",
        note: {
          en: "Few-shot prefix plus the sentence, deterministic decoding, capped at `MAX_TOKENS_FACTS`. Up to three attempts with a one-second pause, because Vertex sometimes returns empty. Note this retry sits on top of the five retries already inside `vertex_generate` — the worst case here is fifteen HTTP attempts for one sentence.",
          zh: "少样本前缀加上句子，确定性解码，上限 `MAX_TOKENS_FACTS`。最多三次尝试，每次间隔一秒，因为 Vertex 偶尔返回空。注意这层重试是叠在 `vertex_generate` 内部那五次重试之上的——最坏情况下一个句子会发出十五次 HTTP 请求。",
        },
        kind: "trap",
      },
      {
        from: 388,
        to: 392,
        title: { en: "Cleaning a reply that is already clean", zh: "对已经清洗过的回复再清洗一次" },
        fn: "extract_facts_from_sentence",
        note: {
          en: ":388 calls `_clean_generated_text` on text that :169 already put through the same function. It is a no-op — and it is why the bug is so hard to see by reading: the author clearly believed cleaning happened here, at parse time, rather than upstream at return time. :390 additionally trims any echo of the few-shot prefix, which is sensible defensive parsing for a reply format that no longer survives to be parsed.",
          zh: ":388 对已经在 :169 过了同一个函数的文本再清洗一次，是个空操作——也正是这个缺陷难以靠阅读发现的原因：作者显然以为清洗发生在这里、在解析的时候，而不是在上游返回的时候。:390 额外裁掉回声出来的少样本前缀，这本是合理的防御式解析，只是它要解析的格式已经活不到这一步了。",
        },
        kind: "bug",
      },
      {
        from: 393,
        to: 409,
        title: { en: "The parser that never matches", zh: "永远匹配不上的解析器" },
        fn: "extract_facts_from_sentence",
        note: {
          en: "Keep lines starting with `-`, strip the marker, clean, ensure a trailing period, append. Since :231 already removed every leading `-`, the `continue` at :397 fires on every line and `facts` is always empty. :406 is dead on its own terms too: `len(fact.split()) < 1` cannot be true for a string that passed the non-empty check four lines earlier.",
          zh: "保留以 `-` 开头的行，去掉标记，清洗，补上句号，加入列表。由于 :231 已经把每一行开头的 `-` 都删掉了，:397 的 `continue` 对每一行都会触发，`facts` 恒为空。:406 本身也是死代码：一个四行前刚通过非空检查的字符串，`len(fact.split()) < 1` 不可能成立。",
        },
        kind: "bug",
      },
      {
        from: 410,
        to: 417,
        title: { en: "The fallback that every call takes", zh: "每次调用都会走的兜底分支" },
        fn: "extract_facts_from_sentence",
        note: {
          en: "Written as a safety net for a flaky API — if nothing parsed, keep the sentence rather than lose content. In practice it is the only path: 385 of 385 main-answer sentences in the committed reports came out of here. The safety net is load-bearing, and it silently converts \"atomic fact\" into \"sentence\" everywhere downstream.",
          zh: "它本是为 API 抖动准备的安全网——什么都没解析出来时，宁可保留原句也不丢内容。实际上它是唯一路径：已生成报告里 385 个 main answer 句子有 385 个从这里出来。安全网变成了承重结构，并且在下游把“原子事实”悄悄换成了“句子”。",
        },
        kind: "bug",
      },
    ],
  },
  {
    id: "dedup",
    step: 4,
    from: 418,
    to: 521,
    title: { en: "Step 4 — deduplication and relevance", zh: "第 4 步 —— 去重与相关性过滤" },
    blocks: [
      {
        from: 418,
        to: 425,
        title: { en: "Signature and the two-fact guard", zh: "签名与“少于两条直接返回”" },
        fn: "deduplicate_facts",
        note: {
          en: "`entailment_threshold=0.85` is the knob, and no caller overrides it. The `len(facts) < 2` return at :423 means that with extraction broken this function does nothing on main answers — it is handed a one-element list every time.",
          zh: "`entailment_threshold=0.85` 是这里的旋钮，没有调用方覆盖它。:423 的 `len(facts) < 2` 意味着在抽取失效的情况下，这个函数对 main answer 完全不做事——它每次拿到的都是单元素列表。",
        },
        kind: "dead",
      },
      {
        from: 426,
        to: 432,
        title: { en: "NLI singleton, init site 1 of 3", zh: "NLI 单例，三个初始化点之一" },
        fn: "deduplicate_facts",
        note: {
          en: "The same six lines appear again at :582 and :652 — three copies of the loader, all pinned to `device=\"cpu\"`. Moving to GPU means editing three places and remembering there are three. Note the defaults in `by_name.get(\"entailment\", 2)` are a guess used only if the lookup fails; the lookup is the part that is correct, and it should stay.",
          zh: "同样的六行在 :582 和 :652 又各出现一次——加载器有三份拷贝，全部写死 `device=\"cpu\"`。改成 GPU 要改三处，而且要记得一共有三处。`by_name.get(\"entailment\", 2)` 里的默认值只是查找失败时的猜测；真正正确的是那次查找，应当保留。",
        },
        kind: "trap",
      },
      {
        from: 433,
        to: 441,
        title: { en: "Longest first", zh: "长的优先保留" },
        fn: "deduplicate_facts",
        note: {
          en: "Facts are visited longest-first so the more informative wording survives a collision. Length is a proxy for informativeness and a rough one, but it is deterministic, which matters more here than being clever.",
          zh: "按长度从长到短遍历，冲突时保留信息量更大的表述。用长度当信息量的代理很粗糙，但它是确定性的——在这里这比聪明更重要。",
        },
        kind: "design",
      },
      {
        from: 442,
        to: 464,
        title: { en: "Bidirectional entailment, one pair at a time", zh: "双向蕴含，一次一对" },
        fn: "deduplicate_facts",
        note: {
          en: "Both directions are tested because \"A entails B\" is what makes B redundant, and entailment is not symmetric. The cost is that this is O(n²) `_nli.predict` calls of two pairs each, rather than one batched call — on long answers with many facts, this is where the CPU time would go once extraction is fixed.",
          zh: "两个方向都测，因为“A 蕴含 B”才让 B 冗余，而蕴含不是对称的。代价是这里变成 O(n²) 次 `_nli.predict` 调用、每次只送两对，而不是一次批量调用——抽取修好之后，长答案上的 CPU 时间就会消耗在这里。",
        },
        kind: "cost",
      },
      {
        from: 465,
        to: 472,
        title: { en: "Drop on either direction", zh: "任一方向达标即剔除" },
        fn: "deduplicate_facts",
        note: {
          en: "`max(i→j, j→i) >= 0.85` drops j. Using NLI rather than edit distance or embedding similarity is the right instinct: near-identical wording is not redundancy, logical containment is.",
          zh: "`max(i→j, j→i) >= 0.85` 就剔除 j。用 NLI 而不是编辑距离或 embedding 相似度是对的直觉：措辞相近不等于冗余，逻辑包含才是。",
        },
        kind: "design",
      },
      {
        from: 473,
        to: 494,
        title: { en: "The relevance prompt", zh: "相关性判定提示" },
        fn: "check_facts_relevance",
        note: {
          en: "One job only: strip conversational filler. \"Output 'true'... EVEN IF the fact seems factually incorrect\" is the important line — this step is explicitly forbidden from doing fact checking, because if it did, correctness would leak into the support signal and the two would stop being independent.",
          zh: "只干一件事：滤掉客套话。关键是这一句——“即使这条 fact 看起来是错的也要输出 true”。这一步被明确禁止做事实判断，否则正确性会渗进 support 信号，两者就不再独立了。",
        },
        kind: "design",
      },
      {
        from: 495,
        to: 505,
        title: { en: "All facts in one call", zh: "所有 fact 合成一次调用" },
        fn: "check_facts_relevance",
        note: {
          en: "Numbered list in, JSON array of booleans out — one call regardless of fact count, unlike the per-fact loop at :544. The 256-token output cap is the constraint: a long enough fact list truncates the JSON and lands in the fallback below.",
          zh: "输入是编号列表，输出是布尔数组——不管有多少条 fact 都只调用一次，和 :544 那种逐条循环形成对比。约束是 256 token 的输出上限：fact 列表足够长时 JSON 会被截断，落进下面的兜底。",
        },
      },
      {
        from: 506,
        to: 521,
        title: { en: "Parse, and the silent all-true fallback", zh: "解析，以及静默的“全部相关”兜底" },
        fn: "check_facts_relevance",
        note: {
          en: "Strips a ```json fence if present, requires the array length to match exactly, and on any failure returns all-True at :518 with no log line. Conservative in the right direction — you would rather keep a filler fact than drop a real one — but invisible: there is no way to tell from the output how often this fired. Add a counter before you trust the relevance column.",
          zh: "如果有 ```json 围栏就剥掉，要求数组长度严格匹配，任何失败都在 :518 返回全 True，且不打日志。方向上是保守的——宁可留下一条废话也不误删一条真 fact——但它完全不可见：从输出里看不出这个分支触发了多少次。相信 relevance 那一列之前，先加个计数器。",
        },
        kind: "trap",
      },
    ],
  },
  {
    id: "gold",
    step: 5,
    from: 522,
    to: 605,
    title: { en: "Step 5 — side evaluation against gold", zh: "第 5 步 —— 对 gold 的旁路评估" },
    blocks: [
      {
        from: 522,
        to: 542,
        title: { en: "The LLM fact-checker prompt", zh: "LLM 事实核对提示" },
        fn: "evaluate_facts_with_llm",
        note: {
          en: "A 0.0-1.0 rubric comparing one fact to the gold answer. The comment at :524 is explicit that this is \"for information as it performs poorer than Prometheus Score\" — it feeds the HTML and nothing else. Knowing which numbers are load-bearing and which are decoration is most of what makes this file readable.",
          zh: "把单条 fact 和 gold 比，给 0.0-1.0 的分。:524 的注释写得很清楚：“仅供参考，因为它表现不如 Prometheus Score”——它只喂给 HTML，别的什么都不喂。分清哪些数字承重、哪些只是装饰，是读懂这个文件的大半。",
        },
      },
      {
        from: 543,
        to: 573,
        title: { en: "One API call per fact", zh: "每条 fact 一次 API 调用" },
        fn: "evaluate_facts_with_llm",
        note: {
          en: "A sequential loop, one round trip per fact, printing each verdict as it goes. This is the most expensive display-only feature in the pipeline. A parse failure defaults to 0.5 at :566 — silently, and 0.5 is also the value the HTML renders as \"Alignment: Neutral\", so a failed parse is indistinguishable from a genuine neutral verdict.",
          zh: "串行循环，每条 fact 一个来回，边跑边打印判定。这是整条流水线里最贵的一个纯展示功能。解析失败在 :566 静默默认为 0.5，而 HTML 恰好把 0.5 渲染成 “Alignment: Neutral”——于是解析失败和真正的中立判定无法区分。",
        },
        kind: "cost",
      },
      {
        from: 574,
        to: 605,
        title: { en: "The NLI gold check, with a different template", zh: "NLI 版 gold 检查，用了另一套模板" },
        fn: "evaluate_nli_gold_facts",
        note: {
          en: "Also display-only. Worth noticing the premise format: `Regarding the question '...', the answer is ...` — which is not the `Question: ... Answer: ...` template used at :663 for the support matrix, nor the one at :447 for deduplication. Three NLI call sites, three different ways of framing the same pair. Since a cross-encoder is sensitive to surface form, that inconsistency is a free source of variance, and standardising it is a cheap experiment.",
          zh: "同样只用于展示。注意它的 premise 格式：`Regarding the question '...', the answer is ...`——既不是 :663 支持矩阵用的 `Question: ... Answer: ...`，也不是 :447 去重用的那套。三个 NLI 调用点，三种不同的句对包装方式。交叉编码器对表层形式敏感，这种不一致是白送的方差来源，统一它是一个很便宜的实验。",
        },
        kind: "trap",
      },
    ],
  },
  {
    id: "matching",
    step: 6,
    from: 606,
    to: 741,
    title: { en: "Steps 6-8 — support matrix, matching, aggregation", zh: "第 6-8 步 —— 支持矩阵、匹配、聚合" },
    blocks: [
      {
        from: 606,
        to: 613,
        title: { en: "hungarian_match signature", zh: "hungarian_match 签名" },
        fn: "hungarian_match",
        note: {
          en: "Takes a cost matrix, returns `{main_fact_index: cost}`. `penalty_cost=1.0` is the cost assigned to a main fact that finds no partner, i.e. support 0.",
          zh: "输入代价矩阵，返回 `{main fact 下标: 代价}`。`penalty_cost=1.0` 是配不上任何对象的 main fact 所得的代价，也就是 support 为 0。",
        },
      },
      {
        from: 614,
        to: 620,
        title: { en: "The short circuit that disables the solver", zh: "让求解器不启动的短路分支" },
        fn: "hungarian_match",
        note: {
          en: "With one main fact, this returns the single cost or the row minimum and never calls `linear_sum_assignment`. Because extraction is broken, main answers essentially always have one fact, so the Hungarian step — one of the project's two claimed advances over SelfCheckGPT — has never executed on real data. The handoff spotted the symptom and attributed it to short-answer datasets; the actual cause is the string cleaner at :231.",
          zh: "只有一条 main fact 时，直接返回那个代价或该行最小值，`linear_sum_assignment` 根本不会被调用。由于抽取失效，main answer 基本永远只有一条 fact，所以匈牙利这一步——项目相对 SelfCheckGPT 声称的两项进步之一——在真实数据上从未执行过。接手报告发现了这个现象并归因于短答案数据集，真正的原因是 :231 那个字符串清洗函数。",
        },
        kind: "bug",
      },
      {
        from: 621,
        to: 632,
        title: { en: "Padding to a square matrix", zh: "补成方阵" },
        fn: "hungarian_match",
        note: {
          en: "`linear_sum_assignment` needs a square matrix, so the cost matrix is embedded in one filled with `max(1e6, penalty_cost * 10)`. The pad value has to dominate any real cost so the solver never prefers a phantom pairing; 1e6 against costs in [0,1] does that with room to spare.",
          zh: "`linear_sum_assignment` 需要方阵，于是把代价矩阵嵌进一个填满 `max(1e6, penalty_cost * 10)` 的大矩阵里。补位的值必须压过任何真实代价，求解器才不会偏好虚构的配对；代价在 [0,1] 区间时，1e6 绰绰有余。",
        },
      },
      {
        from: 633,
        to: 646,
        title: { en: "Reading the assignment back", zh: "把匹配结果读回来" },
        fn: "hungarian_match",
        note: {
          en: "Every main fact starts at `penalty_cost` and is overwritten only if it matched a real column. So a main fact matched into padding keeps support 0 — the intended behaviour, stated by initialising rather than by a branch.",
          zh: "每条 main fact 先初始化为 `penalty_cost`，只有配到真实列时才被覆盖。所以配到补位的 main fact 保持 support 为 0——这正是想要的行为，用初始化而不是分支表达出来。",
        },
      },
      {
        from: 647,
        to: 666,
        title: { en: "Building the pairs, and the direction that matters", zh: "构造句对，以及关键的方向" },
        fn: "nli_support_matrix",
        note: {
          en: "Premise is the alternative's fact, hypothesis is the main fact: the question asked is \"does this alternative support the answer under test\", not the reverse. Swapping them would measure something else entirely. Row index is the main fact, column is the alternative fact — worth holding onto, because the parameter is named `alt_sentences` while it receives facts.",
          zh: "前提是 alternative 的 fact，假设是 main 的 fact：问的是“这个 alternative 是否支持待检答案”，不是反过来。调换就变成了另一个问题。行下标是 main fact，列是 alternative fact——记住这一点，因为参数名叫 `alt_sentences`，收到的其实是 fact。",
        },
        kind: "design",
      },
      {
        from: 667,
        to: 684,
        title: { en: "Softmax over two of three logits", zh: "在三个 logit 里只对两个做 softmax" },
        fn: "nli_support_matrix",
        note: {
          en: "`support = exp(z_ent) / (exp(z_ent) + exp(z_con))`. Neutral is discarded, collapsing three classes onto one support-versus-refute axis so the number can become a colour. The cost: \"did not mention it\" and \"half agrees\" both land near 0.5 and cannot be told apart — which is exactly what happens on aliases like \"halfpenny\" versus \"new halfpenny\". Batched at 16, unlike the pairwise dedup loop above.",
          zh: "`support = exp(z_ent) / (exp(z_ent) + exp(z_con))`。丢掉 neutral，把三分类压成“支持 vs 反驳”一条轴，这样这个数才能变成颜色。代价是：“没提到”和“半支持”都落在 0.5 附近、无法区分——“halfpenny” 对 “new halfpenny” 这类别名失败正是这么来的。这里用了 batch_size=16，和上面逐对调用的去重循环不同。",
        },
        kind: "design",
      },
      {
        from: 685,
        to: 700,
        title: { en: "Per-alternative loop and the None convention", zh: "逐 alternative 循环与 None 约定" },
        fn: "evaluate_consistency_hungarian",
        note: {
          en: "`support_scores[fact][alt]` is initialised to `None` so that \"this alternative produced no facts\" stays distinguishable from \"this alternative gave zero support\". That distinction is preserved carefully here and then quietly dropped at :734 — see below.",
          zh: "`support_scores[fact][alt]` 初始化为 `None`，好让“这个 alternative 没产出 fact”和“这个 alternative 给了 0 支持”保持可区分。这个区分在这里被小心保留，却在 :734 被悄悄丢掉——见下。",
        },
      },
      {
        from: 701,
        to: 715,
        title: { en: "The single-alt-fact branch reintroduces the inflation", zh: "单 alt fact 分支把被防住的膨胀又放了回来" },
        fn: "evaluate_consistency_hungarian",
        note: {
          en: "When an alternative yields exactly one fact, this branch skips the solver and matches every main fact to that one fact. That is precisely the failure the Hungarian algorithm was introduced to prevent — one generic statement propping up several main facts at once — reintroduced as a special case. It is currently harmless only because main answers have one fact too; fix extraction without fixing this and confidence will inflate.",
          zh: "当某个 alternative 只产出一条 fact 时，这个分支跳过求解器，把每一条 main fact 都匹配到那唯一一条上。这正是引入匈牙利算法要防止的情形——一句很泛的话同时撑起多条 main fact——在这里以特例的形式回来了。目前之所以无害，只是因为 main answer 也只有一条 fact；只修抽取而不修这里，支持度就会被抬高。",
        },
        kind: "bug",
      },
      {
        from: 716,
        to: 733,
        title: { en: "The solver runs twice", zh: "求解器跑了两遍" },
        fn: "evaluate_consistency_hungarian",
        note: {
          en: ":716 calls `hungarian_match`, which solves the padded problem internally; then :718-:722 rebuilds the same padded matrix and calls `linear_sum_assignment` again, purely to recover which column each row matched for the HTML. Double the solver cost, and when the assignment has ties the two solves are not guaranteed to agree — so the cell the report outlines as \"matched\" can in principle differ from the cost that produced the score. Return the pairing from `hungarian_match` and the whole class of discrepancy disappears.",
          zh: ":716 调用 `hungarian_match`，它内部已经解过一次；:718-:722 又重建同样的补零矩阵、再调一次 `linear_sum_assignment`，纯粹是为了给 HTML 找出每行匹配到哪一列。求解成本翻倍，而且当存在并列最优时两次求解不保证一致——于是报告里用粗边框标出的“匹配格”原则上可能和真正产生分数的那个代价不是同一个。让 `hungarian_match` 把配对一起返回，这一类不一致就整体消失了。",
        },
        kind: "bug",
      },
      {
        from: 734,
        to: 741,
        title: { en: "The mean that hides how many voted", zh: "掩盖了投票人数的均值" },
        fn: "evaluate_consistency_hungarian",
        note: {
          en: "Each fact's support is the mean over the alternatives that produced facts, with `None` entries excluded. A fact supported by nine alternatives and one supported by two both come out as a bare number, with nothing recording the difference — and the `None` bookkeeping from :693 is spent here without ever reaching the summary. Carrying the count alongside the mean would make the confidence in the score visible.",
          zh: "每条 fact 的 support 是在“产出了 fact 的那些 alternative”上取均值，`None` 被排除。被九个 alternative 支持的 fact 和被两个支持的 fact，出来都是一个光秃秃的数字，没有任何地方记录这个差别——:693 那套 `None` 记账到这里就用完了，从未进入汇总。把参与数和均值一起带出去，分数的可信度才看得见。",
        },
        kind: "trap",
      },
    ],
  },
  {
    id: "heatmap",
    step: 9,
    from: 742,
    to: 1072,
    title: { en: "Step 9 — the heatmap HTML", zh: "第 9 步 —— 热力图 HTML" },
    blocks: [
      {
        from: 742,
        to: 762,
        title: { en: "Sixteen keyword arguments", zh: "十六个关键字参数" },
        fn: "write_heatmap_html",
        note: {
          en: "Every intermediate the pipeline produced, passed in as a separate parallel list indexed by sentence. The parallel-array design is what makes the call at :1550 nineteen lines long, and it is the main reason this function cannot be tested piecewise: there is no object to construct, only sixteen lists that must line up.",
          zh: "流水线产出的每一个中间量都作为一个独立的、按句子对齐的平行列表传进来。这种平行数组设计正是 :1550 那个调用长达十九行的原因，也是这个函数无法分块测试的主因：没有一个对象可以构造，只有十六个必须彼此对齐的列表。",
        },
        kind: "design",
      },
      {
        from: 763,
        to: 781,
        title: { en: "Two text formatters", zh: "两个文本格式化助手" },
        fn: "write_heatmap_html",
        note: {
          en: "`_format_text` greys out the \"The answer is\" scaffolding that `expand_short_answer` added and bolds the real answer, so the reader sees the content rather than the wrapper; `_strip_text` removes it entirely for the matrix headers. Both escape HTML — the only injection defence in the file, and it is applied consistently.",
          zh: "`_format_text` 把 `expand_short_answer` 加上的 “The answer is” 脚手架灰掉、把真正的答案加粗，让读者看到内容而不是包装；`_strip_text` 在矩阵表头里则把它整个去掉。两者都做 HTML 转义——这是文件里唯一的注入防护，而且用得一致。",
        },
      },
      {
        from: 782,
        to: 804,
        title: { en: "The bypass page", zh: "跳过分支的页面" },
        fn: "write_heatmap_html",
        note: {
          en: "A short standalone page for records the pipeline refused, currently only empty questions. It writes and returns early, so nothing below runs. Note it still writes a Prometheus Score line in the same format the cache regex at :1447 looks for — which is correct, and easy to break if this markup is ever reformatted.",
          zh: "为被流水线跳过的记录生成的独立短页面，目前只有空问题会走到这里。它写完就提前 return，下面的代码都不执行。注意它仍然按 :1447 缓存正则要找的那个格式写出 Prometheus Score 一行——这是对的，而且一旦有人重排这段标记就会被打破。",
        },
        kind: "trap",
      },
      {
        from: 805,
        to: 844,
        title: { en: "Document head and CSS", zh: "文档头与 CSS" },
        fn: "write_heatmap_html",
        note: {
          en: "About 30 lines of inline stylesheet in an f-string, which is why every literal brace in this function is doubled. Self-contained by design: the report opens from the filesystem with no assets and no network, which is what makes the 359 committed reports still readable today.",
          zh: "大约 30 行内联样式表写在 f-string 里，所以这个函数里每一个字面花括号都得写两遍。自包含是刻意的：报告可以直接从文件系统打开，不依赖任何资源和网络——这也是那 359 份报告今天仍然能读的原因。",
        },
        kind: "design",
      },
      {
        from: 845,
        to: 862,
        title: { en: "The three lines that are the contribution", zh: "承载全部贡献的三行" },
        fn: "write_heatmap_html",
        note: {
          en: "`hue = support * 120` maps 0 to red and 1 to green; `saturation = 80 * relevant_ratio` fades a sentence whose facts were mostly filtered out; lightness rises to match. The second dimension is the part people miss — a sentence full of irrelevant content goes grey rather than alarming red. An unscored sentence renders white with a \"Not scored\" tooltip, so absence of evidence never reads as evidence.",
          zh: "`hue = support * 120` 把 0 映射成红、1 映射成绿；`saturation = 80 * relevant_ratio` 让 fact 大多被过滤掉的句子褪色；亮度相应提高。容易被忽略的是第二个维度——一句全是无关内容的话会变灰而不是刺眼的红。没有分数的句子渲染成白色并带 “Not scored” 提示，所以“没有证据”不会被读成“证据表明没问题”。",
        },
        kind: "design",
      },
      {
        from: 863,
        to: 878,
        title: { en: "The colour legend", zh: "颜色图例" },
        fn: "write_heatmap_html",
        note: {
          en: "Spells out green/yellow/red and, importantly, what faded colour means. A heatmap without a legend is a mood ring; this one tells the reader what the saturation axis encodes.",
          zh: "把绿/黄/红讲清楚，更重要的是讲清楚“褪色”意味着什么。没有图例的热力图只是情绪灯，这个图例告诉读者饱和度这一维编码的是什么。",
        },
      },
      {
        from: 879,
        to: 907,
        title: { en: "Sentence summary table", zh: "句子级汇总表" },
        fn: "write_heatmap_html",
        note: {
          en: "One row per sentence, one column per alternative, every cell coloured on the same hue scale. :880 computes the column width as `max(5, (62 - 14) // num_alts)` — hard-coded percentages that happen to work at nine alternatives and will not at three or twenty.",
          zh: "每句一行，每个 alternative 一列，所有单元格用同一套色标着色。:880 用 `max(5, (62 - 14) // num_alts)` 算列宽——写死的百分比，在九个 alternative 时刚好合适，换成三个或二十个就不行了。",
        },
        kind: "trap",
      },
      {
        from: 908,
        to: 977,
        title: { en: "The expandable NLI matrices", zh: "可展开的 NLI 矩阵" },
        fn: "write_heatmap_html",
        note: {
          en: "For every sentence and every alternative, the full main-facts × alt-facts matrix with the matched cell outlined in a 3px border. This is the feature that makes the pipeline auditable: a failure case can be opened and the exact step that broke it read off the page, with no instrumentation. Keep it through any refactor — it is worth more than the scores.",
          zh: "对每个句子、每个 alternative，完整展示 main facts × alt facts 矩阵，匹配到的格子用 3px 粗边框标出。正是这个功能让流水线可审计：打开一个失败案例，不用加任何埋点就能从页面上读出是哪一步崩的。任何重构都要保留它——它比分数本身更有价值。",
        },
        kind: "design",
      },
      {
        from: 978,
        to: 1039,
        title: { en: "Atomic facts and their scores", zh: "原子事实及其分数" },
        fn: "write_heatmap_html",
        note: {
          en: "Per-sentence fact list, each coloured by its own support, with `[not relevant]` on filtered facts and an Alignment tag from the gold side-evaluation. This is where the extraction defect is visible from the outside: every one of these lists has exactly one item across all 359 reports. The Alignment tag is keyed on exact float equality against 1.0, 0.0 and 0.5, so the 0.5 parse-failure default shows up here as a confident \"Neutral\".",
          zh: "逐句列出 fact，各自按自身 support 着色，被过滤的标 `[not relevant]`，并带上 gold 旁路评估给的 Alignment 标签。抽取缺陷正是在这里从外部可见：全部 359 份报告里，这些列表每一个都只有一项。Alignment 标签是拿浮点数和 1.0 / 0.0 / 0.5 精确相等来判定的，所以解析失败默认的 0.5 会在这里显示成一个笃定的 “Neutral”。",
        },
        kind: "bug",
      },
      {
        from: 1040,
        to: 1072,
        title: { en: "All ten answers, in full", zh: "十个回答的完整原文" },
        fn: "write_heatmap_html",
        note: {
          en: "The main answer plus all nine alternatives verbatim, each with its extracted facts underneath, then the file is written. Nothing is summarised away — the entire evidence chain for one record is in one self-contained file, which is why a reader can disagree with the pipeline and check.",
          zh: "main answer 加九个 alternative 的完整原文，每个下面附上抽取出的 fact，然后写文件。没有任何东西被摘要掉——一条记录的完整证据链都在一个自包含文件里，所以读者可以不同意流水线的结论并自己核对。",
        },
        kind: "design",
      },
    ],
  },
  {
    id: "calibration",
    step: 10,
    from: 1073,
    to: 1354,
    title: { en: "Step 10 — calibration and the summary page", zh: "第 10 步 —— 校准与汇总页" },
    blocks: [
      {
        from: 1073,
        to: 1092,
        title: { en: "Deduplicate rows by record id", zh: "按记录 id 去重" },
        fn: "optimize_and_update_thresholds",
        note: {
          en: "Keeps the last row per id while preserving order. Defensive — the main loop visits each record once — but it means a dataset with duplicate ids silently loses rows rather than erroring. The identical fifteen lines appear again at :1165.",
          zh: "每个 id 保留最后一行，同时保持顺序。这是防御性的——主循环每条记录只处理一次——但也意味着 id 重复的数据集会静默丢行而不是报错。同样的十五行在 :1165 又出现了一次。",
        },
        kind: "trap",
      },
      {
        from: 1093,
        to: 1116,
        title: { en: "Binarising the judge at 4", zh: "以 4 分为界二值化 judge" },
        fn: "optimize_and_update_thresholds",
        note: {
          en: "`prom_val >= 4` is the positive class, and `prom_val > 0` is what excludes parse failures. The `metrics_to_eval` dict and the three-colour palette are scaffolding for comparing several metrics; only one is ever registered, so the loop runs once. That scaffolding is exactly where an evidence-support axis would be added.",
          zh: "`prom_val >= 4` 为正类，`prom_val > 0` 用来排除解析失败。`metrics_to_eval` 字典和三色调色板是为“比较多个指标”准备的脚手架，但只注册了一个，所以循环只跑一次。要加证据支持这条轴，位置就在这个脚手架里。",
        },
        kind: "design",
      },
      {
        from: 1117,
        to: 1127,
        title: { en: "Max-F1 threshold, and two quiet caveats", zh: "F1 最大点阈值，以及两处不响的隐患" },
        fn: "optimize_and_update_thresholds",
        note: {
          en: "The threshold is the argmax of F1 over the PR curve — chosen on all the data, then used to report accuracy on all the same data at :1184. No split anywhere; every headline number is in-sample. Two smaller things: `precision_recall_curve` returns one fewer threshold than points, so :1122 clamps, and if F1 peaks at that final degenerate point the threshold silently becomes the largest observed score; and :1126 computes PR-AUC by trapezoid over the PR curve, which is optimistically biased — `average_precision_score` is the standard estimator.",
          zh: "阈值取 PR 曲线上 F1 的 argmax——在全部数据上选，然后 :1184 又在同一批数据上报准确率。全程没有划分，所有 headline 数字都是 in-sample 的。另有两处小问题：`precision_recall_curve` 返回的阈值比点数少一个，:1122 因此做了 clamp，若 F1 恰好在最后那个退化点取最大，阈值就会静默变成观测到的最大分数；:1126 用梯形法在 PR 曲线上算 PR-AUC，这是偏乐观的估计，标准做法是 `average_precision_score`。",
        },
        kind: "bug",
      },
      {
        from: 1128,
        to: 1161,
        title: { en: "Plot and return", zh: "出图并返回" },
        fn: "optimize_and_update_thresholds",
        note: {
          en: "Draws the curve, marks the chosen operating point, saves `pr_curves_comparison.png`, and returns the threshold, the deduplicated rows and the filename. The plot is the only artifact where the shape of the score distribution is visible at all — the summary table shows numbers, this shows whether the two classes actually separate.",
          zh: "画曲线、标出选定工作点、保存 `pr_curves_comparison.png`，返回阈值、去重后的行和文件名。这张图是唯一能看到分数分布形状的产物——汇总表给的是数字，这张图告诉你两类到底分不分得开。",
        },
      },
      {
        from: 1162,
        to: 1195,
        title: { en: "Accuracy, computed once", zh: "第一次计算准确率" },
        fn: "write_summary_html",
        note: {
          en: "Walks the rows applying the threshold and counts agreement with the binarised judge. This is where 82.4% and 70.3% come from. What it does not compute — and what any reader needs before those numbers mean anything — is the positive base rate and the majority-class baseline. On SQuAD that baseline is 83.5%, above the 70.3% printed below it.",
          zh: "遍历所有行套用阈值，统计与二值化 judge 的一致率。82.4% 和 70.3% 就是从这里来的。它没有计算的、而任何读者要看懂这些数字都必须先知道的，是正类基准率和多数类基线。SQuAD 上这条基线是 83.5%，高于它下面印出来的 70.3%。",
        },
        kind: "bug",
      },
      {
        from: 1196,
        to: 1253,
        title: { en: "The benchmark panel", zh: "指标面板" },
        fn: "write_summary_html",
        note: {
          en: "The PR plot, the calibrated threshold to four decimals, Spearman, Pearson and the accuracy, then the table header. This panel is the natural home for base rate, majority baseline, ROC-AUC, PR-AUC and lift — adding five lines here is the smallest change in the file with the largest effect on how the results read.",
          zh: "PR 图、精确到小数点后四位的校准阈值、Spearman、Pearson、准确率，然后是表头。基准率、多数类基线、ROC-AUC、PR-AUC 和 lift 的天然位置就是这个面板——在这里加五行，是整个文件里改动最小、而对结果解读影响最大的一处。",
        },
      },
      {
        from: 1254,
        to: 1334,
        title: { en: "The row loop, and a counter kept by a renderer", zh: "行循环，以及由渲染函数维护的计数器" },
        fn: "write_summary_html",
        note: {
          en: "`_get_cell` at :1283 decides the cell's colour class and, at :1300, increments `correct_counts` as a side effect of rendering. So the totals row is computed by drawing the table — the same quantity `accuracy_pct` already computed independently at :1179, by a different loop with the same logic. Two implementations of one number, and the second only stays right as long as the cell is drawn.",
          zh: ":1283 的 `_get_cell` 既决定单元格的颜色类，又在 :1300 作为渲染的副作用给 `correct_counts` 加一。于是总计行是靠“画表格”算出来的——而这个量 :1179 已经用另一个逻辑相同的循环独立算过一遍（`accuracy_pct`）。同一个数字有两份实现，而第二份只有在单元格确实被画出来时才成立。",
        },
        kind: "bug",
      },
      {
        from: 1335,
        to: 1354,
        title: { en: "The totals row", zh: "总计行" },
        fn: "write_summary_html",
        note: {
          en: "`correct_counts / prom_processed` and `prom_processed / total_eval` — the 164/199 and 199/200 that the report quoted inconsistently. Read the denominators here rather than from the prose: this row is the source of truth.",
          zh: "`correct_counts / prom_processed` 和 `prom_processed / total_eval`——也就是报告里前后不一致地引用过的 164/199 和 199/200。分母以这一行为准，不要以正文为准：这一行才是事实来源。",
        },
      },
    ],
  },
  {
    id: "main",
    from: 1355,
    to: 1623,
    title: { en: "The main loop", zh: "主循环" },
    blocks: [
      {
        from: 1355,
        to: 1366,
        title: { en: "One positional argument", zh: "唯一一个位置参数" },
        note: {
          en: "`python visualize.py 5` processes the first five records; no argument means all of them. That is the entire CLI — no dataset flag, no output flag, no model flag.",
          zh: "`python visualize.py 5` 处理前五条，不带参数就是全量。这就是全部命令行接口——没有数据集参数、没有输出目录参数、没有模型参数。",
        },
      },
      {
        from: 1367,
        to: 1378,
        title: { en: "The misspelled output directory", zh: "拼错的输出目录" },
        note: {
          en: "`output_heatmaps_incorretacalibrated`, hard-coded, and not what the README says nor what either committed directory is called — both were renamed by hand after the fact. Two runs into the same directory overwrite each other, and the Prometheus cache at :1444 makes that overwrite partially invisible.",
          zh: "`output_heatmaps_incorretacalibrated`，写死的，既不是 README 里写的名字，也不是仓库里那两个目录的名字——它们都是事后手工改名的。两次跑批写进同一个目录会互相覆盖，而 :1444 的 Prometheus 缓存会让这种覆盖部分不可见。",
        },
        kind: "trap",
      },
      {
        from: 1379,
        to: 1394,
        title: { en: "Accept a list or a {records: [...]} object", zh: "接受列表或 {records: [...]} 对象" },
        note: {
          en: "Both dataset shapes are handled, and an unrecognised shape becomes an empty list — so a malformed file produces a clean run over zero records and a summary page of nothing, rather than an error.",
          zh: "两种数据集结构都支持，无法识别的结构则变成空列表——所以格式错误的文件会“干净地”跑完零条记录、生成一张空汇总页，而不是报错。",
        },
        kind: "trap",
      },
      {
        from: 1395,
        to: 1421,
        title: { en: "Per-record fields and the summary skeleton", zh: "每条记录的字段与汇总骨架" },
        note: {
          en: "`question`, `gold_answer_canonical`, `pred_answer`, `id`. Everything else on the record is ignored — including `retrieved_chunks`, the top-10 documents that make the TriviaQA input file 36 MB and that an evidence axis would read from right here. `retrieval_score` and `semantic_entropy` are carried into the summary but never computed against.",
          zh: "只取 `question`、`gold_answer_canonical`、`pred_answer`、`id`。记录上其余字段一概忽略——包括 `retrieved_chunks`，也就是让 TriviaQA 输入文件有 36 MB 的那些 top-10 文档；证据轴要读的正是这里。`retrieval_score` 和 `semantic_entropy` 被带进汇总，但从未参与任何计算。",
        },
        kind: "design",
      },
      {
        from: 1422,
        to: 1437,
        title: { en: "Empty-question bypass, token counter reset", zh: "空问题跳过，token 计数器归零" },
        note: {
          en: "An empty question writes the bypass page and continues. `_prompt_tokens = 0` at :1433 resets the module-level counter for this record — the reason per-record token counts in the summary are per-record at all.",
          zh: "空问题写出跳过页面然后 continue。:1433 的 `_prompt_tokens = 0` 为这条记录重置模块级计数器——汇总里每条记录的 token 数之所以是“每条记录”的，就靠这一行。",
        },
      },
      {
        from: 1438,
        to: 1455,
        title: { en: "The implicit Prometheus cache", zh: "隐式的 Prometheus 缓存" },
        note: {
          en: "If the record's HTML already exists, the judge score is scraped back out of it with a regex and the scoring call is skipped. It saves money and it makes reruns non-idempotent: change the rubric without clearing the output directory and every record silently keeps its old label. Clear the directory before trusting any rerun, and re-score a sample before trusting the numbers already in the repository.",
          zh: "如果这条记录的 HTML 已经存在，就用正则把旧的 judge 分数抠出来复用，跳过打分调用。省钱，同时让重跑不再幂等：改了 rubric 却没清空输出目录，每条记录都会静默沿用旧标签。信任任何一次重跑之前先清目录；信任仓库里已有的数字之前，先抽样重新打分核对。",
        },
        kind: "trap",
      },
      {
        from: 1456,
        to: 1476,
        title: { en: "Expand, split, extract, filter", zh: "扩写、分句、抽取、过滤" },
        note: {
          en: "Both the main answer and all nine alternatives are expanded, the main answer is split into sentences, and :1467 does extraction and deduplication in one comprehension. Relevance is then checked per sentence — one API call each, rather than one for the record.",
          zh: "main answer 和九个 alternative 都做扩写，main answer 分句，:1467 用一个推导式同时完成抽取和去重。随后逐句检查相关性——每句一次 API 调用，而不是整条记录一次。",
        },
      },
      {
        from: 1477,
        to: 1493,
        title: { en: "Alternatives are flattened, not sentence-scoped", zh: "alternative 被摊平，不按句子分组" },
        note: {
          en: "Each alternative's sentences are extracted and concatenated into one flat fact list, deduplicated once. This is why an alternative can show several \"facts\" in the report while a main sentence never does — they are its sentences, not a decomposition. Computed once here and reused by every sentence, which is the right call.",
          zh: "每个 alternative 的所有句子被抽取后拼成一个扁平的 fact 列表，整体去重一次。这就是为什么报告里 alternative 有时显示多条 “fact” 而 main 的句子从来没有——那些是它的句子，不是拆分结果。这里算一次然后被所有句子复用，做法是对的。",
        },
        kind: "trap",
      },
      {
        from: 1494,
        to: 1508,
        title: { en: "Per-sentence loop, and the skip", zh: "逐句循环与跳过分支" },
        note: {
          en: "A sentence with no relevant facts appends `None` across all five parallel lists and continues — the convention the HTML renders as an uncoloured \"Not scored\" span. Five appends that must stay in step; this is the parallel-array design's maintenance cost, paid in full.",
          zh: "没有相关 fact 的句子在五个平行列表里各追加一个 `None` 然后 continue——HTML 会把这个约定渲染成无色的 “Not scored”。五处追加必须始终对齐；这就是平行数组设计的维护成本，在这里付满了。",
        },
      },
      {
        from: 1509,
        to: 1521,
        title: { en: "Gold side-evaluation, then the real score", zh: "先旁路评估，再算真正的分数" },
        note: {
          en: "Two display-only gold evaluations run before `evaluate_consistency_hungarian` produces the number that actually matters. The sentence score is an unweighted mean over its facts, and `gold_mean` at :1518 uses `max` rather than `mean` — one matching fact is enough to look aligned. Optimistic, and display-only, but the printed line invites you to read it as a verdict.",
          zh: "两个纯展示用的 gold 评估先跑，然后 `evaluate_consistency_hungarian` 才产出真正重要的那个数。句子分数是其 fact 的不加权均值，而 :1518 的 `gold_mean` 用的是 `max` 不是 `mean`——只要有一条 fact 对上就显得对齐。偏乐观，而且只用于展示，但打印出来的那一行很容易被当成判定来读。",
        },
        kind: "trap",
      },
      {
        from: 1522,
        to: 1548,
        title: { en: "Re-expanding scores back over filtered facts", zh: "把分数重新摊回被过滤前的 fact 列表" },
        note: {
          en: "Scores were computed over relevant facts only, so this walks the relevance mask and reinserts `None` for filtered ones, restoring alignment with the full fact list the HTML iterates. Then the per-alternative column averages for the summary table. Fiddly index bookkeeping that a small dataclass would delete entirely.",
          zh: "分数只在相关 fact 上算过，所以这里沿着相关性掩码走一遍，给被过滤的位置插回 `None`，恢复与 HTML 遍历的完整 fact 列表对齐。之后再算汇总表要用的每个 alternative 的列平均。这类繁琐的下标记账，用一个小 dataclass 就能整段删掉。",
        },
      },
      {
        from: 1549,
        to: 1567,
        title: { en: "Nineteen arguments", zh: "十九个参数" },
        note: {
          en: "The report is written before the record-level aggregation below, so a record that crashes during aggregation still leaves a readable heatmap on disk. Probably accidental, genuinely useful.",
          zh: "报告在下面的记录级聚合之前就写出去了，所以即使聚合阶段崩了，磁盘上仍留有一份可读的热力图。大概率是无意的，但确实有用。",
        },
      },
      {
        from: 1568,
        to: 1588,
        title: { en: "Record-level aggregation", zh: "记录级聚合" },
        note: {
          en: "`nli_score` is the unweighted mean over scored sentences, so a one-fact sentence counts as much as a ten-fact one. `overall_llm_gold` uses `max` again at :1580. The variable is named `overall_entropy` — a leftover from the Phase II naming that survives into the field it fills.",
          zh: "`nli_score` 是所有已打分句子的不加权均值，所以只有一条 fact 的句子和有十条 fact 的句子权重相同。:1580 的 `overall_llm_gold` 又一次用了 `max`。变量名叫 `overall_entropy`——Phase II 命名的遗留，一路留到了它填充的那个字段里。",
        },
        kind: "design",
      },
      {
        from: 1589,
        to: 1599,
        title: { en: "One except for everything", zh: "一个 except 兜住所有错误" },
        note: {
          en: "A bare `except Exception` around the entire record. The message is printed to stdout, but only the exception class name is stored, and there is no traceback — so a batch run tells you a record failed and nothing about where. Adding `traceback.print_exc()` and keeping the message on the record costs two lines and is the difference between a debuggable batch and an opaque one.",
          zh: "整条记录被一个裸 `except Exception` 包住。异常消息会打到 stdout，但存进记录的只有异常类名，而且没有堆栈——所以批跑只会告诉你某条失败了，不会告诉你失败在哪。加一行 `traceback.print_exc()` 并把消息一并存进记录，只要两行，却决定了这次批跑可不可调试。",
        },
        kind: "trap",
      },
      {
        from: 1600,
        to: 1623,
        title: { en: "Calibrate, correlate, write the summary", zh: "校准、算相关、写汇总" },
        note: {
          en: "Thresholds first, then Spearman and Pearson over the paired scores, then the summary page. Correlations are computed over records with a usable judge label only, which is why the reported n is 199 and 158. Note the whole calibration runs after every record — a crash on record 300 of 359 leaves you with 300 heatmaps and no summary at all. Checkpointing `summary_data` to JSON as you go would make a long run resumable, and is worth doing before the first full rerun.",
          zh: "先算阈值，再在配对分数上算 Spearman 和 Pearson，最后写汇总页。相关系数只在有可用 judge 标签的记录上计算，这就是 n 为 199 和 158 的原因。注意整个校准是在所有记录跑完之后才执行的——第 359 条里第 300 条崩掉，你就只有 300 张热力图、一张汇总页都没有。边跑边把 `summary_data` 落盘成 JSON，长跑就能续跑，值得在第一次完整重跑之前先做掉。",
        },
        kind: "trap",
      },
    ],
  },
];
