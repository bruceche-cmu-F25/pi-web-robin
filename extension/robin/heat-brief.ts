import type { Bilingual } from "./research.ts";

/**
 * The takeover briefing: what costs you the most if you don't know it.
 *
 * This is the fourth document about HEAT and the only one written in the
 * second person, because it answers a different question from the other three.
 * The stack says what a term means. The walkthrough says what line 231 does.
 * The report says what is true about the project. None of them says "you will
 * lose a week to this on Tuesday."
 *
 * Everything here is ordered by the cost of not knowing it, not by topic. That
 * is the only ordering that helps someone with a semester in front of them and
 * no idea which of a hundred facts are load-bearing.
 */

export const BRIEF_META = {
  title: { en: "If you are taking this over", zh: "接手简报" },
  subtitle: {
    en: "Ordered by what it costs you not to know",
    zh: "按“不知道的代价”排序",
  },
  written: "2026-08-29",
  readingOrder: {
    en: "Read this first, then the report for provenance, the stack when a term is unfamiliar, and the walkthrough beside the file. This one is the only one you have to read before touching anything.",
    zh: "先读这份，再读报告了解来龙去脉，遇到不认识的名词查词表，改代码时对着逐行导读。四份里只有这份必须在动手之前读完。",
  },
} as const;

/** The single fact that reorganises everything else. */
export const HEADLINE = {
  title: {
    en: "Every number in this project came from a broken code path",
    zh: "这个项目的每一个数字都来自一条坏掉的代码路径",
  },
  body: {
    en: "Atomic-fact extraction has never run. A string cleaner strips the list markers the fact parser looks for, so every \"fact\" in all 359 committed reports is a whole sentence. Fact-level granularity is the project's stated advance over SelfCheckGPT and it is absent from every artifact. Because main answers therefore carry one fact each, the Hungarian matching step has never executed either. Fixing it is an hour; what follows is a new experiment, not a patch, because every published number has to be regenerated.",
    zh: "原子事实抽取从未生效。一个字符串清洗函数把 fact 解析器要找的列表符号删掉了，所以全部 359 份已提交报告里每一条 “fact” 都是一整句话。fact 级粒度是这个项目相对 SelfCheckGPT 声称的进步，而它在任何产物里都不存在。又因为 main answer 因此每次只有一条 fact，匈牙利匹配那一步同样从未执行过。修复只要一小时；但接下来是一次新实验而不是打补丁，因为所有已发表的数字都得重新生成。",
  },
  soWhat: {
    en: "Do not build on the existing numbers, do not quote them in a meeting without the caveat, and do not plan a semester that assumes the baseline is established. Re-establishing it is your first deliverable.",
    zh: "不要在现有数字上继续盖楼，不要在会上不加限定地引用它们，也不要按“基线已经建立”来规划学期。重建基线就是你的第一个交付物。",
  },
} as const;

