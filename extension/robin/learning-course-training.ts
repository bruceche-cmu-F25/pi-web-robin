import type { CourseLesson } from "./learning-course.ts";

export const TRAINING_LESSONS: CourseLesson[] = [
  {
    id: "sft-lora", stage: "training", title: "SFT、LoRA 与 QLoRA：目标和方法不要混在一起",
    question: "模型格式经常错，什么时候该微调？LoRA 又为什么不等于一种新任务？",
    outcome: "判断微调是否必要，区分 SFT 学习信号、全参数更新、LoRA 与量化基座，并设计隔离数据的对照实验。",
    prerequisites: ["training-lifecycle", "evaluation", "model-api"], takeaway: "SFT 说明学习什么示范，LoRA 说明更新哪些参数，QLoRA 再改变冻结基座的存储／计算方式。",
    diagram: { caption: "一种常见 SFT + LoRA 组合。不是把‘SFT、LoRA、QLoRA’依次执行三遍。", nodes: [
      { label: "审核示范", detail: "任务输入与目标输出，分组隔离训练／评测。" }, { label: "SFT 目标", detail: "提高目标 token 的概率，明确 loss mask。" },
      { label: "LoRA 更新", detail: "冻结基座，训练选定层的低秩增量。" }, { label: "独立回归", detail: "新任务、旧能力、泛化、费用与部署约束。" },
    ] },
    explanation: [
      { title: "先证明问题不是检索或契约坏了", body: "新政策没检索到，先修资料链路；API 不支持你的 schema，先修契约；提示中漏了任务定义，先建清楚基线。只有观察到稳定、可重复的行为或能力缺口，并有高质量授权数据时，才考虑训练。\n\nSFT 用输入与目标输出做监督学习，通常对选定目标 token 的负对数概率求 loss。是否只训练 assistant 部分、怎样处理 prompt 与 padding，需要检查具体数据模板和 masking 配置，而非默认全部正确。" },
      { title: "一张矩阵说明 LoRA 少训练了什么", body: "原权重 W 的形状为 d_out × d_in。LoRA 用 ΔW=BA 表示增量，其中 B 为 d_out × r，A 为 r × d_in，r 通常远小于两个维度；W 冻结，只训练这些适配参数（具体配置可能另有可训练模块）。\n\n若 W 为 4096×4096，全矩阵有 16,777,216 个参数；r=8 时 A、B 合计 8×4096+4096×8=65,536，约为 0.39%。这只比较一个目标矩阵的可训练参数，**不是整个训练显存缩小到 0.39%**：基座、激活和其他状态仍在。" },
      { title: "QLoRA 省的部分与没有保证的部分", body: "QLoRA 的典型做法是冻结量化的基座权重，通过计算路径训练 LoRA adapter。量化存储与计算 dtype 不一定相同；低位权重也不意味着所有操作都用同样位数。\n\nLoRA／QLoRA 通常降低训练资源门槛，但不保证每个任务质量不变，也不保证推理一定更快。Adapter 部署、合并、模型版本兼容和量化误差都要评测；测试集不能同时被用于挑超参数。" },
    ],
    worked: { title: "设计一个真正可比较的微调实验", body: "目标：工单分类遵循固定的 refund／invoice／other 语义。先固定 prompt 基线与开发集错误；按源会话隔离示范数据、开发集、保留测试集。\n\n比较①原模型固定 prompt；②few-shot；③同一基座 SFT + LoRA。三者用同一测试集和输出校验，记录分类指标、格式失败、拒答、旧任务与每次成功成本。若②已满足门槛且维护简单，不训练也可能是更好的工程答案。" },
    misconception: { wrong: "LoRA 会把训练数据放进一个小数据库，让模型精确查询。", right: "Adapter 保存的是学习到的参数增量，不是可审计事实索引。动态知识、可删除资料和引用通常仍需要外部数据系统。" },
    check: { question: "W 为 1024×1024，LoRA rank=4，A、B 一共多少参数？", answer: 1, choices: [
      { text: "4,096", feedback: "只算了一侧矩阵，A 和 B 都需要计算。" },
      { text: "8,192", feedback: "对：4×1024 + 1024×4 = 8192。缩小的是这一矩阵的可训练增量参数。" },
      { text: "1,048,576", feedback: "这是完整 1024×1024 矩阵的参数数，不是低秩增量参数数。" },
    ] },
    exercise: { title: "写微调实验方案，而不是先租 GPU", task: "已知错误：模型把发票问题常分成 other；现有 120 条审核示范，来自 20 个会话。写出数据切分单位、基线、拟议训练方法、三项指标与停止条件。另判断‘让模型知道今天的新退货政策’应优先用什么。", hints: ["同会话的改写不要跨 train/test。120 条是教学规模，不应据此保证生产泛化。", "先比较 prompt／few-shot；新政策是动态事实问题，优先更新授权资料和检索。"], solution: "按源会话分组隔离训练、开发和保留测试，检查重复与标签一致性；小样本应报告不确定性并继续收集代表性数据。基线是原模型固定 prompt，可加 few-shot。若仍有稳定缺口，再尝试小规模 SFT + LoRA，记录基座、模板、mask、超参数和 adapter。\n\n指标至少包括分类混淆／每类召回、schema 失败、旧任务回归，并检查延迟与成本。开发集不改善、过拟合或关键能力退化就停止；最终方案只在未参与选择的测试集上评一次。新退货政策优先走文档更新与 RAG，而非让权重背每天变化的事实。", rubric: ["没有把方法、目标和数据更新混成一条技术升级链。", "切分避免同源泄漏，有可复现基线。", "能说明何时不值得微调，以及旧能力如何回归。"] },
    notes: ["04 - Fine-tuning与SFT及LoRA", "09 - AI概念验证实验与学习顺序"], sources: ["sft", "lora", "qlora"],
  },
  {
    id: "preferences-rl", stage: "training", title: "DPO、RLHF 与 GRPO：奖励高，不等于真实更好",
    question: "为什么模型学会在答案末尾堆关键词，评分变高，用户却更不满意？",
    outcome: "区分示范、偏好对和标量奖励；用简单数值解释组内比较，并识别 reward hacking 与独立评测的必要性。",
    prerequisites: ["training-lifecycle", "evaluation"], takeaway: "训练会利用评分器给的信号；如果奖励可被投机，就可能学到高分而不是任务成功。",
    diagram: { caption: "三种学习信号的对照。现实配方与实现有变体，不是每种方法都执行同一套流程。", nodes: [
      { label: "SFT", detail: "给一份合格示范，学习目标输出。" }, { label: "DPO", detail: "同题 chosen / rejected 偏好对，直接优化相对偏好。" },
      { label: "RLHF / RLVR", detail: "基于人类偏好或可验证反馈构造奖励信号。" }, { label: "GRPO", detail: "同题采多个候选，用组内奖励作相对比较。" },
    ] },
    explanation: [
      { title: "偏好对与奖励不是同一种数据", body: "SFT 数据是‘这题怎么答’；DPO 数据是‘同一题 A 比 B 好’。标准 DPO 使用策略与参考模型的相对 log-probability，通过偏好目标更新策略，不需要先单独训练一个显式奖励模型再跑在线 rollout。具体变体可能改变参考设置。\n\n经典 RLHF 可包括偏好数据、奖励模型、策略优化；RLVR 强调用测试、答案或规则等可验证信号。但可验证不等于验证器完美，也不保证任务所有重要维度都被覆盖。" },
      { title: "GRPO 用同题候选作相对比较", body: "对同一问题采样多个回答，再给每个回答奖励。教学示例 reward=[0,1,1,2]，均值为 1，中心化后是 [-1,0,0,1]：最后一个相对更好，第一个更差。常见实现还会按组内标准差等方式归一化，并加入 clipping、KL 等约束；不同变体不完全一样。\n\n若一组奖励全相等，组内比较提供的区分信号很弱或为零（取决于公式与稳定项）。增加候选会增加 rollout 成本，不是免费拿到‘推理能力’。" },
      { title: "优化目标与真实目标之间有缝隙", body: "若奖励是‘出现引用标记加分’，模型可能编 citation；若奖励是长度，模型会变啰嗦；若代码只通过几个已知测试，可能硬编码样例。Reward model 预测的是评分偏好，不是真理。\n\n独立评测应与训练奖励分开，用新样例、隐藏测试、实际业务结果和人工复核检查。限制策略偏离可缓和退化，但不能自动补全一个错误的目标。" },
    ],
    worked: { title: "同一客服问题的偏好对", body: "问题：‘我今天申请退款，明天能到账吗？’资料只说‘审核后处理’，没有承诺日期。\n\nChosen：‘当前资料不能确认明天到账，可先查看审核状态。’Rejected：‘当然，明天一定到账。’偏好应来自事实与业务规则，不是因为前一句听起来更礼貌。\n\n若偏好数据把所有长答案都选为 chosen，模型可能学到长度偏好。需要检查不同长度、措辞与难度下，标注理由是否仍一致。" },
    misconception: { wrong: "做了 RL 就是真正会推理；reward 提高就能直接上线。", right: "方法名不能替代证据。需独立检查泛化、任务成功、安全、成本，以及是否在利用奖励漏洞。" },
    check: { question: "同题四个候选奖励都是 1，按组内均值中心化后分别是多少？", answer: 0, choices: [
      { text: "全部为 0，无法区分谁更好", feedback: "对。相同奖励没有提供组内相对优劣信息；具体优化还可能有其他项。" },
      { text: "全部为 1，因此四个都强烈优于平均", feedback: "平均就是 1，减去平均后是 0。" },
      { text: "依照生成顺序变成 1、2、3、4", feedback: "生成顺序不应无缘无故变成质量信号。" },
    ] },
    exercise: { title: "亲手攻击一个奖励规则", task: "奖励规则：回答含‘依据政策’得 1 分，超过 100 字再得 1 分。设计一份能拿 2 分却业务错误的回答，再改写评分方案。最后给‘同题 A/B 偏好对’和‘代码执行通过率’分别选择合适的学习信号描述。", hints: ["可以写很长却没有真实来源的承诺；高分不要求它真能回答问题。", "把事实支撑、权限、任务完成分开；长度最多是约束或成本，不应冒充质量。"], solution: "反例可以反复强调‘依据政策’，并虚构到账日期，用冗长文字拿满分。改进：验证关键陈述是否被当前授权政策支持；禁止无依据承诺；独立检查权限／工具状态；对有答案与无答案样例分别评分，并用人工校准。\n\n同题 A/B 是偏好信号，可用于 DPO 等方法；代码执行结果是可验证奖励信号，可用于 RLVR 类设计，也可仅用于推理时选择。是否发生训练，仍取决于是否更新参数。保留独立隐藏测试，避免只优化已知测试。", rubric: ["给出真正能投机拿分的反例。", "改进规则对应业务事实，不只是新增关键词。", "区分数据／奖励信号与具体优化算法、推理时选择。"] },
    notes: ["05 - RLHF与DPO及RLVR", "03 - Eval评测到底是什么"], sources: ["dpo", "grpo", "eval"],
  },
  {
    id: "inference-infra", stage: "training", title: "推理 Infra：模型放得下，为什么并发上不去",
    question: "14GB 的模型已经放进 24GB 显卡，为什么长对话和多用户仍然 OOM？",
    outcome: "区分权重与运行内存、prefill 与 decode、首 token 与整体延迟，并计算一个明确假设下的 KV cache 预算。",
    prerequisites: ["model-basics", "model-api"], takeaway: "容量不是模型文件大小；上下文、并发、KV cache、调度和质量约束一起决定服务表现。",
    diagram: { caption: "常见 decoder-only 自回归模型的服务阶段；端到端延迟还包含排队、网络与应用处理。", nodes: [
      { label: "排队", detail: "流量超过服务能力，等待先变长。" }, { label: "Prefill", detail: "处理输入上下文，产生首 token 所需状态。" },
      { label: "Decode", detail: "逐步生成新 token，读取与扩展 KV。" }, { label: "结果返回", detail: "记录完整延迟、输出长度与任务成功。" },
    ] },
    explanation: [
      { title: "显存账本里不只有权重", body: "若 7B 参数全按 2 bytes 保存，原始权重约 14×10⁹ bytes，即 14GB（十进制），约 13.0GiB。实际加载还有格式、缓冲区和运行开销；量化的尺度／元数据也占空间。\n\nKV cache 存储注意力使用的 key/value，随序列长度、并发、层数、KV heads、head dimension 和 dtype 变化。MoE、GQA/MQA、张量并行与引擎实现都会影响实际账本，不能只按‘7B’估计所有模型。" },
      { title: "一个可以手算的 KV 示例", body: "假设每条序列有 32 层、8 个 KV heads、head dimension=128、长度 4096、每值 2 bytes。粗略 KV bytes = 2(K/V) × 32 × 8 × 128 × 4096 × 2 = 536,870,912 bytes，约 **512MiB／序列**。8 条同时活跃就约 4GiB，尚未计入分配开销等。\n\n这是指定假设下的教学估算，不是任意模型的规格表。输入变长或生成继续增长，cache 也随之变化。" },
      { title: "快一点，要先说快的是什么", body: "TTFT 是首 token 时间，用户先看到文字；TPOT 是输出阶段每 token 时间；完整延迟还受输出长度影响。吞吐是单位时间处理量，不能拿单请求最快值代替并发 p95。\n\nContinuous batching 让不同生命周期的请求更灵活地共享执行；KV 分页管理缓和内存碎片；prefix cache 可复用符合条件的共享前缀。它们各有适用条件，不自动保证质量或数据隔离。量化和 speculative decoding 也应在代表性工作负载上实测。" },
    ],
    worked: { title: "为什么把 top-k 和上下文调小可能比换 GPU 更快", body: "工单问答每次拼入 80,000 tokens 的全库材料，但真正相关只有两段。过长输入增大 prefill、KV 与排队压力，也可能混入旧政策。\n\n先修检索和上下文预算，用同一评测集确认关键证据未丢，再测 TTFT、完整 p50/p95、吞吐、峰值显存和每次成功任务成本。若限制长度后质量下降，不能只汇报速度提升；性能与正确性必须一起验收。" },
    misconception: { wrong: "INT4 模型权重小四倍，所以所有显存和延迟也都会小四倍。", right: "权重、KV、激活、元数据和内核各自受影响不同；是否更快取决于硬件和实现，需实测。" },
    check: { question: "按本课其他假设不变，把上下文从 4096 加到 8192，粗略 KV 预算怎样变？", answer: 1, choices: [
      { text: "不变，因为参数数没有变", feedback: "KV 是请求相关状态，不是固定权重。" },
      { text: "约翻倍，变为 1GiB／序列", feedback: "对，在这些假设下与序列长度成正比；实际分配还可能有额外开销。" },
      { text: "一定变四倍，因为所有 attention 成本都相同", feedback: "这里算的是 KV 存储，不是所有注意力计算的复杂度。" },
    ] },
    exercise: { title: "先做容量表，再决定部署", task: "沿用本课模型假设，比较长度 4096／8192、并发 1／8 的四种 KV 预算。再列出一个推理 benchmark 必须固定或记录的变量，并解释‘首 token 快了但完整响应更慢’是否矛盾。", hints: ["4096 时每条约 0.5GiB，再乘并发；8192 时每条约 1GiB。", "记录模型／精度、输入和输出长度、并发、缓存命中、硬件、引擎版本；TTFT 不包含全部 decode 时间。"], solution: "四格分别约 0.5GiB、4GiB、1GiB、8GiB，仅计指定 KV；另加权重、其他运行状态和安全余量。\n\nBenchmark 固定任务与质量门槛，记录输入／输出长度分布、并发、到达率、硬件、模型精度、引擎版本、缓存条件，并报告 p50/p95 完整延迟、TTFT、吞吐、峰值显存、失败率和成本。\n\n首 token 更快而完整响应更慢并不矛盾：可能 decode 更慢或输出更长。只看流式开头会漏掉任务完成时间。", rubric: ["算式与单位清楚，明确只是 KV 估算。", "吞吐、TTFT、完整延迟没有混用。", "优化同时验证质量、失败率与数据隔离。"] },
    notes: ["06 - AI Infra训练与推理基础设施", "09 - AI概念验证实验与学习顺序"], sources: ["vllm"],
  },
  {
    id: "training-infra", stage: "training", title: "训练 Infra：多张 GPU 并不自动把显存合起来",
    question: "一张 GPU 放不下训练任务，开 DDP 用四张为什么仍然放不下？",
    outcome: "列出训练内存组成，区分 DDP、FSDP、张量／流水线并行，并解释通信、重计算与检查点的取舍。",
    prerequisites: ["training-lifecycle", "sft-lora", "inference-infra"], takeaway: "先判断瓶颈是状态、激活、计算、通信还是数据供给，再选分片或优化方法。",
    diagram: { caption: "一轮训练既有计算也有状态与数据流。分布式方案改变它们放在哪里、什么时候交换。", nodes: [
      { label: "数据供给", detail: "读取、tokenize、batch 与 padding。" }, { label: "Forward", detail: "参数参与计算，保留反向所需激活。" },
      { label: "Backward", detail: "计算梯度，必要时通信／重计算。" }, { label: "Update + Checkpoint", detail: "优化器状态更新，可恢复地保存进度。" },
    ] },
    explanation: [
      { title: "训练显存比推理多了哪些账目", body: "除参数外，训练通常还要梯度、优化器状态、激活，有的配置还有更高精度主权重、临时缓冲等。Adam 的动量和二阶统计本身就占内存，但总字节数依 dtype、优化器、分片和实现，不能套一个永久正确的常数。\n\n批量和序列长度会影响激活。Gradient accumulation 用多次 microbatch 累积梯度再更新，可以降低单次激活峰值；它不自动减少每卡保留的模型和优化器状态。" },
      { title: "DDP 与 FSDP 在分什么", body: "DDP 典型地在每卡放一份模型副本，分不同数据，反向时同步梯度。因此增加 GPU 往往提高吞吐，却不会自动让单卡装下更大的完整模型状态。\n\nFSDP 分片参数、梯度和优化器状态，在计算需要时进行聚合／通信，降低持久每卡状态，但峰值仍受临时聚合、激活和配置影响。张量并行拆单层计算，流水线并行拆层序列；它们解决不同规模问题，也增加通信与调度成本。" },
      { title: "节省显存或时间，都不是免费", body: "Activation checkpointing 少保存激活、反向时重新计算，用计算换内存。混合精度改变数值与性能，需要检查稳定性。长度分桶与 packing 减少 padding 浪费，但 attention mask、样本边界和 loss mask 必须正确。\n\n可恢复 checkpoint 不只模型文件，还可能需要 optimizer、scheduler、随机数、数据位置与版本。日志中 loss 正常不等于恢复后数据没有重复或跳过；要用中断恢复实验验证。" },
    ],
    worked: { title: "先做四个诊断，不先采购 GPU", body: "① 一开始加载就 OOM：先核对参数／优化器状态与精度，考虑更小模型、PEFT 或分片。② 长序列才 OOM：看激活，减 microbatch、长度或用 checkpointing。③ GPU 等数据：检查磁盘、tokenize、loader。④ 多卡反而更慢：看通信、批量、网络和每步工作量。\n\n同样叫‘训练慢’，四种原因的正确改动不同。把一个 tiny run 跑通并验证 loss、mask、恢复后，再扩大规模。" },
    misconception: { wrong: "四张 24GB 显卡做 DDP，就等于一张 96GB 显卡。", right: "DDP 通常复制模型并同步梯度，不自动把所有状态拼成一个连续内存池。能否放下取决于并行和分片方案。" },
    check: { question: "模型与优化器一加载就 OOM，单纯把 microbatch 从 8 改成 1 一定能解决吗？", answer: 2, choices: [
      { text: "一定，batch 控制所有显存", feedback: "batch 主要影响激活等请求相关部分，不移除固定模型状态。" },
      { text: "一定，梯度累积会分片全部参数", feedback: "梯度累积与参数分片是不同机制。" },
      { text: "不一定；先确认固定状态是否已超容量", feedback: "对。瓶颈若在固定状态，需调整模型／精度／可训练参数或分片等。" },
    ] },
    exercise: { title: "为四种瓶颈选方法，并写出代价", task: "为下面场景各选一个优先调查方向和可能方案：A 固定模型状态放不下；B 长序列导致激活峰值；C GPU 利用率低且 CPU tokenize 很忙；D 两卡比一卡更慢。\n\n额外写出一个可复现的中断恢复测试需要保存什么。无需租 GPU，这一课先检验诊断逻辑。", hints: ["把状态、激活、数据、通信分开。", "FSDP／PEFT 对应 A；checkpointing 对应 B；数据预处理对应 C；profiling 通信与批量对应 D，但每项都要验证。"], solution: "A 检查精度、优化器与可训练参数，考虑 PEFT、分片或更小基座，代价是兼容／通信／质量取舍。B 缩短序列、减 microbatch、重计算，代价是任务信息或额外计算。C 预处理与合理 data loader，注意存储、版本和可复现。D profile 每步计算／通信、batch 与网络，不假定更多卡一定更快。\n\n恢复测试固定 seed 和数据版本，保存模型／adapter、优化器、scheduler、随机状态、步数与数据游标等必要状态；中断后恢复，检查后续批次和训练曲线与预期一致。不同框架保存内容不同，要按实际格式验证。", rubric: ["方案对应真实瓶颈，不统一回答‘加卡’。", "每个优化明确付出的成本。", "checkpoint 测试包含恢复后的状态，而非只确认文件存在。"] },
    notes: ["06 - AI Infra训练与推理基础设施"], sources: ["fsdp", "lora"],
  },
];
