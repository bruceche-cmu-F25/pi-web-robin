import type { Bilingual } from "./research.ts";

/**
 * How to actually run Samuel's pipeline.
 *
 * The fifth HEAT document, and the only operational one. The stack says what a
 * term means, the walkthrough says what line 231 does, the report says what the
 * numbers are worth, the brief says what will bite you, the architecture page
 * describes a different repository. None of them tells you what to type.
 *
 * Written against `~/heat` at `fe68c9a`, by reading `visualize.py` rather than
 * by running it — every figure here is either quoted from the committed
 * `execution_summary_*.html` files or derived from the source, and the ones
 * that were computed are marked as such. The first thing it does is say what
 * "reproduce" can and cannot mean here, because the answer is not obvious and
 * getting it wrong costs a week.
 */

export const RUN_META = {
  title: { en: "Running Samuel's pipeline", zh: "把 Samuel 的流水线跑起来" },
  subtitle: {
    en: "A runbook for the reproduction, with the parts that are not in the code",
    zh: "复现用的操作手册，包含代码里没写的那些步骤",
  },
  repo: "~/heat @ fe68c9a",
  written: "2026-08-30",
  framing: {
    en: "Read section 1 before you budget your week — it decides what \"reproduce\" is allowed to mean. Sections 2 to 4 are the actual procedure. Section 6 is the one to keep open while a run is going, because the pipeline swallows its own error messages and you will need the symptom table.",
    zh: "排周计划之前先读第 1 节——它决定了“复现”在这里能是什么意思。第 2 到 4 节是实际操作。跑起来之后把第 6 节开着，因为这条流水线会把自己的错误信息吞掉，你需要那张症状表。",
  },
} as const;

/**
 * The constraint that decides the whole week.
 *
 * Stated first and without hedging: the alternatives are sampled at
 * temperature 0.9, so byte-identical reproduction is impossible by
 * construction. A reader who does not internalise this will spend days
 * chasing a difference that is supposed to be there.
 */
export const REALITY = {
  title: {
    en: "Byte-for-byte reproduction is impossible, and that is by design",
    zh: "逐字复现做不到，而且这是设计使然",
  },
  body: {
    en: "`generate_answers` samples the nine alternatives at `temperature=0.9, top_p=0.9` (`visualize.py:199`). Every heatmap number downstream of those samples will differ on every run, including Samuel's own reruns. The main answer is the exception: it is not generated at all, it is `pred_answer` read straight out of the input JSON, so the text being scored is fixed. Anything derived only from the main answer — the Prometheus score, the sentence segmentation, the fact count — is reproducible; anything derived from the alternatives is not.",
    zh: "`generate_answers` 用 `temperature=0.9, top_p=0.9` 采那九条 alternatives（`visualize.py:199`）。所有依赖这些采样的热力图数值每次都会不同，Samuel 自己重跑也一样。main answer 是例外：它根本不是生成的，而是直接从输入 JSON 读 `pred_answer`，所以被打分的那段文本是固定的。只依赖 main answer 的量——Prometheus 分数、句子切分、fact 数——是可复现的；依赖 alternatives 的量不可复现。",
  },
  goals: {
    en: "So set the bar at three things you can actually tick off: the pipeline runs end to end on your machine; you can say which quantities matched and which could not have; and you can state the configuration Samuel's committed reports were produced under. \"The numbers came out the same\" is not on that list and should not be promised to anyone.",
    zh: "所以把标准定成三件你真能打勾的事：流水线在你机器上端到端跑通了；你能说出哪些量对上了、哪些本来就不可能对上；你能说清 Samuel 那批已提交报告是在什么配置下产生的。“数字跑出来一样”不在这个清单里，也不该向任何人承诺。",
  },
} as const;

export interface Prereq {
  id: string;
  what: Bilingual;
  detail: Bilingual;
  gotcha?: Bilingual;
}

