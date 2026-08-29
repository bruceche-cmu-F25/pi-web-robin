import type { Bilingual } from "./research.ts";

/**
 * The takeover report: how HEAT got to where it is, and what is actually true.
 *
 * The other two documents answer local questions — the stack says what a term
 * means, the walkthrough says what line 231 does. Neither answers the question
 * you have to be able to answer in a meeting: why does this project look like
 * this, and which of its claims survive contact with the artifacts?
 *
 * Three parts, and the split is deliberate:
 *
 *   REPORT       the narrative — provenance, method, results, what the
 *                takeover check found
 *   CLAIM_LEDGER every claim the project makes, with a status and the one
 *                thing that decides it
 *   REPRODUCTION the checks, as commands, so the ledger is auditable rather
 *                than assertable
 *
 * The ledger is the part that matters most. A handover that is only prose
 * quietly launders assertions into facts: read three pages of confident
 * writing and you inherit the confidence along with the content. Separating
 * "established" from "asserted but untested" from "refuted" is the single
 * most useful thing this document does, and it is also the thing that makes
 * it safe to disagree with — each row names what would change its status.
 */

export interface ReportSection {
  id: string;
  /** Printed as the section number; the report is meant to be cited from. */
  number: number;
  heading: Bilingual;
  body: readonly Bilingual[];
  /** Marks a section that carries a finding rather than background. */
  finding?: boolean;
}

export const REPORT_META = {
  title: { en: "HEAT: where the project stands", zh: "HEAT：这个项目现在的状态" },
  subtitle: {
    en: "A takeover report — provenance, method, results, and what the artifacts actually support",
    zh: "接手报告 —— 来历、方法、结果，以及产物真正支持的结论",
  },
  written: "2026-08-28",
  scope: {
    en: "Written from the repository at ~/heat, the 359 generated reports it contains, and the handoff document. Every number below is either read off a generated summary page or recomputed from one; where a claim rests on reading code rather than running it, the text says so.",
    zh: "依据是 ~/heat 仓库、它包含的 359 份已生成报告，以及接手文档。下面每个数字要么直接读自生成的汇总页，要么从汇总页复算得到；凡是靠读代码而不是靠运行得出的结论，正文都会写明。",
  },
} as const;