export const TRUST_LEVELS = ["trust", "check", "wrong"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface TrustRow {
  id: string;
  item: Bilingual;
  verdict: TrustLevel;
  why: Bilingual;
}

/**
 * What in the repository can be believed.
 *
 * A takeover's most expensive mistake is trusting the wrong artifact, so this
 * is deliberately blunt: three verdicts, no shading. `check` is the dangerous
 * middle — things that are probably right and would be embarrassing to be
 * wrong about in a meeting.
 */
export const TRUST_MAP: readonly TrustRow[] = [
  {
    id: "heatmaps",
    verdict: "trust",
    item: { en: "The 359 generated HTML reports, as artifacts", zh: "359 份生成的 HTML 报告，作为产物" },
    why: {
      en: "They faithfully record what the pipeline did, including the intermediate matrices. They are the reason the extraction defect was findable at all. What they record is just not what the report claims it is.",
      zh: "它们忠实记录了流水线实际做了什么，包括中间矩阵——抽取缺陷能被发现全靠它们。只是它们记录的东西和报告声称的不是一回事。",
    },
  },
  {
    id: "code-behaviour",
    verdict: "trust",
    item: { en: "visualize.py as a description of what runs", zh: "visualize.py 作为“实际在跑什么”的描述" },
    why: {
      en: "The code is honest about itself. Where it and the report disagree, the code is right.",
      zh: "代码对自己是诚实的。代码和报告不一致的地方，以代码为准。",
    },
  },
  {
    id: "triviaqa-signal",
    verdict: "trust",
    item: { en: "The TriviaQA result direction", zh: "TriviaQA 上的结论方向" },
    why: {
      en: "ROC-AUC 0.900 with positives at 0.838 mean support against negatives at 0.232. Threshold-free and baseline-relative, so it survives every methodological criticism below. The magnitude will move after the fix; the direction is real.",
      zh: "ROC-AUC 0.900，正类平均 support 0.838、负类 0.232。既与阈值无关又相对基线，所以下面所有方法论批评都撼动不了它。修复后数值会变，但方向是真的。",
    },
  },
  {
    id: "labels",
    verdict: "check",
    item: { en: "The Prometheus labels stored in the reports", zh: "报告里存着的 Prometheus 标签" },
    why: {
      en: "The pipeline scrapes an existing report's score instead of re-scoring. If the rubric changed during development without the output directory being cleared, some labels predate the prompt that supposedly produced them. Re-score a random sample against a cleared directory before trusting them — an afternoon.",
      zh: "流水线会从已存在的报告里抠出旧分数复用而不是重新打分。如果开发期间改过 rubric 却没清空输出目录，部分标签比据称产生它们的提示词还旧。清空目录后抽样重打分核对再信——一个下午的事。",
    },
  },
  {
    id: "denominators",
    verdict: "check",
    item: { en: "Any n quoted in the previous report", zh: "上一份报告里引用的任何 n" },
    why: {
      en: "It writes 164/199 on one page and 164/198 on another. The generated summary page's totals row is the source of truth: 164 of 199 on TriviaQA, 111 of 158 on SQuAD.",
      zh: "它一页写 164/199，另一页写 164/198。以生成的汇总页那一行合计为准：TriviaQA 164/199，SQuAD 111/158。",
    },
  },
  {
    id: "readme-squad",
    verdict: "wrong",
    item: { en: "The README's sentence about SQuAD class imbalance", zh: "README 里关于 SQuAD 类别不平衡那句话" },
    why: {
      en: "It says imbalance \"inflates raw agreement\". The direction is reversed: the majority baseline is 83.5% and HEAT scores 70.3%, thirteen points below always answering \"hallucination\". Correct this before anyone else reads it.",
      zh: "它说不平衡“让一致率虚高”。方向反了：多数类基线 83.5%，HEAT 70.3%，比“永远说是幻觉”还低十三个百分点。在别人读到之前先改掉。",
    },
  },
  {
    id: "granularity-claim",
    verdict: "wrong",
    item: { en: "Any claim that HEAT scores at the fact level", zh: "任何“HEAT 在 fact 级别打分”的说法" },
    why: {
      en: "385 of 385 main-answer sentences produced exactly one fact across all 359 reports. Every fact is a sentence.",
      zh: "全部 359 份报告里，main answer 的 385 个句子有 385 个只产出一条 fact。每一条 fact 都是一个句子。",
    },
  },
  {
    id: "in-sample",
    verdict: "wrong",
    item: { en: "Reported accuracy as an estimate of future performance", zh: "把报告的准确率当作对未来表现的估计" },
    why: {
      en: "The threshold is fitted on all records and accuracy reported on the same records. No split exists anywhere in the file.",
      zh: "阈值在全部记录上拟合，准确率又在同一批记录上报出。文件里任何地方都没有划分。",
    },
  },
];

export interface Bite {
  id: string;
  /** What you actually see, not what is wrong — you meet the symptom first. */
  symptom: Bilingual;
  cause: Bilingual;
  ref: string;
  fix: Bilingual;
}

/**
 * The things that will cost you an afternoon each, in the order you will meet
 * them. Written symptom-first on purpose: you will not be looking for "the
 * output directory is misspelled", you will be looking for "where did my
 * results go".
 */
export const BITES: readonly Bite[] = [
  {
    id: "output-dir",
    symptom: { en: "You run it and cannot find the output", zh: "跑完了，找不到输出在哪" },
    cause: {
      en: "The output directory is hard-coded as `output_heatmaps_incorretacalibrated` — a typo, and neither what the README says nor what either committed directory is called. Both of those were renamed by hand after the fact.",
      zh: "输出目录硬编码成 `output_heatmaps_incorretacalibrated`——拼错的，而且既不是 README 写的名字，也不是仓库里那两个目录的名字。那两个都是事后手工改名的。",
    },
    ref: "visualize.py:1368",
    fix: { en: "Make it a CLI argument in week 1.", zh: "第一周就把它变成命令行参数。" },
  },
  {
    id: "stale-labels",
    symptom: {
      en: "You change the judge prompt, rerun, and nothing about the labels changes",
      zh: "你改了 judge 的提示词，重跑，标签一点没变",
    },
    cause: {
      en: "If a record's HTML already exists, the judge score is regex-scraped out of the old file instead of recomputed. Reruns are not idempotent.",
      zh: "如果某条记录的 HTML 已存在，judge 分数会用正则从旧文件里抠出来复用，而不是重新计算。重跑不是幂等的。",
    },
    ref: "visualize.py:1444",
    fix: {
      en: "`rm -rf` the output directory before any run you intend to trust, and add a `--fresh` flag so you stop having to remember.",
      zh: "任何你打算相信的跑批之前先 `rm -rf` 输出目录，并加一个 `--fresh` 参数，省得每次都要记着。",
    },
  },
  {
    id: "403",
    symptom: { en: "A bad API key takes 62 seconds to tell you it is bad", zh: "错的 API key 要等 62 秒才告诉你它是错的" },
    cause: {
      en: "403 sits in the retry set next to 429 and 5xx, so an auth failure backs off 2, 4, 8, 16, 32 seconds before surfacing.",
      zh: "403 和 429、5xx 并列在可重试集合里，所以鉴权失败会先退避 2、4、8、16、32 秒才报出来。",
    },
    ref: "visualize.py:139",
    fix: { en: "Delete `403` from that list. One token, biggest return in the file.", zh: "把 `403` 从那个列表里删掉。一个字符，全文件性价比最高的一处。" },
  },
  {
    id: "silent-crash",
    symptom: { en: "A batch run says a record failed and nothing about where", zh: "批跑说某条失败了，但不告诉你失败在哪" },
    cause: {
      en: "Each record is wrapped in a bare `except Exception` that prints the message but stores only the exception class name, with no traceback.",
      zh: "每条记录被裸 `except Exception` 包住，打印消息但只存异常类名，没有堆栈。",
    },
    ref: "visualize.py:1589",
    fix: { en: "Add `traceback.print_exc()` and keep the message on the record. Two lines.", zh: "加一行 `traceback.print_exc()`，并把消息一并存进记录。两行。" },
  },
  {
    id: "no-checkpoint",
    symptom: {
      en: "Record 300 of 359 crashes and you have 300 heatmaps and no summary at all",
      zh: "第 359 条里第 300 条崩了，你有 300 张热力图和零张汇总页",
    },
    cause: {
      en: "Calibration and the summary page run only after every record completes. Nothing is checkpointed along the way.",
      zh: "校准和汇总页只在所有记录跑完之后才执行，中途什么都不落盘。",
    },
    ref: "visualize.py:1600",
    fix: {
      en: "Append each `record_summary` to a JSONL as you go. A long run becomes resumable and a crash stops costing you the whole run.",
      zh: "边跑边把每条 `record_summary` 追加到一个 JSONL 里。长跑就能续跑，崩一次也不再赔掉整轮。",
    },
  },
  {
    id: "cost-explosion",
    symptom: {
      en: "You fix extraction, rerun, and the token bill is several times what you budgeted",
      zh: "你修好抽取、重跑，token 账单是预算的好几倍",
    },
    cause: {
      en: "`evaluate_facts_with_llm` makes one API call per fact and is display-only — it feeds the HTML and no headline metric. With extraction working, facts go from one per sentence to four or five, so that step multiplies accordingly.",
      zh: "`evaluate_facts_with_llm` 是每条 fact 一次 API 调用，而且纯展示——只喂 HTML，不进任何主指标。抽取修好后 fact 从每句 1 条变成 4–5 条，这一步就等比例翻倍。",
    },
    ref: "visualize.py:543",
    fix: {
      en: "Add a `--no-gold-eval` flag and turn it off for every run whose purpose is metrics rather than a readable report.",
      zh: "加一个 `--no-gold-eval`，凡是为了指标而不是为了可读报告的跑批一律关掉它。",
    },
  },
];

export interface InputFact {
  id: string;
  field: string;
  triviaqa: Bilingual;
  squad: Bilingual;
  why: Bilingual;
}

/**
 * What is actually inside the two input files.
 *
 * This is the section that is in no other document and the one most likely to
 * change what you plan, because two of these rows invert assumptions that the
 * handoff and the previous report both left standing.
 */
export const INPUTS: readonly InputFact[] = [
  {
    id: "evidence",
    field: "retrieved_chunks / doc_preview",
    triviaqa: {
      en: "10 full documents. Median 155,000 characters per record, max 819,000.",
      zh: "10 篇全文。每条记录中位 15.5 万字符，最大 82 万。",
    },
    squad: {
      en: "3 passages under a different key, about 2,000 characters total.",
      zh: "另一个字段名下的 3 段，总共约 2000 字符。",
    },
    why: {
      en: "Both datasets carry retrieval evidence, which the pipeline never reads — this is the external signal self-consistency structurally cannot provide. But the shapes invert the obvious plan: SQuAD's fits straight into an NLI premise, while TriviaQA's needs chunking and passage selection first. Build the evidence axis on SQuAD, not TriviaQA.",
      zh: "两个数据集都带检索证据，而流水线从没读过——这正是 self-consistency 在原理上给不了的外部信号。但形态和直觉相反：SQuAD 的可以直接塞进 NLI 前提，TriviaQA 的得先切段选段。证据轴先在 SQuAD 上做，不是 TriviaQA。",
    },
  },
  {
    id: "baselines",
    field: "semantic_entropy / unified_risk",
    triviaqa: {
      en: "semantic_entropy on all 200, mean 0.525, range 0 to 2.08 — healthy variance.",
      zh: "200 条全有 semantic_entropy，均值 0.525，范围 0–2.08，方差健康。",
    },
    squad: {
      en: "semantic_entropy plus unified_risk, support_score, evidence_f1 on all 256.",
      zh: "256 条全有 semantic_entropy，外加 unified_risk、support_score、evidence_f1。",
    },
    why: {
      en: "HEAT has never been compared against the upstream system's own uncertainty signals, even though they are sitting in the input file. \"How does your score beat semantic entropy\" is the first question a reviewer asks, and answering it costs zero API calls. Do this in week 2, before you have API access.",
      zh: "HEAT 从来没和上游系统自己的不确定性信号比过，尽管它们就躺在输入文件里。“你的分数比 semantic entropy 强在哪”是审稿人问的第一个问题，而回答它零 API 成本。第二周就做，在拿到 API 权限之前。",
    },
  },
  {
    id: "second-label",
    field: "answer_f1",
    triviaqa: { en: "Absent.", zh: "没有。" },
    squad: { en: "Present on all 256. Token-overlap F1 against the gold answer.", zh: "256 条全有。对标准答案的词重叠 F1。" },
    why: {
      en: "A correctness measure that is not an LLM's opinion. Every metric this project reports is agreement with a Prometheus-style judge, and nobody has checked that judge against anything. Cross-checking the labels against answer_f1 partially closes that gap for one dataset, cheaply.",
      zh: "一个不是 LLM 意见的正确性度量。这个项目报的每个指标都是与 Prometheus judge 的一致性，而没人检验过这个 judge。用 answer_f1 交叉验证标签，能在一个数据集上低成本地部分关上这个缺口。",
    },
  },
  {
    id: "refusals",
    field: "pred_answer",
    triviaqa: { en: "Ordinary short answers.", zh: "普通短答案。" },
    squad: {
      en: "40 of 256 are refusals — \"the provided context does not mention...\".",
      zh: "256 条里有 40 条是拒答——“所给上下文没有提到……”。",
    },
    why: {
      en: "A closed-book sampler given only the question will never reproduce a refusal, so those records score near-zero support no matter how correct the refusal was. That is 16% of SQuAD structurally guaranteed to look like hallucination.",
      zh: "只拿到问题的闭卷采样器永远复现不出拒答，所以这些记录无论拒答多正确，support 都接近 0。这是 SQuAD 里 16% 在结构上注定被判成幻觉的样本。",
    },
  },
];

export interface Person {
  id: string;
  who: Bilingual;
  holds: Bilingual;
  ask: readonly Bilingual[];
}

/**
 * Who holds what you cannot get from the repository.
 *
 * Two of these people have things that are not written down anywhere, and the
 * cost of not asking compounds: Phase II's code and UR-RAG's internals both
 * get harder to obtain the further into the term you are.
 */
export const PEOPLE: readonly Person[] = [
  {
    id: "farag",
    who: { en: "Dr. Mohamed Farag — faculty advisor", zh: "Dr. Mohamed Farag —— 指导老师" },
    holds: {
      en: "The direction. His one-sentence instruction — \"continue evaluating the use of visualization techniques in hallucination mitigation\" — deliberately does not name a research question, which means the question is a decision, not a given.",
      zh: "方向。他那句唯一的指示——“继续评估可视化技术在幻觉缓解中的作用”——刻意没有指定研究问题，意味着问题本身是一个待定的决定，不是既定条件。",
    },
    ask: [
      { en: "Is the internal-states line still on the agenda, or did it end with Phase II? The report's title still promises it and Phase III uses none.", zh: "内部状态那条线还在议程上吗，还是随 Phase II 结束了？报告标题还在承诺它，而 Phase III 一处都没用。" },
      { en: "What shape is the semester's deliverable — a report, a prototype, or a paper submission?", zh: "这学期的交付是什么形状——报告、原型，还是投稿？" },
      { en: "Given the extraction defect, does re-establishing the baseline count as this term's work or as clearing the ground before it?", zh: "考虑到抽取缺陷，重建基线算作本学期的工作，还是算作开始之前的清场？" },
      { en: "What is the API budget, and does it survive several full re-runs?", zh: "API 额度是多少，够不够几次全量重跑？" },
    ],
  },
  {
    id: "senior",
    who: { en: "The senior researcher — most likely Satyam Mittal, UR-RAG's author", zh: "那位 senior researcher —— 很可能是 UR-RAG 的作者 Satyam Mittal" },
    holds: {
      en: "Everything upstream: how the gray-zone slice was cut, what the retrieval fields actually are, and the project history — what was tried and abandoned before you arrived. He is described as having spent a significant number of hours on this.",
      zh: "上游的一切：gray-zone 子集怎么切的、检索字段到底是什么，以及项目史——你来之前试过什么、又为什么放弃。据说他在这个项目上投入了大量时间。",
    },
    ask: [
      { en: "Do you have a passage-level version of the TriviaQA retrieved_chunks? Those are 155,000-character full documents, and chunking them is a week I would rather not spend.", zh: "TriviaQA 的 retrieved_chunks 有没有段落级的版本？那是 15.5 万字符的全文，自己切段要花掉一周，能省则省。" },
      { en: "How was the gray-zone slice cut, and can I get the accept/reject cases too? Without them there is no way to say whether HEAT helps on the full distribution.", zh: "gray-zone 是怎么切出来的？能不能也拿到被接受/被拒绝的那部分？没有它们就无法判断 HEAT 在完整分布上是否有用。" },
      { en: "Are unified_risk and semantic_entropy in the input files comparable across the two datasets, or computed differently?", zh: "输入文件里的 unified_risk 和 semantic_entropy 在两个数据集之间可比吗，还是算法不同？" },
    ],
  },
  {
    id: "samuel",
    who: { en: "Samuel — the previous student", zh: "Samuel —— 前一位学生" },
    holds: {
      en: "The Phase II code — INSIDE with EigenScore on SmolLM2-1.7B — which is not in this repository. Also the answer to whether the judge rubric changed mid-development, which decides whether the stored labels can be trusted.",
      zh: "Phase II 的代码——在 SmolLM2-1.7B 上跑的 INSIDE + EigenScore——不在这个仓库里。另外还有一个答案：judge 的 rubric 在开发中途改过没有，这决定了已存标签能不能信。",
    },
    ask: [
      { en: "Where is the Phase II code? If white-box ever comes back on the agenda, rebuilding it from the report would be weeks.", zh: "Phase II 的代码在哪？如果白盒方向哪天回到议程上，照着报告重写要好几周。" },
      { en: "Did the Prometheus rubric change while you were generating the committed reports?", zh: "你生成那些已提交报告的过程中，Prometheus 的 rubric 改过吗？" },
    ],
  },
  {
    id: "neslihan",
    who: { en: "Neslihan Ozdoganlar — academic advisor", zh: "Neslihan Ozdoganlar —— 学业导师" },
    holds: { en: "The administrative frame: units, deliverable requirements, deadlines.", zh: "行政框架：学分、交付要求、截止日期。" },
    ask: [
      { en: "What formally distinguishes 6 units from 12 here, and is there a learning contract?", zh: "这门课 6 学分和 12 学分在正式要求上的区别是什么？有没有 learning contract？" },
      { en: "When is the add/drop deadline — can units be raised later, or only lowered?", zh: "add/drop 截止日是什么时候——学分之后能加吗，还是只能减？" },
    ],
  },
];

export interface FirstWeekItem {
  id: string;
  hours: number;
  what: Bilingual;
  why: Bilingual;
}

/**
 * Week one, ordered by value rather than by convenience.
 *
 * The live reproduction is placed above getting the pipeline running end to
 * end on purpose. Reproducing the defect yourself converts a claim you
 * inherited into a fact you own, and you will be defending it in a meeting.
 */
export const FIRST_WEEK: readonly FirstWeekItem[] = [
  {
    id: "meeting-senior",
    hours: 2,
    what: { en: "Meet the senior researcher", zh: "见 senior researcher" },
    why: {
      en: "The fastest route to the project's undocumented history, and the only source for the passage-level retrieval question that decides several weeks of work later.",
      zh: "了解项目未成文历史最快的路径，也是那个“段落级检索”问题的唯一来源——它决定后面好几周的工作量。",
    },
  },
  {
    id: "live-repro",
    hours: 1,
    what: {
      en: "Reproduce the extraction defect live: print the raw model reply before :169 cleans it",
      zh: "活体复现抽取缺陷：在 :169 清洗之前把模型原始回复打出来",
    },
    why: {
      en: "The highest-value hour of the semester. It turns \"I read that it is broken\" into \"I watched it happen\", which is the difference between reporting someone else's finding and owning yours.",
      zh: "整个学期性价比最高的一小时。它把“我读到它是坏的”变成“我看着它发生”——这是转述别人的发现和拥有自己的发现之间的差别。",
    },
  },
  {
    id: "run-five",
    hours: 2,
    what: { en: "Get the API key and run five records against a cleared output directory", zh: "拿到 API key，清空输出目录后跑五条记录" },
    why: {
      en: "Confirms your environment before anything depends on it. The first run also downloads NLTK data and ~1.6 GB of NLI weights, so it is slower than every run after it.",
      zh: "在任何东西依赖它之前先确认环境可用。首次运行还会下载 NLTK 数据和约 1.6 GB 的 NLI 权重，比之后每一次都慢。",
    },
  },
  {
    id: "meeting-farag",
    hours: 2,
    what: { en: "Meet Farag — present findings, ask the four questions, do not announce a direction", zh: "见 Farag —— 汇报发现、问那四个问题、不要宣布方向" },
    why: {
      en: "The direction is his to set and the instruction was deliberately open. Arriving with a decision instead of a finding wastes the one meeting where the scope is still negotiable.",
      zh: "方向由他定，而且那句指示是刻意留白的。带着结论而不是带着发现去，会浪费掉唯一一次范围还可谈的会。",
    },
  },
  {
    id: "memo",
    hours: 2,
    what: { en: "Write a one-page state-of-the-project memo", zh: "写一页 state-of-project memo" },
    why: {
      en: "Forces you to state the defect in language you can defend, and gives both advisors something to react to that is shorter than a report.",
      zh: "逼你用自己守得住的语言把缺陷讲清楚，同时给两位导师一个比报告短、可以直接回应的东西。",
    },
  },
];

/**
 * The practices whose absence caused everything else.
 *
 * Worth stating separately because they are the transferable part: the errors
 * in this project were not errors of intelligence, they were the ordinary
 * result of nothing forcing a check.
 */
export const HABITS: readonly Bilingual[] = [
  {
    en: "Print the shape of the output on every run: facts per sentence, alternatives that produced facts, positive base rate. One `Counter` would have caught the defect that cost this project its headline claim.",
    zh: "每次跑批都打印输出的形状：每句几条 fact、有几个 alternative 产出了 fact、正类基准率。一行 `Counter` 就能抓住那个让这个项目失去核心主张的缺陷。",
  },
  {
    en: "Never report an accuracy without the base rate and the majority baseline beside it. The SQuAD result was written up as a success for exactly this reason.",
    zh: "报准确率永远同时报基准率和多数类基线。SQuAD 那个结果被写成正面结论，就是因为少了这两个数。",
  },
  {
    en: "Keep a run log: one config hash, one line of what you found. This pipeline caches judge scores silently, so without a log you will not be able to tell which number came from which version of the prompt.",
    zh: "记跑批日志：一个 config hash，一行结论。这条流水线会静默复用 judge 分数，没有日志你分不清哪个数字来自哪一版提示词。",
  },
  {
    en: "Write one page a week — what you found, what you are blocked on, what is next. Not for the advisor. The failure mode here was never wrong thinking, it was that nothing forced a look back.",
    zh: "每周写一页——发现了什么、被什么卡住、下周做什么。不是给导师看的。这个项目的失效从来不是想错了，而是没有任何机制逼人回头看。",
  },
  {
    en: "When the code and the write-up disagree, the code is right. That rule would have resolved most of what is in this document.",
    zh: "代码和文字不一致时，以代码为准。这条规则本可以解决这份文档里的大部分内容。",
  },
];