/** What has to exist before step 1, and the surprises in each. */
export const PREREQS: readonly Prereq[] = [
  {
    id: "python",
    what: { en: "Python with a fresh virtualenv", zh: "Python 和一个干净的 virtualenv" },
    detail: {
      en: "`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`. The declared list is seven packages, but `sentence-transformers` pulls `torch` and `transformers` transitively, so expect a download on the order of a gigabyte or two rather than the small install the file suggests.",
      zh: "`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`。声明的只有七个包，但 `sentence-transformers` 会传递依赖拉进 `torch` 和 `transformers`，所以实际下载量是一两个 GB，而不是这个文件看上去的那么小。",
    },
  },
  {
    id: "key",
    what: { en: "A Gemini API key — not a GCP service account", zh: "一个 Gemini API key——不是 GCP 服务账号" },
    detail: {
      en: "`visualize.py:52` reads `GEMINI_API_KEY` or `GOOGLE_API_KEY` and passes it as a `?key=` query parameter to `generateContent`. Despite every function being named `vertex_*`, this is the plain API-key path, so no `gcloud auth`, no service-account JSON, no project or region to configure.",
      zh: "`visualize.py:52` 读 `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`，然后作为 `?key=` 查询参数拼到 `generateContent` 上。虽然所有函数都叫 `vertex_*`，它走的其实是普通 API key 那条路，所以不需要 `gcloud auth`、不需要服务账号 JSON、也不用配 project 和 region。",
    },
    gotcha: {
      en: "Missing key fails fast with `RuntimeError: Missing API key` on the first call, not at startup — so a misconfigured key wastes the NLI model download first.",
      zh: "没设 key 会在第一次调用时抛 `RuntimeError: Missing API key`，而不是启动时——所以配错了会先白等一次 NLI 模型下载。",
    },
  },
  {
    id: "model",
    what: { en: "The model name is pinned in the file", zh: "模型名写死在文件里" },
    detail: {
      en: "`_model = \"gemini-2.5-flash\"` at `visualize.py:54`. It is a module-level constant with no flag and no environment override. Whether Samuel's committed reports were produced by the same snapshot of that model is not knowable from the repository — the summary pages record no model version or run date.",
      zh: "`visualize.py:54` 的 `_model = \"gemini-2.5-flash\"`。模块级常量，没有命令行开关也没有环境变量覆盖。Samuel 那批报告是不是同一个模型快照跑出来的，从仓库里看不出来——汇总页没有记录模型版本，也没有运行日期。",
    },
  },
  {
    id: "nli",
    what: { en: "The NLI cross-encoder, on CPU", zh: "NLI cross-encoder，跑在 CPU 上" },
    detail: {
      en: "`cross-encoder/nli-deberta-v3-large`, downloaded from HuggingFace on first use. The device is hardcoded: `CrossEncoder(NLI_MODEL_ID, max_length=512, device=\"cpu\")`. No GPU is needed and none will be used even if present.",
      zh: "`cross-encoder/nli-deberta-v3-large`，首次使用时从 HuggingFace 下载。设备是写死的：`CrossEncoder(NLI_MODEL_ID, max_length=512, device=\"cpu\")`。不需要 GPU，就算有也不会用。",
    },
    gotcha: {
      en: "NLI cost scales with facts per answer, and facts per answer is currently stuck at one by the extraction defect. Fix that defect and the NLI matrices grow quadratically — the CPU-only setting stops being free.",
      zh: "NLI 的开销随每条答案的 fact 数增长，而 fact 数目前被抽取缺陷卡在 1。修好那个缺陷之后 NLI 矩阵会平方级变大——写死 CPU 就不再是免费的了。",
    },
  },
  {
    id: "nltk",
    what: { en: "NLTK sentence tokenizers", zh: "NLTK 的句子切分器" },
    detail: {
      en: "`punkt` and `punkt_tab` are downloaded at import time by `visualize.py:41-42`, quietly. On a machine with no network at import time this fails before anything else runs.",
      zh: "`punkt` 和 `punkt_tab` 由 `visualize.py:41-42` 在 import 时静默下载。如果 import 时没有网络，它会在任何东西开始跑之前就失败。",
    },
  },
] as const;