export const REPORT: readonly ReportSection[] = [
  {
    id: "what",
    number: 1,
    heading: { en: "What the project is", zh: "这是个什么项目" },
    body: [
      {
        en: "HEAT is a hallucination detector that needs nothing from the model except the ability to ask it the same question repeatedly. It samples ten answers, breaks them into claims, uses a natural-language-inference model to ask how far the samples support one another, and paints the resulting number back onto the original text as a colour. Green means the model said the same thing ten times; red means it did not.",
        zh: "HEAT 是一个幻觉检测器，它对模型的唯一要求是“能对同一个问题反复提问”。它采样十个回答，把回答拆成断言，用自然语言推理模型判断这些采样互相支持到什么程度，再把得到的数值作为颜色涂回原文。绿色表示模型十次说的是同一件事，红色表示不是。",
      },
      {
        en: "It is a CMU independent study, run by one student at a time under Dr. Mohamed Farag. The previous student handed it over in April 2026 with a twelve-page report and this repository; the instruction for the next phase is one sentence — \"continue evaluating the use of visualization techniques in hallucination mitigation\" — and it deliberately does not name a research question.",
        zh: "它是 CMU 的一门独立研究课，每次由一名学生负责，指导老师是 Dr. Mohamed Farag。上一位学生在 2026 年 4 月交接，留下一份十二页报告和这个仓库；下一阶段的指示只有一句话——“继续评估可视化技术在幻觉缓解中的作用”——而且它刻意没有指定具体的研究问题。",
      },
      {
        en: "One framing point worth being able to say out loud: the umbrella project is called hallucination mitigation, but HEAT does not mitigate anything. It does not touch decoding and it does not make the model wrong less often. It detects, scores, localizes and displays. That is a sub-branch, and knowing you are in it prevents a whole class of misunderstanding in meetings.",
        zh: "有一点框架上的区分值得练到能随口说清：整个大项目叫 hallucination mitigation，但 HEAT 并不缓解任何东西。它不碰解码过程，也不让模型少犯错。它做的是 detect / score / localize / visualize。这是其中的一个分支，清楚自己在哪个分支上，能避免会议上一整类误解。",
      },
    ],
  },
  {
    id: "phases",
    number: 2,
    heading: { en: "Three phases, and a change of direction", zh: "三个阶段，以及一次方向转变" },
    body: [
      {
        en: "Phase I was a survey: SelfCheckGPT, HaluEval, INSIDE, Semantic Entropy, DoLa. Phase II implemented the white-box line from that survey — INSIDE with EigenScore, on SmolLM2-1.7B-Instruct, ten samples, reading hidden states from a middle layer and taking the eigen-spectrum of their covariance. It worked. Phase III threw the approach away and built HEAT, which touches no hidden state at all.",
        zh: "Phase I 是文献调研：SelfCheckGPT、HaluEval、INSIDE、Semantic Entropy、DoLa。Phase II 实现了其中的白盒路线——在 SmolLM2-1.7B-Instruct 上跑 INSIDE + EigenScore，十次采样，取中间层的 hidden state，对其协方差矩阵求特征谱。它跑通了。Phase III 把这条路线整个放下，转而做了 HEAT，而 HEAT 完全不碰 hidden state。",
      },
      {
        en: "The reason for the turn is stated plainly in the previous report and is the strongest argument the project has. White-box methods need hidden states or logits, and the models that real systems ship on — GPT, Claude, Gemini — give you neither. A detector that only works on models nobody deploys is a paper, not a tool. Phase II also found the second limitation first-hand: EigenScore produces one number for the whole answer, so it can tell you an answer is shaky and never tell you which part.",
        zh: "转向的理由在上一份报告里写得很直白，也是这个项目最强的论据。白盒方法需要 hidden states 或 logits，而真实系统跑的模型——GPT、Claude、Gemini——两样都不给。一个只能用在没人部署的模型上的检测器，是论文而不是工具。Phase II 还亲身验证了第二个限制：EigenScore 只能给出整个回答一个分数，它能告诉你这个回答不稳，却永远说不出是哪一部分不稳。",
      },
      {
        en: "So HEAT is a direct answer to two limitations its own author ran into: make it black-box, and make it point at something. Those two commitments explain nearly every design decision in the file.",
        zh: "所以 HEAT 是对作者自己撞上的两个限制的直接回应：做成黑盒，并且能指出具体位置。这两条承诺几乎解释了这个文件里的每一个设计决策。",
      },
    ],
  },
  {
    id: "drift",
    number: 3,
    heading: { en: "Two drifts between the title and the artifact", zh: "标题与产物之间的两处漂移" },
    body: [
      {
        en: "The previous report is titled \"Detecting Hallucinations in AI Systems Through Visualization Techniques of Internal States in Non-RAG Contexts\". Both italicised phrases have come loose from what was built, and both are worth raising rather than quietly inheriting.",
        zh: "上一份报告的标题是《Detecting Hallucinations in AI Systems Through Visualization Techniques of **Internal States** in **Non-RAG Contexts**》。加粗的两个短语都已经和实际做出来的东西脱节，两处都值得提出来讨论，而不是默默继承下来。",
      },
      {
        en: "\"Internal states\" is a Phase I/II leftover. Phase III uses none. That is not a mistake, but it does mean the branch you have inherited is the black-box one, and if the advisor still cares about internal states, that is a different project with different hardware requirements. Worth settling in the first meeting rather than the fifth.",
        zh: "“Internal states” 是 Phase I/II 的遗留。Phase III 一处都没用到。这本身不是错误，但它意味着你继承的是黑盒那一支；如果导师仍然看重内部状态，那是另一个项目，硬件要求也不同。这件事值得在第一次会上定，而不是第五次。",
      },
      {
        en: "\"Non-RAG\" is the more consequential one. The nine alternatives are generated closed-book, from the question alone — genuinely non-RAG, and a deliberate choice. But the main answer being scored is `pred_answer`, lifted straight from an upstream RAG system that had retrieved documents in front of it. So a non-RAG consistency check is being applied to a RAG-produced answer. Nothing in the pipeline is wrong on its own terms; the two halves are simply drawn from different distributions, and no one has written down what that does to the numbers.",
        zh: "“Non-RAG” 这一处影响更大。九个 alternative 确实是闭卷生成的，只拿到问题——名副其实的 non-RAG，而且是刻意的选择。但被打分的 main answer 是 `pred_answer`，直接取自一个看过检索文档的上游 RAG 系统。于是一个 non-RAG 的一致性检验，被用在了一个 RAG 产出的答案上。流水线的每一步就其自身而言都没错，只是这两半来自不同的分布，而这对结果意味着什么，从来没有人写下来过。",
      },
    ],
  },
  {
    id: "gaps",
    number: 4,
    heading: { en: "The three gaps HEAT was built to close", zh: "HEAT 想关上的三个缺口" },
    body: [
      {
        en: "First, white-box methods are unusable on closed models — answered by using nothing but repeated sampling. Second, existing black-box scores are coarse: SelfCheckGPT gives a sentence or a passage one number, so a reader is told to be nervous without being told where. HEAT's answer was to decompose into atomic facts. Third, a score is not a decision aid; HEAT's answer was to map the score back onto the text as colour.",
        zh: "第一，白盒方法在闭源模型上用不了——回应是只依赖重复采样。第二，已有的黑盒分数粒度太粗：SelfCheckGPT 给一句或一段一个数，读者被告知要紧张，却不知道该紧张哪里——HEAT 的回应是拆成原子事实。第三，一个分数本身不构成决策辅助——HEAT 的回应是把分数作为颜色映射回原文。",
      },
      {
        en: "The third answer is also the project's defensible research position, and it is worth stating carefully because it sounds like packaging and is not. The same 0.42 spread across a paragraph and highlighted on the three characters \"1992\" carry different decision value. Localizing uncertainty and communicating it are part of the method, not a front end for it. That is the sentence to have ready when someone asks why a hallucination project is spending its time on HTML.",
        zh: "第三条回应也是这个项目在研究上站得住的立场，值得仔细表述，因为它听起来像包装、但其实不是。同一个 0.42，摊在整段文字上，和精确高亮在“1992 年”这三个字上，对决策的价值完全不同。把不确定性定位并传达出来，是方法的一部分，不是方法的前端。当有人问“一个做幻觉的项目为什么在写 HTML”时，这就是要准备好的那句话。",
      },
      {
        en: "Note that gap two and gap three are the project's two claimed advances over SelfCheckGPT. Section 9 concerns what happened to the first of them.",
        zh: "注意第二个缺口和第三个缺口，正是这个项目相对 SelfCheckGPT 声称的两项进步。第 9 节讲的就是其中第一项后来发生了什么。",
      },
    ],
  },
  {
    id: "method",
    number: 5,
    heading: { en: "The method, in one paragraph", zh: "方法，一段话讲完" },
    body: [
      {
        en: "Take the answer under test from the dataset. Generate nine more answers to the same question at temperature 0.9. Split each into claims. For every claim in the answer under test, ask an NLI cross-encoder how strongly each alternative's claims support it, take the best one-to-one pairing so a single vague sentence cannot prop up several claims at once, and average across the nine alternatives. That average is the support score. Colour the text by it. Separately, an LLM judge scores the answer under test against the gold answer on a 1-5 scale; a precision-recall curve over the support scores then picks the threshold that best agrees with that judge.",
        zh: "从数据集里取出待检答案。对同一个问题再以 temperature 0.9 生成九个回答。把每个回答拆成断言。对待检答案里的每条断言，用 NLI 交叉编码器判断每个 alternative 的断言对它的支持强度，取全局最优的一对一配对（这样一句很泛的话就不能同时撑起多条断言），再在九个 alternative 上取平均。这个平均值就是 support score，文本按它着色。另一条线上，一个 LLM judge 拿待检答案对照标准答案打 1-5 分；随后在 support score 上画精确率-召回率曲线，选出与该 judge 最一致的阈值。",
      },
      {
        en: "Two numbers in that paragraph are constantly confused and should never be. The support score is HEAT's output — the thing being evaluated. The judge's 1-5 is the label — the thing it is evaluated against. Every accuracy and correlation this project reports answers \"does the support score agree with this judge\", and none of them answers \"is HEAT right\".",
        zh: "这段话里有两个数经常被混淆，而它们绝不能混。support score 是 HEAT 的**输出**，是被评估的对象；judge 的 1-5 分是**标签**，是评估所依据的参照。这个项目报出的每一个准确率和相关系数，回答的都是“support score 和这个 judge 一致吗”，没有一个回答“HEAT 对不对”。",
      },
      {
        en: "The implementation is one Python file, 1,623 lines, no tests, no module boundaries, no CLI configuration beyond a record limit. That is the normal state of a research prototype and it is also why every change lands without regression cover. The line-by-line walkthrough is the companion document to this section.",
        zh: "实现是一个 Python 文件，1623 行，没有测试、没有模块划分，命令行除了一个记录数上限之外没有任何配置。这是研究原型的正常状态，也意味着任何改动都没有回归保护。这一节的配套文档是逐行导读。",
      },
    ],
  },
  {
    id: "data",
    number: 6,
    heading: { en: "Where the data comes from, and why it matters", zh: "数据从哪来，以及为什么这件事重要" },
    body: [
      {
        en: "Both inputs — 200 TriviaQA records and 256 SQuAD records — are not benchmark slices. They are the residue of an upstream uncertainty-aware RAG framework built by a colleague in the same group: the cases it could neither confidently accept nor confidently reject. The easy ones were already decided before HEAT saw anything.",
        zh: "两份输入——200 条 TriviaQA 和 256 条 SQuAD——都不是 benchmark 切片。它们是同组同事开发的一套带不确定性判别的上游 RAG 框架留下的残余：那些它既不能自信接受、也不能自信拒绝的样本。容易的那些在 HEAT 看到任何东西之前就已经被处理掉了。",
      },
      {
        en: "This cuts both ways and both directions need saying. It is the honest place to test a detector — a residual set is exactly where extra discrimination is worth having. It also means a comparison against a naive baseline is mandatory rather than optional, because a gray-zone slice can be badly imbalanced in ways a benchmark is not, and it means none of these numbers transfer to \"HEAT's accuracy on SQuAD\" as a general statement.",
        zh: "这一点有两面，两面都得说。它是检验检测器的诚实场所——残余集合正是额外判别力有价值的地方。但它同时也意味着，和朴素基线的对比是**必须**的而不是可选的，因为 gray-zone 切片可能以 benchmark 不会有的方式严重失衡；也意味着这些数字都不能被推广成“HEAT 在 SQuAD 上的准确率”这种一般性说法。",
      },
      {
        en: "One detail from the SQuAD input deserves its own line: 40 of its 256 predicted answers are refusals — \"the provided context does not mention...\". A closed-book sampler asked the bare question will never reproduce a refusal, so those records score near zero support no matter how correct the refusal was.",
        zh: "SQuAD 输入里有一个细节值得单独一行：256 条预测答案里有 40 条是拒答——“所给上下文没有提到……”。一个只拿到问题的闭卷采样器永远复现不出拒答，所以无论那次拒答本身多么正确，这些记录的 support 都会接近 0。",
      },
    ],
  },
  {
    id: "reported",
    number: 7,
    heading: { en: "What the previous phase reported", zh: "上一阶段报告了什么" },
    body: [
      {
        en: "TriviaQA: 199 usable labels, calibrated threshold 0.5887, Spearman 0.719, Pearson 0.747, 82.4% agreement with the judge (164 of 199). SQuAD: 158 usable labels, threshold 0.3289, Spearman 0.401, Pearson 0.289, 70.3% agreement (111 of 158). Roughly 2.2 million tokens and an hour of wall clock per dataset.",
        zh: "TriviaQA：199 条有效标签，校准阈值 0.5887，Spearman 0.719，Pearson 0.747，与 judge 一致率 82.4%（164/199）。SQuAD：158 条有效标签，阈值 0.3289，Spearman 0.401，Pearson 0.289，一致率 70.3%（111/158）。每个数据集大约 220 万 token、一小时挂钟时间。",
      },
      {
        en: "The reading offered was that TriviaQA's canonical factoid answers give the NLI encoder a clean signal, while SQuAD's contextual answers are harder — and that SQuAD's class imbalance \"inflates raw agreement\". The denominators are also inconsistent between two pages of the report; the generated summary page settles it at 164 of 199.",
        zh: "当时给出的解读是：TriviaQA 那种规范化的事实型答案给了 NLI 编码器干净的信号，而 SQuAD 的上下文依赖答案更难——并且 SQuAD 的类别不平衡“让一致率虚高”。报告里两页之间的分母也不一致；生成的汇总页把这件事定在 164/199。",
      },
    ],
  },
  {
    id: "recomputed",
    number: 8,
    finding: true,
    heading: { en: "What recomputation shows", zh: "复算揭示了什么" },
    body: [
      {
        en: "The per-record support and judge scores survive inside the generated summary pages, so the metrics the pipeline never printed can be recovered. TriviaQA: positive rate 34.2%, majority-class baseline 65.8%, ROC-AUC 0.900, PR-AUC 0.774, mean support 0.838 on positives against 0.232 on negatives. SQuAD: positive rate 16.5%, majority baseline 83.5%, ROC-AUC 0.666, PR-AUC 0.273, mean support 0.443 against 0.252.",
        zh: "每条记录的 support 和 judge 分数都留存在生成的汇总页里，所以流水线从未输出过的那些指标可以被还原出来。TriviaQA：正类占比 34.2%，多数类基线 65.8%，ROC-AUC 0.900，PR-AUC 0.774，正类平均 support 0.838、负类 0.232。SQuAD：正类占比 16.5%，多数类基线 83.5%，ROC-AUC 0.666，PR-AUC 0.273，正类 0.443、负类 0.252。",
      },
      {
        en: "On TriviaQA the signal is real and strong. ROC-AUC 0.900 with the two classes separating at 0.838 against 0.232 is not something a well-chosen threshold manufactures, and 82.4% against a 65.8% baseline is a genuine sixteen-point gain.",
        zh: "在 TriviaQA 上信号是真的，而且很强。ROC-AUC 0.900、两类分别落在 0.838 和 0.232，这不是调阈值能制造出来的；82.4% 对 65.8% 的基线，是实打实的十六个百分点。",
      },
      {
        en: "On SQuAD the stated reading is backwards. Class imbalance does not inflate the agreement figure — it raises the baseline above it. Always predicting \"hallucination\" scores 83.5%; HEAT scores 70.3%, thirteen points worse. The previous report does defend a different frame — that the point is precision and recall on the positive class, not accuracy — and that frame is legitimate. But taken on its own terms it does not rescue the result: PR-AUC 0.273 against a 0.165 base rate is a lift of 1.66×, and the best achievable F1 is 0.405 at precision 0.302, meaning roughly seven of every ten flagged answers would be false alarms. The honest summary is that a weak signal exists on SQuAD and that accuracy is a misleading way to report it. Both the README and the report need that sentence corrected.",
        zh: "在 SQuAD 上，原来的解读方向反了。类别不平衡并没有让一致率虚高——它把基线抬到了一致率之上。永远预测“是幻觉”能得 83.5%，HEAT 是 70.3%，低十三个百分点。上一份报告确实主张了另一套框架——重点应该是正类上的精确率和召回率，而不是准确率——这个立场本身是合理的。但即使按它自己的框架也救不回这个结果：PR-AUC 0.273 对基准率 0.165，提升只有 1.66 倍；能达到的最好 F1 是 0.405，此时精确率 0.302，也就是每报十次幻觉风险约有七次是误报。诚实的表述是：SQuAD 上确实存在一个弱信号，而准确率是一个会误导人的报告方式。README 和报告里这句话都需要改。",
      },
      {
        en: "A third observation: the two calibrated thresholds differ by nearly a factor of two, 0.5887 against 0.3289. Whether a threshold transfers across datasets or models is simply an open question, and one nobody has asked yet.",
        zh: "还有第三点观察：两个校准出来的阈值相差近一倍，0.5887 对 0.3289。阈值能否跨数据集、跨模型迁移，这就是一个未回答的问题，而且还没有人问过。",
      },
    ],
  },
  {
    id: "extraction",
    number: 9,
    finding: true,
    heading: { en: "The takeover check: atomic-fact extraction has never run", zh: "接手核查：原子事实抽取从未生效" },
    body: [
      {
        en: "Reading the file line by line turned up a defect in a place nobody would choose to look: an eleven-line string-cleaning helper. `_clean_generated_text` strips a leading `-` from every line, and `vertex_generate` applies it to every model reply before returning. `extract_facts_from_sentence` then parses that reply for lines beginning with `-`. Nothing matches. The fact list comes out empty every time, and a fallback written as a safety net keeps the whole sentence as the single \"atomic fact\".",
        zh: "逐行读这个文件时，在一个没人会主动去看的地方发现了一处缺陷：一个十一行的字符串清洗函数。`_clean_generated_text` 会去掉每一行开头的 `-`，而 `vertex_generate` 在返回任何模型回复之前都会调用它。随后 `extract_facts_from_sentence` 去解析这份回复，要求每行以 `-` 开头。一行都匹配不上。fact 列表每次都是空的，于是一个本作为安全网写下的兜底分支，把整句话当成唯一一条“原子事实”保留了下来。",
      },
      {
        en: "This is not an inference from reading. It reproduces offline with no API key — run the eleven lines over a well-formed reply and the parser accepts zero lines — and it is visible in the artifacts: across all 359 committed reports, 385 of 385 main-answer sentences produced exactly one fact. 353 of those were long enough to skip the four-word short circuit and did make the few-shot API call, including an eighteen-word sentence the demonstrations would split into five. Not one decomposed.",
        zh: "这不是读代码读出来的推断。它可以离线复现，不需要 API key——把那十一行套在一段格式正确的回复上，解析器接受的行数是 0；而且它在产物里就能看见：全部 359 份已提交报告中，main answer 的 385 个句子有 385 个只产出一条 fact。其中 353 个长到足以跳过四词短路、确实发出了少样本 API 调用，包括一个按示范应当被拆成五条的十八词句子。没有一个被拆开。",
      },
      {
        en: "So the first of the project's two claimed advances over SelfCheckGPT is absent from every artifact in the repository. Every \"fact\" is a sentence. Three consequences follow directly. Main answers therefore almost always carry exactly one fact, which makes the Hungarian matcher short-circuit before it starts — so the second claimed advance has never executed either; the handoff noticed that symptom and attributed it to short-answer datasets, but the cause is upstream. Deduplication likewise returns immediately on a one-element list. And the roughly 985-token few-shot prompt is paid on around 3,900 calls across the two runs — on the order of 3.9 million tokens whose output is discarded, against 4.34 million reported in total.",
        zh: "所以，这个项目相对 SelfCheckGPT 声称的两项进步中的第一项，在仓库的任何产物里都不存在。每一条 “fact” 都是一个句子。三个后果直接跟着来：main answer 因此几乎总是只有一条 fact，导致匈牙利匹配器还没开始就短路——于是第二项进步同样从未执行过；接手文档注意到了这个现象并归因于短答案数据集，但原因在上游。去重同样在单元素列表上立即返回。而约 985 token 的少样本提示，在两次跑批中被调用了约 3900 次——约 390 万 token 的输出被直接丢弃，而报告的总消耗是 434 万。",
      },
      {
        en: "There is a second, quieter problem waiting behind the fix. When an alternative yields exactly one fact, the aggregation code skips the solver and matches every main fact to that one fact — which is precisely the inflation the Hungarian algorithm was introduced to prevent, reintroduced as a special case. It is harmless today only because main answers also have one fact. Repair extraction without repairing that branch and support scores will inflate systematically.",
        zh: "修复之后还有第二个、更安静的问题在等着。当某个 alternative 恰好只产出一条 fact 时，聚合代码会跳过求解器，把每一条 main fact 都匹配到那唯一一条上——这正是当初引入匈牙利算法要防止的膨胀，以特例的形式回来了。它今天之所以无害，只是因为 main answer 也只有一条 fact。只修抽取而不修这个分支，support 会被系统性地抬高。",
      },
      {
        en: "The fix itself is small: parse before cleaning, or give the fact parser a cleaner that leaves list markers alone. The blast radius is not. Every number in the previous report was produced by the broken path, so a corrected run is a new experiment rather than a patch — and it is also the first measurement anyone will have of what fact-level granularity actually buys, which is the project's central claim and has never been tested.",
        zh: "修复本身很小：在清洗之前解析，或者给 fact 解析器一个不动列表符号的清洗函数。影响面并不小。上一份报告里的每一个数字都是坏掉的那条路径产生的，所以修好之后重跑是一次新实验而不是打补丁——而且它同时会是任何人第一次真正测出“fact 级粒度到底带来多少收益”，而这正是这个项目的核心主张，从未被检验过。",
      },
    ],
  },
  {
    id: "other",
    number: 10,
    heading: { en: "The other code-level findings", zh: "其余的代码级发现" },
    body: [
      {
        en: "The evaluation protocol has no train/test split anywhere. The threshold is chosen by maximising F1 over all records and accuracy is then reported on those same records, so every headline number is in-sample and optimistic by an unknown amount. The previous report never raises this, which makes correcting it both the easiest first contribution and a genuinely new one.",
        zh: "评估协议全程没有任何 train/test 划分。阈值是在全部记录上取 F1 最大值选出来的，准确率又在同一批记录上报出——所以所有 headline 数字都是 in-sample 的，偏乐观多少不知道。上一份报告完全没有提到这一点，这让修正它既是最容易的第一个贡献，也确实是新的。",
      },
      {
        en: "Reruns are not idempotent. If a record's report already exists, the judge score is scraped back out of the old HTML with a regex instead of being recomputed. It saves money, and it means changing the rubric without clearing the output directory silently preserves the old labels. Before trusting the numbers already in the repository, re-score a sample and check they still match.",
        zh: "重跑不是幂等的。如果某条记录的报告已经存在，judge 分数会用正则从旧 HTML 里抠出来复用，而不是重新计算。这省钱，但也意味着改了 rubric 却没清空输出目录时，旧标签会被静默沿用。在信任仓库里已有的数字之前，先抽样重新打分，核对是否仍然一致。",
      },
      {
        en: "Smaller items, each cheap to fix and each currently invisible: the Hungarian solver runs twice per alternative — once for the score, once again to recover the pairing for display — and with tied assignments the two solves are not guaranteed to agree, so the cell the report outlines as \"matched\" can differ from the cost that produced the score. The three NLI call sites frame the same sentence pair three different ways, which is free variance in a model known to be sensitive to surface form. PR-AUC is computed by trapezoid over the PR curve, which is optimistically biased. The accuracy figure is computed twice by two different loops, the second as a side effect of rendering a table cell. A bare `except Exception` wraps each record with no traceback, so a batch failure says a record broke and nothing about where. And calibration runs only after every record completes, so a crash at record 300 of 359 leaves 300 heatmaps and no summary at all.",
        zh: "更小的一些条目，每个都便宜可修、而且目前都不可见：匈牙利求解器每个 alternative 跑了两遍——一遍算分数，一遍再算一次以取出用于展示的配对——而存在并列最优时两次求解不保证一致，于是报告里标为“匹配”的那个格子可能不是真正产生分数的那个代价。三个 NLI 调用点用三种不同方式包装同一对句子，而这是一个已知对表层形式敏感的模型，等于白送方差。PR-AUC 用梯形法在 PR 曲线上计算，偏乐观。准确率被两个不同的循环算了两遍，第二遍还是渲染表格单元格时的副作用。每条记录被裸 `except Exception` 包住且不打堆栈，批跑失败只会告诉你某条崩了、不会告诉你崩在哪。校准只在所有记录跑完后执行，所以第 359 条里第 300 条崩掉，你会有 300 张热力图和一张汇总页都没有。",
      },
      {
        en: "None of these is a crisis. Together they are the reason the first two weeks should be spent turning a prototype into an instrument before any experiment is run on it.",
        zh: "这些没有一条是危机。但它们合在一起，正是为什么头两周应该先把这个原型变成一台仪器，然后再在上面跑任何实验。",
      },
    ],
  },
  {
    id: "standing",
    number: 11,
    heading: { en: "What is actually established", zh: "到底确立了什么" },
    body: [
      {
        en: "The ledger below separates the project's claims by what supports them. It is the part of this report to bring to a meeting: each row names the one thing that would move it, so disagreement can be about evidence rather than about tone.",
        zh: "下面的清单按“有什么在支撑它”把这个项目的各项主张分开。这是这份报告里最该带去开会的部分：每一行都写明了什么东西能改变它的状态，这样分歧就可以落在证据上，而不是落在语气上。",
      },
      {
        en: "The short version: one result is solid — on TriviaQA the black-box signal tracks an LLM judge well, and that survives every correction above. Everything else is either untested, weaker than reported, or measuring something other than what its name says.",
        zh: "简短版本：有一个结果是扎实的——在 TriviaQA 上，黑盒信号能很好地追踪一个 LLM judge，而且它经受住了上面所有的修正。其余的要么未经检验，要么弱于报告所述，要么测的根本不是它名字所说的那件事。",
      },
    ],
  },
  {
    id: "open",
    number: 12,
    heading: { en: "Open questions", zh: "未决的问题" },
    body: [
      {
        en: "For the advisor: is the internal-states line still on the agenda, or has it ended with Phase II? Is the deliverable a report, a prototype, or a paper submission? And given the extraction defect, does re-establishing the baseline count as this term's work or as clearing the ground before it — because those are different amounts of semester.",
        zh: "问导师：内部状态那条线还在议程上吗，还是随 Phase II 结束了？最终交付是报告、原型，还是投稿？以及，考虑到抽取缺陷，重新建立基线算作本学期的工作，还是算作开始之前的清场——这两种算法对应的学期长度是不同的。",
      },
      {
        en: "For the colleague who built the upstream framework: how was the gray-zone slice cut, and can `retrieved_chunks` — the top-10 documents already sitting unused in the input file — be treated as an external evidence source? That field is the cheapest available route to a second axis, and the person who produced it knows what it is worth.",
        zh: "问上游框架的作者：gray-zone 子集是怎么切出来的？以及 `retrieved_chunks`——已经躺在输入文件里没被用过的 top-10 文档——能不能当作外部证据源来用？这个字段是通往第二条轴最省事的路径，而产出它的人最清楚它值多少。",
      },
      {
        en: "For the method, and unanswerable by sampling harder: self-consistency is not correctness. Ten samples repeating the same wrong answer produce support 1.000 and a solid green paragraph — there are at least six such cases in the TriviaQA output, all with support above 0.96 and a judge score of 1. Closing that gap needs a signal from outside the model, which is why the unused retrieval field keeps coming up.",
        zh: "关于方法本身，而且靠加大采样无法回答：self-consistency 不等于正确性。十次采样重复同一个错答案，会得到 support 1.000 和一整段纯绿——TriviaQA 的输出里至少有六个这样的案例，support 全部高于 0.96 而 judge 给 1 分。要关上这个缺口需要模型之外的信号，这也是那个没被使用的检索字段反复被提起的原因。",
      },
      {
        en: "And the question the project's own framing raises but has never asked: does the heatmap make a reader judge better? Everything measured so far is whether the signal is accurate. Whether the visualization — the thing the advisor's one-sentence instruction actually names — improves a human decision has never been tested at all.",
        zh: "还有一个由项目自身立场提出、却从未被问过的问题：热力图真的让读者判断得更准吗？到目前为止测的全是信号准不准。而可视化——导师那句唯一的指示里真正点名的东西——是否改善了人的决策，从来没有被检验过。",
      },
    ],
  },
];