export interface CommittedRun {
  id: string;
  name: string;
  input: string;
  outputDir: string;
  records: string;
  tokens: string;
  wallClock: string;
  threshold: string;
  accuracy: string;
  note: Bilingual;
}

/**
 * The two runs you are reproducing, with their real cost.
 *
 * Every figure here was read out of the committed `execution_summary_*.html`
 * files rather than estimated, which is why the token totals are exact. They
 * are the only reliable basis for budgeting the API spend.
 */
export const COMMITTED_RUNS: readonly CommittedRun[] = [
  {
    id: "triviaqa",
    name: "TriviaQA",
    input: "incorrect_caliberated_first_200.json",
    outputDir: "output_heatmaps_triviaqa/",
    records: "200 in, 200 reports out",
    tokens: "2,232,741",
    wallClock: "62 min · median 16.1 s/record · max 152 s",
    threshold: "NLI support ≥ 0.5887",
    accuracy: "82.4% · Spearman 0.719 · Pearson 0.747",
    note: {
      en: "The clean one. Every input id has exactly one report and no id repeats. Reproduce this first — if anything is wrong with your setup it will show up here without any confounds.",
      zh: "干净的那个。每个输入 id 恰好对应一份报告，没有重复 id。先复现这个——如果你的环境有问题，在这里会干净地暴露出来，没有别的因素干扰。",
    },
  },
  {
    id: "squad",
    name: "SQuAD",
    input: "squad_failed_examples_requested_runs.json",
    outputDir: "output_heatmaps_squad/",
    records: "256 in, 159 reports out",
    tokens: "2,109,424",
    wallClock: "75 min · median 17.6 s/record · max 266 s",
    threshold: "NLI support ≥ 0.3289",
    accuracy: "70.3% · Spearman 0.401 · Pearson 0.289",
    note: {
      en: "The input holds 256 records but only 159 distinct ids — 63 ids appear twice and 17 three times, from different `run` values with different `pred_answer`s. Report filenames are keyed on id alone, so later duplicates overwrite earlier ones. Its summary table has 159 rows, matching the file count rather than the record count, and nothing in the repository explains that gap.",
      zh: "输入有 256 条记录，但只有 159 个不同的 id——63 个 id 出现两次、17 个出现三次，来自不同的 `run`，`pred_answer` 也不同。报告文件名只按 id 命名，所以后面的重复会覆盖前面的。它的汇总表有 159 行，对上的是文件数而不是记录数，而仓库里没有任何东西解释这个差距。",
    },
  },
] as const;

export interface EditRow {
  id: string;
  ref: string;
  current: string;
  why: Bilingual;
}

/**
 * The configuration that has no command-line flag.
 *
 * This is the section that saves the most time, because the checked-in state
 * does not correspond to either committed run and there is nothing in the
 * README that says so.
 */
export const EDITS = {
  headline: {
    en: "The checked-in state reproduces neither run",
    zh: "仓库当前状态哪一次运行都复现不了",
  },
  body: {
    en: "`DATASET_PATH` points at the SQuAD input while `output_dir` is named for the TriviaQA one, and the output directory name matches neither of the two committed directories. Nothing about this is documented. Decide which run you are reproducing and set both lines to agree before you start.",
    zh: "`DATASET_PATH` 指向 SQuAD 的输入，而 `output_dir` 用的是 TriviaQA 那次的名字，并且这个输出目录名和两个已提交目录都不一致。这一点没有任何文档说明。开始之前先决定你要复现哪一次，把这两行改成互相一致。",
  },
  rows: [
    {
      id: "dataset",
      ref: "visualize.py:47",
      current: 'DATASET_PATH = "squad_failed_examples_requested_runs.json"',
      why: {
        en: "Module-level constant, no flag. Set it to the input of the run you want.",
        zh: "模块级常量，没有开关。改成你要跑那次的输入文件。",
      },
    },
    {
      id: "outdir",
      ref: "visualize.py:1368",
      current: 'output_dir = "output_heatmaps_incorretacalibrated"',
      why: {
        en: "Also hardcoded, also no flag, and misspelled. Point it at a NEW empty directory — never at a committed one, for the reason in the failure table.",
        zh: "同样写死、同样没有开关，而且拼错了。指向一个**全新的空目录**——绝不要指向已提交的目录，理由见故障表。",
      },
    },
    {
      id: "summary",
      ref: "visualize.py:1621",
      current: 'summary_path = os.path.join(output_dir, "execution_summary.html")',
      why: {
        en: "The code always writes `execution_summary.html`, but the repository holds `execution_summary_squad.html` and `execution_summary_triviaqa.html`. Those were renamed by hand after the run — a step that exists nowhere in the source. Expect to rename yours too.",
        zh: "代码永远写 `execution_summary.html`，但仓库里是 `execution_summary_squad.html` 和 `execution_summary_triviaqa.html`。那是运行结束后手工改名的——这一步在源码里根本不存在。你的也要照样改名。",
      },
    },
  ] as readonly EditRow[],
} as const;

export interface Step {
  id: string;
  n: number;
  title: Bilingual;
  command?: string;
  expect: Bilingual;
  watch?: Bilingual;
}