export const CLAIM_STATUSES = ["established", "at-risk", "refuted", "untested", "unverified"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface Claim {
  id: string;
  claim: Bilingual;
  status: ClaimStatus;
  /** The one thing that decides it — evidence for, or evidence against. */
  basis: Bilingual;
  /** What would change the status. Every row has one; a claim nothing could move is not a claim. */
  moves: Bilingual;
}

/**
 * Every claim the project makes, and what supports it.
 *
 * `established` — the artifacts support it
 * `at-risk`     — supported, but weaker than reported, or confounded
 * `refuted`     — the artifacts contradict it
 * `untested`    — asserted, never measured either way
 * `unverified`  — measurable today, nobody has looked
 *
 * Ordered by how much of the project each row decides, not by status.
 */
export const CLAIM_LEDGER: readonly Claim[] = [
  {
    id: "granularity",
    status: "refuted",
    claim: {
      en: "HEAT scores hallucination risk at the atomic-fact level",
      zh: "HEAT 在原子事实级别上给出幻觉风险分数",
    },
    basis: {
      en: "Every \"fact\" in all 359 generated reports is a whole sentence: 385 of 385 main-answer sentences yielded exactly one, including 353 that did make the decomposition call.",
      zh: "全部 359 份生成报告里每一条 “fact” 都是一整句话：main answer 的 385 个句子有 385 个只产出一条，其中 353 个确实发出了拆分调用。",
    },
    moves: {
      en: "Fix the parser, rerun, and check that a multi-clause sentence yields more than one fact.",
      zh: "修好解析器、重跑，检查一个多从句的句子能否产出多于一条 fact。",
    },
  },
  {
    id: "hungarian",
    status: "untested",
    claim: {
      en: "One-to-one matching prevents a vague alternative from inflating support",
      zh: "一对一匹配能防止一条含糊的 alternative 抬高支持度",
    },
    basis: {
      en: "The solver short-circuits whenever the main answer has one fact, which is always. It has never executed on this data — and the single-alternative-fact branch reintroduces exactly the inflation it was meant to prevent.",
      zh: "只要 main answer 只有一条 fact，求解器就会短路，而这是一直如此。它在这份数据上从未执行过——而且“alternative 只有一条 fact”那个分支，恰恰把它本要防止的膨胀又放了回来。",
    },
    moves: {
      en: "Fix extraction and that branch, then run answers long enough to produce several claims.",
      zh: "修好抽取和那个分支，然后跑足够长、能产出多条断言的答案。",
    },
  },
  {
    id: "triviaqa",
    status: "established",
    claim: {
      en: "On TriviaQA the black-box signal tracks an LLM judge",
      zh: "在 TriviaQA 上，黑盒信号能追踪一个 LLM judge",
    },
    basis: {
      en: "ROC-AUC 0.900, mean support 0.838 on positives against 0.232 on negatives, 82.4% against a 65.8% majority baseline. Threshold-free and baseline-relative, so it survives the in-sample criticism.",
      zh: "ROC-AUC 0.900，正类平均 support 0.838、负类 0.232，82.4% 对 65.8% 的多数类基线。既与阈值无关又相对基线，所以经受得住 in-sample 的批评。",
    },
    moves: {
      en: "Little. This is the result to build on — though it is agreement with a judge, not with truth.",
      zh: "很难被推翻。这是可以往上盖的那个结果——尽管它是与 judge 一致，不是与事实一致。",
    },
  },
  {
    id: "squad",
    status: "at-risk",
    claim: {
      en: "The same holds on SQuAD, with class imbalance inflating the number",
      zh: "SQuAD 上结论相同，而且类别不平衡让数字虚高",
    },
    basis: {
      en: "The direction is reversed: the majority baseline is 83.5% and HEAT is 70.3%. A weak signal does exist — PR-AUC 0.273 on a 0.165 base rate, a lift of 1.66× — but accuracy is a misleading way to report it. The README sentence needs correcting.",
      zh: "方向是反的：多数类基线 83.5%，HEAT 70.3%。弱信号确实存在——PR-AUC 0.273 对基准率 0.165，提升 1.66 倍——但用准确率来报告它会误导人。README 里那句话需要改。",
    },
    moves: {
      en: "Report base rate, baseline and lift alongside every accuracy, from now on.",
      zh: "从现在起，每次报准确率都同时报基准率、基线和 lift。",
    },
  },
  {
    id: "in-sample",
    status: "refuted",
    claim: {
      en: "The reported accuracy estimates performance on unseen records",
      zh: "报告的准确率能估计在未见记录上的表现",
    },
    basis: {
      en: "The threshold is fitted on all records and accuracy is reported on the same records. No split exists anywhere in the file.",
      zh: "阈值在全部记录上拟合，准确率又在同样这批记录上报出。文件里任何地方都没有划分。",
    },
    moves: {
      en: "Add a split or cross-validation and re-report. Small change, and the previous report never discussed it.",
      zh: "加上划分或交叉验证再重报一次。改动很小，而且上一份报告从未讨论过这一点。",
    },
  },
  {
    id: "self-consistency",
    status: "at-risk",
    claim: {
      en: "What is measured is the model's self-consistency",
      zh: "被测量的是模型的自我一致性",
    },
    basis: {
      en: "The main answer came from a RAG system with retrieved context; the nine alternatives are generated closed-book from the question alone. Two distributions, not one — and SQuAD, where the answer lives in a passage the alternatives never see, is where that would hurt most.",
      zh: "main answer 来自一个带检索上下文的 RAG 系统，九个 alternative 只拿到问题、闭卷生成。这是两个分布而不是一个——而 SQuAD 的答案就存在于 alternative 从未见过的段落里，正是这个差异伤害最大的地方。",
    },
    moves: {
      en: "Regenerate the alternatives with the same retrieved context and rerun SQuAD. Days of work, and a clean finding either way.",
      zh: "让 alternative 在相同检索上下文下重新生成，重跑 SQuAD。几天的工作量，而且无论哪个方向都是干净的发现。",
    },
  },
  {
    id: "truth",
    status: "untested",
    claim: {
      en: "The support score tracks factual correctness",
      zh: "support score 能追踪事实正确性",
    },
    basis: {
      en: "There is not one human annotation in the project. Every metric measures agreement with an LLM judge, which is itself unvalidated.",
      zh: "整个项目没有任何一条人工标注。所有指标度量的都是与一个 LLM judge 的一致性，而这个 judge 本身也未经验证。",
    },
    moves: {
      en: "Human labels on a subset, or a benchmark that already carries them.",
      zh: "对一个子集做人工标注，或者换一个本身自带人工标签的 benchmark。",
    },
  },
  {
    id: "labels",
    status: "unverified",
    claim: {
      en: "The judge labels in the repository came from the current rubric",
      zh: "仓库里的 judge 标签来自当前这份 rubric",
    },
    basis: {
      en: "The pipeline scrapes an existing report's score rather than re-scoring. If the rubric changed during development without the output directory being cleared, some labels are older than the prompt that supposedly produced them.",
      zh: "流水线会从已存在的报告里抠出旧分数复用，而不是重新打分。如果开发过程中改过 rubric 却没清空输出目录，部分标签就比据称产生它们的那份提示词还要旧。",
    },
    moves: {
      en: "Re-score a random sample against a cleared directory and compare. An afternoon.",
      zh: "清空目录后对随机抽样重新打分并比对。一个下午的事。",
    },
  },
  {
    id: "visualization",
    status: "untested",
    claim: {
      en: "The heatmap helps a reader judge an answer better",
      zh: "热力图能帮助读者更好地判断一个回答",
    },
    basis: {
      en: "Never measured. Everything so far measures whether the signal is accurate, not whether the display changes a decision — and the display is what the advisor's instruction actually names.",
      zh: "从未被测量过。到目前为止测的都是信号准不准，而不是这个展示是否改变了决策——而展示恰恰是导师那句指示里真正点名的东西。",
    },
    moves: {
      en: "A four-condition study: answer only, answer plus a score, heatmap, heatmap plus evidence. Even a pilot at n=10 is a legitimate section.",
      zh: "一个四组对照实验：只看答案、答案加一个总分、热力图、热力图加证据。哪怕 n=10 的 pilot 也是站得住的一节。",
    },
  },
  {
    id: "threshold-transfer",
    status: "untested",
    claim: {
      en: "A calibrated threshold transfers to another dataset or model",
      zh: "校准出的阈值可以迁移到另一个数据集或模型",
    },
    basis: {
      en: "The two calibrated thresholds differ by nearly a factor of two, 0.5887 against 0.3289. Nobody has asked whether either transfers.",
      zh: "两个校准阈值相差近一倍，0.5887 对 0.3289。没有人问过它们能否迁移。",
    },
    moves: {
      en: "Swap the main model and recalibrate; report both the transferred and the refitted threshold.",
      zh: "换主模型后重新校准，同时报告迁移过来的阈值和重新拟合的阈值。",
    },
  },
];

export interface ReproductionCheck {
  id: string;
  question: Bilingual;
  /** Run from ~/heat. Kept short enough to paste. */
  command: string;
  result: Bilingual;
}

/**
 * The checks behind the ledger, as commands.
 *
 * None of these needs an API key or a GPU, which is the point: the findings in
 * sections 8 and 9 are the kind a reader should be able to verify in ten
 * minutes rather than take on trust. Run them from ~/heat.
 */
export const REPRODUCTION: readonly ReproductionCheck[] = [
  {
    id: "cleaner",
    question: {
      en: "Does the text cleaner really remove the list markers the fact parser needs?",
      zh: "那个文本清洗函数真的会删掉 fact 解析器需要的列表符号吗？",
    },
    command: `python3 -c "
import re
c = lambda t: re.sub(r'^[>\\-\\#]+\\s*', '', t.strip(), flags=re.MULTILINE)
cleaned = c('- A is B.\\n- B is C.')
print(cleaned)
print('lines the parser accepts:', len([l for l in cleaned.splitlines() if l.startswith('-')]))"`,
    result: {
      en: "Prints the two facts with their dashes gone, then `lines the parser accepts: 0`.",
      zh: "打印出两条去掉短横线的 fact，然后是 `lines the parser accepts: 0`。",
    },
  },
  {
    id: "histogram",
    question: {
      en: "How many facts did each main-answer sentence actually produce?",
      zh: "main answer 的每个句子实际产出了几条 fact？",
    },
    command: `python3 -c "
import re, glob
from collections import Counter
c = Counter()
for p in glob.glob('output_heatmaps_*/heatmap_q*.html'):
    s = open(p, encoding='utf-8', errors='replace').read()
    for ul in re.findall(r\\\"<ul style='list-style:none;padding-left:0.5em;'>(.*?)</ul>\\\", s, re.S):
        c[len(re.findall('<li', ul))] += 1
print(dict(sorted(c.items())))"`,
    result: {
      en: "`{1: 385}` — every sentence, one fact, no exceptions.",
      zh: "`{1: 385}` —— 每个句子一条 fact，无一例外。",
    },
  },
  {
    id: "cost",
    question: {
      en: "How much of the token bill is the discarded few-shot prompt?",
      zh: "token 账单里有多少是那份被丢弃的少样本提示？",
    },
    command: `python3 -c "
src = open('visualize.py', encoding='utf-8').read()
few = src.split('_FACT_FEW_SHOT = ' + chr(34)*3)[1].split(chr(34)*3)[0]
print(len(few) // 4, 'tokens of few-shot prompt per extraction call')"`,
    result: {
      en: "~985 tokens, paid on roughly 3,900 calls across the two runs — on the order of 3.9M against 4.34M reported in total.",
      zh: "约 985 token，在两次跑批中被调用约 3900 次——约 390 万，而报告的总消耗是 434 万。",
    },
  },
  {
    id: "smoke",
    question: {
      en: "Does the pipeline still run end to end?",
      zh: "流水线现在还能跑通吗？",
    },
    command: `rm -rf output_heatmaps_incorretacalibrated && python3 visualize.py 5`,
    result: {
      en: "Needs `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) exported first, and the first run also downloads the NLTK tokenizers and ~1.6 GB of NLI weights. Produces five heatmaps plus a summary in `output_heatmaps_incorretacalibrated/`. The `rm -rf` is not tidiness — an existing report makes the judge score be scraped out of it rather than recomputed, so a rerun over a populated directory silently keeps the old labels.",
      zh: "需要先导出 `GEMINI_API_KEY`（或 `GOOGLE_API_KEY`），首次运行还会下载 NLTK 分词器和约 1.6 GB 的 NLI 权重。会在 `output_heatmaps_incorretacalibrated/` 下产出五张热力图和一张汇总页。前面那个 `rm -rf` 不是为了整洁——已存在的报告会让 judge 分数被从旧 HTML 里抠出来复用而不是重新计算，所以在非空目录上重跑会静默沿用旧标签。",
    },
  },
];