/** The procedure, in order, with what each step should print. */
export const STEPS: readonly Step[] = [
  {
    id: "recompute",
    n: 1,
    title: { en: "Recompute the published numbers first — no API key needed", zh: "先重算已发布的数字——不需要 API key" },
    expect: {
      en: "Before spending anything, parse the 359 committed reports and recompute the summary metrics yourself. If your recomputation does not land on 82.4% for TriviaQA and 70.3% for SQuAD, your understanding of the metric is wrong and no amount of running will fix that. This costs ten minutes and zero dollars, and it is the single highest-value step in the week.",
      zh: "在花任何钱之前，先解析那 359 份已提交报告，自己把汇总指标重算一遍。如果你算不出 TriviaQA 的 82.4% 和 SQuAD 的 70.3%，那是你对指标的理解有问题，跑多少次都补不回来。这一步十分钟、零成本，也是这一周里性价比最高的一步。",
    },
  },
  {
    id: "env",
    n: 2,
    title: { en: "Build the environment", zh: "搭环境" },
    command: "cd ~/heat\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt",
    expect: {
      en: "Torch and transformers arrive transitively. Nothing here touches the network at run time except the NLI download and the API itself.",
      zh: "torch 和 transformers 会作为传递依赖装进来。这一步之后，运行期唯一的网络访问就是 NLI 模型下载和 API 本身。",
    },
  },
  {
    id: "smoke",
    n: 3,
    title: { en: "Smoke test on five records, into a fresh directory", zh: "五条记录的冒烟测试，输出到全新目录" },
    command: "# edit :47 and :1368 first — see section 3\nexport GEMINI_API_KEY=...\npython visualize.py 5",
    expect: {
      en: "One line per record with its token count and elapsed time, and one `Sentence N | NLI Support Score: ...` line per sentence. Five reports plus an `execution_summary.html` in your new directory. Median record should be around 16 seconds and around 11,000 tokens; if yours is wildly different, stop and find out why before scaling up.",
      zh: "每条记录一行，带 token 数和耗时；每个句子一行 `Sentence N | NLI Support Score: ...`。你的新目录里会出现五份报告加一个 `execution_summary.html`。单条记录中位数应该在 16 秒、约 11,000 tokens 上下；差得离谱就先停下来查清楚，别急着放大。",
    },
    watch: {
      en: "The summary metrics from a five-record run are meaningless — see the failure table on `limit`. Only the per-record lines are worth reading here.",
      zh: "五条记录跑出来的汇总指标没有意义——见故障表里关于 `limit` 那条。这一步只有逐条记录的输出值得看。",
    },
  },
  {
    id: "triviaqa",
    n: 4,
    title: { en: "Reproduce the TriviaQA run in full", zh: "全量复现 TriviaQA" },
    command: "# :47  -> incorrect_caliberated_first_200.json\n# :1368 -> output_heatmaps_triviaqa_repro\npython visualize.py 2>&1 | tee run_triviaqa.log",
    expect: {
      en: "200 records, roughly an hour, roughly 2.2M tokens. Keep the log — the per-record output is the only place errors appear, and the summary page does not record them.",
      zh: "200 条记录，约一小时，约 220 万 tokens。把日志留下——逐条输出是错误唯一出现的地方，汇总页不记录它们。",
    },
    watch: {
      en: "Run it under `tee` or `nohup`. There is no checkpointing: if the process dies at record 199 the summary is never written, and re-running repeats every API call from the beginning.",
      zh: "用 `tee` 或 `nohup` 跑。它没有断点续跑：进程在第 199 条挂掉，汇总就永远不会写出来，而重跑会从头重复每一次 API 调用。",
    },
  },
  {
    id: "compare",
    n: 5,
    title: { en: "Compare per record, not in aggregate", zh: "逐条比对，不要比汇总" },
    expect: {
      en: "Join your summary table to the committed one on id and compare column by column. Prometheus should broadly agree — it runs at `temperature=0`, so only judge jitter separates you from Samuel. NLI support, LLM gold and NLI gold will all differ, because they are computed against freshly sampled alternatives; compare their distributions, not individual rows.",
      zh: "把你的汇总表按 id 和已提交那份连接起来，逐列比。Prometheus 应该大体一致——它跑在 `temperature=0`，你和 Samuel 之间只差 judge 的抖动。NLI support、LLM gold、NLI gold 三列都会不同，因为它们是对着重新采样的 alternatives 算的；比它们的分布，不要比单行。",
    },
  },
  {
    id: "facts",
    n: 6,
    title: { en: "Confirm the extraction defect yourself", zh: "自己确认抽取缺陷" },
    expect: {
      en: "Open any report and find the `Sentence 1: NLI Fact Matrix` block. The fact row will be the entire sentence reproduced verbatim rather than a decomposed claim — in the committed TriviaQA reports it is the whole main answer, every time. That is the defect: `_clean_generated_text` (`:231`) strips the leading `-` that `extract_facts_from_sentence` (`:396`) parses for, so it matches nothing and falls back at `:412` to keeping the sentence whole. Seeing it in your own output is worth far more in a meeting than quoting someone else's analysis.",
      zh: "打开任意一份报告，找到 `Sentence 1: NLI Fact Matrix` 那一块。fact 那一行会是整句原文照抄，而不是拆开的单条主张——在已提交的 TriviaQA 报告里，每一次都是整段 main answer。这就是那个缺陷：`_clean_generated_text`（`:231`）把 `extract_facts_from_sentence`（`:396`）要解析的前导 `-` 删掉了，于是匹配不到任何东西，在 `:412` 兜底把整句留下。在会上，拿自己跑出来的结果说话，比转述别人的分析有力得多。",
    },
  },
  {
    id: "squad",
    n: 7,
    title: { en: "Attempt SQuAD, and document why it does not line up", zh: "尝试 SQuAD，并记录它为什么对不上" },
    expect: {
      en: "Run it the same way and you will get 159 reports out of 256 records. That is not your mistake — it is the duplicate-id overwrite. Write down what you observe: how many ids collided, whether the surviving report is the last occurrence, and whether its Prometheus score belongs to the first. This is a finding to bring to the meeting, not a failed step.",
      zh: "照同样的方式跑，256 条记录会得到 159 份报告。这不是你的错——是重复 id 覆盖造成的。把你观察到的写下来：多少个 id 撞了、留下来的报告是不是最后一次出现的那条、它的 Prometheus 分数是不是第一次那条的。这是带去开会的发现，不是失败的步骤。",
    },
  },
] as const;

export interface CallSite {
  id: string;
  fn: string;
  ref: string;
  perRecord: Bilingual;
}

/** Where the money goes, per record. */
export const CALL_SITES: readonly CallSite[] = [
  {
    id: "alternatives",
    fn: "generate_answers",
    ref: "visualize.py:199",
    perRecord: {
      en: "9 calls — one per alternative. The tenth answer is not generated; it is `pred_answer` from the input.",
      zh: "9 次——每条 alternative 一次。第十条不是生成的，是输入里的 `pred_answer`。",
    },
  },
  {
    id: "prometheus",
    fn: "evaluate_prometheus_score",
    ref: "visualize.py:270",
    perRecord: {
      en: "1 call, or 0 if a report already exists at the output path — see the failure table.",
      zh: "1 次；如果输出路径上已有报告则是 0 次——见故障表。",
    },
  },
  {
    id: "facts",
    fn: "extract_facts_from_sentence",
    ref: "visualize.py:377",
    perRecord: {
      en: "One call per sentence of the main answer and per sentence of each alternative — the highest-count site. Its output is then discarded by the defect, so this is currently pure waste.",
      zh: "main answer 的每一句、以及每条 alternative 的每一句各一次——调用次数最多的地方。而它的输出随后被那个缺陷丢弃，所以目前是纯浪费。",
    },
  },
  {
    id: "relevance",
    fn: "check_facts_relevance",
    ref: "visualize.py:504",
    perRecord: {
      en: "One call per sentence of the main answer that produced any facts.",
      zh: "main answer 里每个产出了 fact 的句子一次。",
    },
  },
  {
    id: "gold",
    fn: "evaluate_facts_with_llm",
    ref: "visualize.py:551",
    perRecord: {
      en: "One call per sentence with relevant facts. Display-only — it feeds no headline metric.",
      zh: "每个有相关 fact 的句子一次。仅用于展示——不进入任何主要指标。",
    },
  },
] as const;

export const SEVERITIES = ["stop", "warn", "note"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Failure {
  id: string;
  severity: Severity;
  symptom: Bilingual;
  cause: Bilingual;
  action: Bilingual;
}

/**
 * Symptom first, because that is what you will have.
 *
 * The per-record handler catches every exception and keeps only the class
 * name, so the pipeline actively destroys the information you would normally
 * debug from. This table is the substitute.
 */
export const FAILURES: readonly Failure[] = [
  {
    id: "dirty-outdir",
    severity: "stop",
    symptom: {
      en: "The run finishes suspiciously fast and the Prometheus scores match Samuel's exactly",
      zh: "跑得快得可疑，而且 Prometheus 分数和 Samuel 的完全一致",
    },
    cause: {
      en: "`visualize.py:1444` checks whether the output HTML already exists and, if so, regex-scrapes the old Prometheus score out of it instead of scoring again. Point the output at a committed directory and every label is inherited rather than computed.",
      zh: "`visualize.py:1444` 会检查输出 HTML 是否已存在，若存在就用正则从里面抠出旧的 Prometheus 分数复用，而不是重新打分。把输出指向已提交目录，所有标签都是继承来的，不是算出来的。",
    },
    action: {
      en: "Always run into a new empty directory. This is the one mistake that produces a perfect-looking reproduction that means nothing.",
      zh: "永远输出到全新的空目录。这是唯一一个会产出“看起来完美但毫无意义”的复现的错误。",
    },
  },
  {
    id: "limit-summary",
    severity: "stop",
    symptom: {
      en: "A short run's accuracy and threshold do not resemble the published ones",
      zh: "短跑的准确率和阈值和已发布的对不上",
    },
    cause: {
      en: "`optimize_and_update_thresholds` fits the decision threshold on whatever records this run processed, then reports accuracy against that same fit. A five-record run fits a threshold on five records.",
      zh: "`optimize_and_update_thresholds` 在本次跑过的记录上拟合决策阈值，然后又对着同一批记录报告准确率。跑五条就是在五条上拟合阈值。",
    },
    action: {
      en: "Never compare a `limit` run's summary to the full one. Only per-record fields are comparable at partial scale. (This same self-fitting is a methodology problem at full scale too, but that is the report's argument, not a run failure.)",
      zh: "永远不要拿 `limit` 跑的汇总去和全量比。部分运行时只有逐条字段可比。（这种自我拟合在全量下同样是方法论问题，但那是报告要论证的事，不是运行故障。）",
    },
  },
  {
    id: "swallowed",
    severity: "warn",
    symptom: {
      en: "A record reports an error with no message and no traceback",
      zh: "某条记录报了错，但没有错误信息也没有 traceback",
    },
    cause: {
      en: "The line reads `Error processing record <id>: <message>` but the summary keeps only the class name: the per-record `try` catches every exception, stores only `type(e).__name__` as the bypass reason, and moves on. No traceback, no message, and the summary page shows the record as an error with no detail.",
      zh: "终端那行是 `Error processing record <id>: <message>`，但汇总里只留了类名：逐条记录的 `try` 捕获所有异常，只把 `type(e).__name__` 存成 bypass reason 就继续。没有 traceback、没有错误信息，汇总页上这条记录只显示为错误，没有细节。",
    },
    action: {
      en: "Keep the full stdout log. If errors cluster, temporarily add `traceback.print_exc()` in that handler — that is a diagnostic aid, not a fix to the pipeline, so it does not violate the do-not-fix rule.",
      zh: "把完整 stdout 日志留着。如果错误成片出现，临时在那个 handler 里加 `traceback.print_exc()`——那是诊断手段，不是对流水线的修改，不违反“先别修”的纪律。",
    },
  },
  {
    id: "no-resume",
    severity: "warn",
    symptom: {
      en: "The process died partway and there is no summary page",
      zh: "进程跑到一半挂了，没有汇总页",
    },
    cause: {
      en: "`summary_data` lives in memory and is only written after the loop completes. Individual heatmap HTMLs are written per record and do survive, but there is no resume: re-running repeats every API call, since only the Prometheus score is recoverable from an existing report.",
      zh: "`summary_data` 只存在内存里，循环走完才写出去。逐条的热力图 HTML 是每条写一次、能保住，但没有续跑机制：重跑会重复每一次 API 调用，因为已有报告里只有 Prometheus 分数能被复用。",
    },
    action: {
      en: "Run under `nohup`/`tmux`. At roughly an hour per dataset a crash is survivable, but budget for repeating the spend.",
      zh: "用 `nohup`/`tmux` 跑。每个数据集大约一小时，挂了还能接受，但要把重复花费算进预算。",
    },
  },
  {
    id: "rate-limit",
    severity: "note",
    symptom: {
      en: "Retry lines from the API client scrolling past",
      zh: "API 客户端的重试提示在刷屏",
    },
    cause: {
      en: "Lines like `[vertex] HTTP 429, retrying in 4s...`. Built-in handling: 403, 429 and any 5xx trigger exponential backoff of `2^attempt * 2` seconds, five attempts, then the call raises and the record is marked an error. Timeouts and connection errors take the same path. The request timeout is 120 s.",
      zh: "形如 `[vertex] HTTP 429, retrying in 4s...`。内建处理：403、429 和任何 5xx 会触发 `2^attempt * 2` 秒的指数退避，共五次，之后抛异常、该条记录被标为错误。超时和连接错误走同一条路径。请求超时是 120 秒。",
    },
    action: {
      en: "Nothing to do but let it back off. If errors survive five attempts you are over quota rather than throttled — check the key's tier before rerunning.",
      zh: "除了让它退避没别的办法。如果五次之后还是失败，那是配额用尽而不是被限流——重跑前先查一下这个 key 的档位。",
    },
  },
  {
    id: "token-column",
    severity: "note",
    symptom: {
      en: "The Tokens column looks too small to be a running total",
      zh: "Tokens 那一列小得不像是累计值",
    },
    cause: {
      en: "It is per record, not cumulative: `_prompt_tokens` is reset to 0 at `visualize.py:1433` at the top of each iteration.",
      zh: "它是逐条的，不是累计的：`_prompt_tokens` 在 `visualize.py:1433` 每轮迭代开头被重置为 0。",
    },
    action: {
      en: "Sum the column to get a run total. Samuel's were 2,232,741 tokens for TriviaQA and 2,109,424 for SQuAD — use those to price your own run against current flash rates.",
      zh: "把这一列求和就是整次运行的总量。Samuel 的是 TriviaQA 2,232,741、SQuAD 2,109,424——按当前 flash 价目用这两个数给自己的运行估价。",
    },
  },
] as const;

/**
 * What the repository cannot tell you.
 *
 * Listed explicitly so that the gaps are visible as questions rather than
 * silently guessed at during the write-up.
 */
export const UNKNOWNS: readonly Bilingual[] = [
  {
    en: "Why the SQuAD summary has 159 rows when its input JSON holds 256 records. The file count matches the row count, so the summary looks self-consistent, but a run over the committed input should have produced 256 rows.",
    zh: "为什么 SQuAD 汇总有 159 行，而它的输入 JSON 有 256 条记录。文件数和行数对得上，所以汇总看起来自洽，但对着已提交的输入跑应该产出 256 行。",
  },
  {
    en: "Which snapshot of `gemini-2.5-flash` produced the committed reports, and on what dates. Neither the summary pages nor the commit messages record it, so model drift cannot be separated from your own setup.",
    zh: "已提交报告是哪个 `gemini-2.5-flash` 快照、在什么日期跑出来的。汇总页和 commit message 都没记录，所以模型漂移和你自己的环境差异分不开。",
  },
  {
    en: "Whether the duplicate SQuAD ids were intended as separate records or are a merge artifact from combining several UR-RAG runs. The `run` field suggests the latter, but only Samuel can confirm.",
    zh: "SQuAD 里重复的 id 是有意作为独立记录，还是合并多次 UR-RAG 运行时的产物。`run` 字段暗示是后者，但只有 Samuel 能确认。",
  },
  {
    en: "Whether the committed `output_heatmaps_*` directories are from a single uninterrupted run or accumulated across several. Because an existing report suppresses re-scoring, an accumulated directory would carry labels from different points in development.",
    zh: "已提交的 `output_heatmaps_*` 目录是一次不间断运行的产物，还是多次累积的。由于已存在的报告会抑制重新打分，累积出来的目录里会混着开发过程中不同时间点的标签。",
  },
] as const;

/** The one rule that makes the week's output usable. */
export const DISCIPLINE = {
  title: { en: "Do not fix anything this week", zh: "这一周什么都别修" },
  body: {
    en: "You already know about the extraction defect, the duplicate-id overwrite and the score scraping. Touching any of them before the reproduction is complete means no later difference can be attributed: you will not be able to tell whether a number moved because of your change, your environment, your API key or model drift. Reproduce first, then change one thing at a time. And when the extraction defect is eventually fixed, every published number has to be regenerated — that is a new experiment, not a patch, and whether to spend the semester on it is the advisor's call rather than yours.",
    zh: "抽取缺陷、重复 id 覆盖、分数复用，这三件你都已经知道了。在复现完成之前动其中任何一个，之后的差异就归因不了：你分不清某个数字变化是因为你的改动、你的环境、你的 API key，还是模型漂移。先复现，再一次只改一件事。而且抽取缺陷一旦修好，所有已发表的数字都得重新生成——那是一次新实验而不是打补丁，要不要把这个学期投进去，是导师的决定，不是你的。",
  },
} as const;
