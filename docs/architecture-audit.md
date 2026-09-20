# 模块深度与接缝审计 / Deepening 方案

> 审计对象：`pi-web-robin` @ v0.8.9（main, `4a1c6c4`）
> 审计范围：模块接口、依赖图、domain/adapter 分层、AI 可导航性
> 方法：deep module 词汇（interface / seam / depth / leverage / locality），见 `improve-codebase-architecture` + `codebase-design`
> 日期：2026-09-15

样式层与布局的审计见 [frontend-audit.md](frontend-audit.md)，本文不重复。

---

## 0. 结论速览

| 维度 | 现状 | 评价 |
|---|---|---|
| 依赖图健康度 | 468 模块 / 1137 边，平均扇出 2.4，运行时循环 **0**（原 1） | ✅ |
| 测试覆盖 | 262 个测试文件；`domain-writes.test.mjs` 等在接口上测而非越过接口 | ✅ |
| Robin domain/adapter 分层 | Todo / Link / Watch / FSO 已落实；Practice / Job / Events / Tech-events 未落实 | ⚠️ 半程 |
| 工具能力白名单 | 六档分级 + 理由注释 + 测试钉住最窄档 | ✅ 优于多数生产代码 |
| `useAgentSession` 接口 | 2037 行、return **约 80 个字段**、唯一调用者解构 65 个；状态图 **52/64 单元同一连通分量、无割点** | 🔴 最大 depth 缺口 |
| AGENTS.md File Map | 90 个 route 中 **58 个未记录**，`components/robin/` 完全缺席 | 🔴 AI 导航性 |
| `store.ts` 旁路 | 530 行 / 约 60 导出 / 扇入 28，被 **12 个 route 直连** | 🔴 违反 CONTEXT.md |
| Robin domain 覆盖 | 原 12 个域有 `*-domain.ts`，Practice/Job 只有写没有读 | ⚠️ → 已补齐 |
| 路由守卫 | `guard()` 重复 **18 份**、`fail()` **15 份**、错误串 **51 处** | ⚠️ 非漏洞，是重复 |
| 上帝组件 | v0.8.8 记录的 6 个基本未动；`AppShell.tsx` 2520 行且无测试 | 🔴 |

**一句话**：`extension/robin/` 的分层是这个仓库最好的部分，问题在于**它只做了一半**，而 `hooks/` + `components/` 那一侧根本没有接缝——`useAgentSession` 把全部内部状态当接口暴露出去。

---

## 1. 先记下做对了什么

这几条决定了后面建议的边界，不要在重构里破坏它们。

### 1.1 `todo-domain.ts` 是本仓库的 deep module 样板

[extension/robin/todo-domain.ts](../extension/robin/todo-domain.ts) 把不变量全部关在小接口后面：

- URL 归一化（`javascript:` 被拒）
- `startDate` 必须有 `due` 且不晚于它
- 完成 7 天后的保留期裁剪发生在**读**路径上，调用方无感

[app/api/robin/todos/route.ts](../app/api/robin/todos/route.ts) 只做 JSON 解析和状态码映射，`todo-tools.ts` 只做英文渲染。两个 adapter，一个 seam——按"两个 adapter 才是真接缝"的标准，这个接缝是挣来的，不是假想的。

[extension/robin/domain-writes.test.mjs](../extension/robin/domain-writes.test.mjs) 在**接口上**测（断言 `listTodos()` 的返回等于 `completeTodo()` 的返回），而不是断言文件内容或内部状态。这类测试能活过实现重构。

### 1.2 `tools.ts` 的能力分级

[extension/robin/tools.ts](../extension/robin/tools.ts) 按回合的信任等级切了六档白名单，每档都有注释写明**为什么是这些**：

- `ROBIN_SCORING_TOOL_NAMES` 只有 3 个工具，因为这是唯一喂给模型雇主撰写文本的回合——"注入的指令没有东西可以够到"
- `ROBIN_MENTOR_TOOL_NAMES` 只有 2 个只读工具，因为能写的 mentor 会开始 review 代码
- 文件末尾注释说明评分档必须留在最后，有测试钉住这一点

### 1.3 其他

- `proxy.ts` 的 matcher 覆盖全部 `/api/*`，同源 + Basic Auth 前置统一处理
- `isPathWithinRoots()`（`lib/path-security.ts`）是单一实现的安全边界，AGENTS.md 明确写了"保留这一个实现"
- `extension/robin/index.ts` 是纯组合根，注释解释了为什么按域拆 `*-tools.ts` 而非一个 register-everything 模块
- AGENTS.md 记下了 `AgentSession.fork()` 原地改 wrapper 这类只有踩过才知道的坑

---

## 2. 问题（按 leverage 排序）

### 2.1 🔴 `useAgentSession` 的接口约等于它的全部内部状态

**位置**：[hooks/useAgentSession.ts](../hooks/useAgentSession.ts)，唯一调用者 [components/ChatWindow.tsx:335](../components/ChatWindow.tsx)

**测量**：

```
2037 行   43 × useState   36 × useRef   48 × useCallback   13 × export
return 约 80 个字段 → ChatWindow 解构 65 个
```

**问题不是行数，是接口**。返回值里包含：

- 原始 setter：`setData`、`setMessages`、`setAgentRunning`、`setActiveLeafId`、`setForkingEntryId`、`dispatch`
- 内部 ref：`pendingScrollToUserRef`、`initialScrollDoneRef`、`sessionIdRef`、`handleAgentEventRef`
- 滚动实现细节：`scrollToBottom`、`scrollUserMsgToTop`、`scrollContainerRef`、`messagesEndRef`、`lastUserMsgRef`

调用方必须知道这些状态的形状和写入时机才能正确使用——按 depth-as-leverage 的定义，leverage 为零：要学的接口和实现一样大。

**代价已经发生**。[components/ChatWindow.tsx:295](../components/ChatWindow.tsx) 有一段注释在解释绕路：

> 这比包装 `handleAgentEventRef` 可靠，因为 `useAgentSession` 每次 render 都覆写那个 ref（它在同步最新回调），外部装的 wrapper 第一次重渲染之后就被冲掉了

这是内部接缝被当成外部接口用之后的典型症状：调用方为了不越过接口，被迫在旁边另建一套 ref。

**deletion test**：删掉它，2037 行搬进 `ChatWindow`。复杂度不会消失 → 它不是 pass-through，locality 是真的。缺的只有 leverage。

#### 依赖分析结果（2026-09-16）：**初稿提的拆法是错的**

初稿建议按职责拆成 `useSessionMessages` / `useAgentStream` / `useModelSelection` / `useNotices` 四个 hook。那是**看返回值分的**，不是看状态依赖分的。实际跑了一遍依赖图之后，这个拆法站不住。

方法：把 hook 体内的 79 个状态（42 `useState` + 35 `useRef` + 2 `useReducer`）和 64 个单元（48 `useCallback` + 15 effect + 若干函数）建成二部图，两个单元只要碰同一个状态就连一条边，然后求连通分量。脚本留在仓库里：`node scripts/analyse-hook-deps.mjs`（只读，可重跑）。

**结果：去掉明显的管道状态（`sessionIdRef`、`agentRunningRef`、`error`、`data`、挂载/props 镜像 ref）之后，64 个单元里 52 个仍然是同一个连通分量，共享 67 个状态。**

```
全部状态：       7 个分量，大小 57, 2, 1, 1, 1, 1, 1
去掉管道之后：   12 个分量，大小 52, 2, 1×10
```

唯一干净分离出来的是 **notices**（2 个单元 / 5 个状态）——初稿里唯一猜对的一个。

**没有割点。** 逐个试删每个状态，看那个 52 单元的团会不会裂开：

```
删 eventStreamGraceActiveRef  →  52 变 48   （最好的单刀，只放出 4 个）
删 agentRunning               →  52 变 50
删 systemPrompt               →  52 变 50
```

贪心地连删 12 个状态，团还有 31 个单元。**它不是"接缝画错了位置"，是根本没有接缝。** 按初稿那样硬拆，会得到四个互相传引用和 setter 的 hook——比现在更糟，因为那时连"所有东西在一个文件里"这点好处都没了。

#### 真正的耦合源：一个概念，14 种拼法

"现在有东西在跑吗"这件事，在这个 hook 里用 **14 个变量**表达：

```
agentRunning  agentRunningRef  bashRunning  bashRunningRef  pendingBash
sdkAgentActiveRef  rpcPromptPendingRef  eventStreamGraceActiveRef
promptRunIdRef  notifiedPromptRunIdRef  agentPhase  streamState
isCompacting  loading
```

64 个单元里有 **15 个同时操作其中两个以上**，最密的三个：

| 单元 | 同时碰几个 |
|---|---|
| `applyLifecycleEvent` | 9 |
| `effect@1568` | 9 |
| `handleSend` | 7 |

把这 14 个当成一个值来算，团从 **52 掉到 39**，并且多放出 13 个单元散成小分量。这是整份依赖图里唯一有杠杆的那一刀。

#### 但状态机已经存在了

读 `applyLifecycleEvent` 的时候发现：**`lib/agent-stream-lifecycle.ts` 里已经有一个纯状态机**，`agentLifecycleTransition(event, state) → { next, effects }`，`AgentLifecycleState` 有 5 个字段，**27 个测试**钉着它。这是个真正的 deep module。

问题在于它的状态存在**哪里**：

```ts
const { next, effects } = agentLifecycleTransition(event, {
  agentRunning: agentRunningRef.current,          // ← 5 个散落的 ref
  sdkAgentActive: sdkAgentActiveRef.current,      //   读进来拼成 state
  rpcPromptPending: rpcPromptPendingRef.current,
  notifiedRunId: notifiedPromptRunIdRef.current,
  promptRunId: promptRunIdRef.current,
});
agentRunningRef.current = next.agentRunning;      // ← 再写回去
...
```

这 5 个 ref 在 hook 里一共被赋值 **24 次**，其中只有 **4 次**在 `applyLifecycleEvent` 内部——**另外 20 次绕过了转移函数直接改机器的状态**。

这是"模块有接口，但调用方绕过接口写"的教科书形态：一个纯的、有 27 个测试的 deep module，它的状态却被 20 个赋值语句从外面改。

#### 已做：让状态机独占自己的状态（2026-09-16）

1. 5 个 ref 换成 1 个 `useRef<AgentLifecycleState>`
2. 20 处直接赋值全部换成转移事件——它们表达的本来就是事件，只是写成了赋值
3. `agent-stream-lifecycle.ts` 加了 10 个只改状态、不带 effect 的事件（`prompt_sending` / `prompt_started` / `prompt_rejected` / `prompt_abandoned` / `prompt_settled` / `stream_connected` / `adopted` / `settled` / `notified` / `ui_running_changed`），9 个新测试（27 → 36）

结果：

| | 改前 | 改后 |
|---|---|---|
| 机器状态的写入点 | **24 处散落**（只有 4 处在转移函数内） | **2 处**（`lifecycle()` 和 `applyLifecycleEvent()`） |
| hook 里的 ref 数 | 35 | 31 |
| `agent-stream-lifecycle` 测试 | 27 | 36 |

事件刻意**不带 effect**：每一个都紧挨着 hook 原本就在跑的 UI 代码，把那些也搬进来只是把一种分散换成另一种。搬走的只是"谁有资格写这个状态"。

#### 但我预测的解耦**没有发生**

改完重跑分析：

```
改前：52 个单元的团        改后：53 个（多出来的 1 个就是新的 lifecycle 单元本身）
```

**预测失败，原因是我的模拟问错了问题。** 之前那句"把 14 个当成一个值来算，团从 52 掉到 39"，模拟的是**把这些变量整个从图里删掉**——等于假设没有任何单元需要知道"现在有东西在跑吗"。但把 5 个 ref 合成 1 个，并不会让那些单元不再需要这个概念，它们照样读它。变的是**谁能写**，不是**谁要读**。

`lifecycleRef` 现在被 14 个单元碰、只有 2 处写；改前那 5 个 ref 是被同样一批单元碰、24 处写。写入集中了，连通性一点没动。

所以这次改动买到的是**正确性**（单一写入者，机器状态不可能被漏写一半），不是**可拆性**。两者都值得要，但不能混为一谈——我上一轮把它们说成一回事了。

#### 那什么才能解耦

要让团裂开，得让那些单元**不再需要知道**运行状态——也就是搬单元，不是搬状态。而 53 个单元里绝大多数需要它，是因为 `ChatWindow` 要在一次渲染里同时知道消息、流、模型、运行状态。

换句话说：**这个 hook 之所以拆不开，是因为它的调用方要的就是这么一大坨。** 真要拆，得先改 `ChatWindow` 要什么——那是产品层面的问题，不是重构层面的。

在有人愿意动 `ChatWindow` 的接口之前，这个 hook 保持原样是合理的。它 locality 是真的，只是没有 leverage，而 leverage 的缺失来自调用方而不是它自己。

#### 顺带修了分析脚本的一个 bug

`scripts/analyse-hook-deps.mjs` 原本用 `\bname\b` 匹配状态读取，于是 `lifecycleRef.current.agentRunning` 会被算成一次 `agentRunning` 这个 useState 的读取。加了 `(?<![.\w])` 之后：`error` 从"18 个单元"降到 8，`agentRunning` 从 16 回到 10。**连通分量的数字不受影响**（改前改后都用修正后的脚本重测过，52 / 53），但本节初稿里那张"热点"表的每变量计数是虚高的。

---

### 2.2 🔴 AGENTS.md 的 File Map 漏掉三分之二的代码

> **已修（2026-09-15）**，本节保留作为记录。

**测量**：90 个 `app/api/**/route.ts` 中 **58 个未出现在 File Map**，其中 36 个属于 Robin / research。File Map 中**没有**指向不存在文件的死链接——所以这是漏记，不是腐烂。

缺失的整块：

```
robin/todos  robin/links  robin/jobs{,/digest,/profile,/scan,/score,/sweep}
robin/practice  robin/fso  robin/rounds{,/scan}  robin/watch  robin/learning
robin/events  robin/tech-events{,/scan}  robin/notes{,/attachments}  robin/notion
robin/products{,/[id]}  robin/product-{assistant,classify,library}
robin/podcasts  robin/settings  robin/assistant  robin/notes-agent
robin/gmail{,/check}  robin/google{,/callback}
git/{diff,status}  pdf/{render,text}  push/{config,subscribe,unsubscribe}
skills/{check,update}  subagents/{[id],profiles}  sessions/{search,[id]/state,[id]/auto-name}
research/{objective,icon/[id]}  usage  file-index  app-update  project-trust  cwd/browse
```

`components/` 小节完全没有提到 `components/robin/`（60 个组件 + 18 个辅助模块 + 21 个测试），`extension/robin/`（88 个文件）和 `app/` 下 22 个页面也完全缺席。

CONTEXT.md 定义了 Todo / Job / Practice / Course Step / Chapter 这些域词汇，但 AGENTS.md 的 Architecture 图和 File Map 只描述 pi-web 那一半。对一个靠这两份文档定位的 agent，效果等同于 Robin 不存在——它会重新发明一遍。

**修复内容**：File Map 补齐全部 90 个 route（Robin 单列一节，标注每个 route 走哪个 `*-domain`）、新增 `extension/robin/` / `components/robin/` / `app/` 页面三节，并在 Key Design Decisions 增加 "Robin domain modules are the seam" 与 "Robin tool scoping" 两条。

---

### 2.3 🔴 HTTP adapter 绕过 domain module 直连 store

> **已修完（2026-09-16）**：直连 `store.ts` 的 route **12 → 0**，`lib/` 也是 0。

CONTEXT.md 对 Todo / Saved Link / Job / Attempt 都写了同一句：**"HTTP 和 Pi 工具是 adapter"**。但 [extension/robin/store.ts](../extension/robin/store.ts)（530 行、约 60 导出、扇入 28）被 12 个 route 直接 import：

```
app/api/robin/practice/route.ts          ✅ 已修 → listPractice()
app/api/robin/events/route.ts            ✅ 已修 → calendarBoard()
app/api/robin/tech-events/route.ts       ✅ 已修 → techEventBoard()
app/api/robin/tech-events/scan/route.ts  ✅ 已修 → techEventScanStatus()
app/api/robin/assistant/route.ts
app/api/robin/jobs/route.ts
app/api/robin/jobs/digest/route.ts
app/api/robin/jobs/profile/route.ts
app/api/robin/jobs/score/route.ts
app/api/robin/jobs/sweep/route.ts
app/api/robin/gmail/route.ts
app/api/robin/gmail/check/route.ts
```

**最清楚的一例是 Practice**。`practice-domain.ts` 有全部写操作，但**没有"读全量"这个操作**，于是读侧分裂成两份：

| 位置 | 做了什么 |
|---|---|
| [app/api/robin/practice/route.ts:28](../app/api/robin/practice/route.ts) | 自建 `snapshotResponse()`：`readPracticeRecords()` + `readPracticeState()` + `localDate()` |
| [extension/robin/practice-tools.ts:115](../extension/robin/practice-tools.ts) 和 `:219` | 各自 `readPracticeRecords()` 再组一遍 |

两个 adapter 各自知道 Practice 的存储形状——接缝在错误的位置（在 `store` 上，而不是在 `practice-domain` 上）。

**修法**：在 `practice-domain.ts` 加 `listPractice()`，返回 route 和 tools 都需要的那一个形状，两边都调它。这和 Todo 的 `listTodos()` 完全对称。

修完之后 `store.ts` 应当只被 `*-domain.ts` 和 `*-tools.ts` import，route 一律经由 domain——这条可以用一个测试钉住。

#### 已完成的三个域

| 域 | 新接口 | 收回了什么 |
|---|---|---|
| Practice | `listPractice(today?) → PracticeBoard` | route 的 `snapshotResponse()` 和 tools 的两处 `readPracticeRecords()` 合并成一个读；`DEFAULT_PRACTICE_LIST` 取代两处散落的 `?? "neetcode150"` |
| Tech Events | `techEventBoard(opts?)` / `setTechEventFlags(id, flags)` / `techEventScanStatus()` | 读时保留期裁剪、每周扫描的触发时机、saved/hidden 的"只存在不存 false"写策略——三条都从 route handler 里搬出来，**并第一次有了测试**（9 个） |
| Calendar | `calendarBoard(opts?) → CalendarBoard` | route 和 `calendar-tools.ts` 各写了一遍的 Google 合并 + 降级策略。窗口参数从两个日期改成 `before`/`after` 天数宽度，让 `today` 只被读一次（原先两个 adapter 各自 `localDate()`，跨午夜会问错一天） |

Calendar 这一条值得单记：`calendar-tools.ts` 里原本的注释写着"Reading only the local store made the agent answer 'nothing scheduled' to someone whose day was full"——那个 bug 正是读侧重复造成的，两个 adapter 之前是各自修好的。

#### Job 簇（2026-09-16）

`job-domain.ts` 原本只有写，没有读——5 个 route 各自读 profile / scan / scoring / sweep / jobs 五份状态。补上读接口：

| 新接口 | 收回了什么 |
|---|---|
| `jobBoard()` | route 自己拼的 `sortJobs + jobSummary + minScore + digestSize + configured` |
| `pendingJobCount()` / `pendingJobIds()` | `pendingJobs(readJobs(), readJobProfile())` 这串在 score route 里出现 **6 次** |
| `scoringStatus()` / `scoringState()` / `saveScoringState()` | 评分进度的读写。运行本身留在 route——它要 `runAssistantTurn`，而扩展没法启动 assistant turn |
| `sweepState()` | 扫描进度 |
| `buildJobDigest(options)` | 整个 digest 构建：候选筛选、死链剔除、网络等待后的重读、认领、成文 |

新建 **`job-profile.ts`**（202 行）：`jobProfile()` / `jobProfileEditor()` / `saveJobProfile(body)`。那 107 行校验（`stringList`、`number`、`workMonths`、`companies`、`scoreModel`…）原本在 route 里，测它的唯一办法是构造一个 `Request`。profile route 从 210 行降到 **14 行**。

**一个测试暴露了真问题。** `routes.test.mjs` 通过 jiti 的模块别名把 `@/extension/robin/job-providers` 换成桩。digest 逻辑搬进 `job-domain.ts` 之后，它用的是**相对路径** `./job-providers.ts`，别名不匹配——于是真的去发网络请求，测试挂死。

这正是"测试越过接口"的代价：它钉的是模块路径，不是接缝。修法按 `getJobDetails` 已有的先例来——把死链检查做成注入依赖（`checkDead`，默认 `findDeadPostings`），测试改成直接调 `buildJobDigest`，别名 hack 整个删掉。

#### Mail / assistant sessions

这两处不是"route 绕过 domain"，是 **domain 函数长在了 `store.ts` 里**——所以修法是**搬走**，不是包一层（包一层的话 deletion test 立刻失败：删掉它复杂度不会在任何地方重现）。

- 新建 `mail-domain.ts`：`mailBoard()`（含"昨天的 review 不是今天的邮件"这条不变量）、`attachMailReport()`、`saveMailReview()`。两个 adapter：HTTP route 和 `gmail-tools.ts`
- 新建 `assistant-sessions.ts`：六个模式的 session id 读写 + `clearAssistantSession()`。`store.ts` 只留原始 JSON 访问

---

### 2.4 ⚠️ 路由守卫被抄了 17 份

> **已修（2026-09-15）**：`lib/api-route.ts` + `apiRoute()`，17 份 `guard()` / 15 份 `fail()` 全部归零。详见本节末。

**测量**：

```
function guard(req, requireJson)  逐字重复 17 次
function fail(error, status)      重复 15 次
"Untrusted API request"           51 处
```

**先说清楚：这不是安全漏洞。** `proxy.ts` 的 matcher 覆盖全部 `/api/*` 且已调用 `isApiRequestAllowed`，这 43 处 route 内检查是纵深防御，不是唯一防线。43/90 这个比例不代表另外 47 个 route 没设防。

问题是接口知识重复了 51 份：每个 route 作者都得记住"403 还是 415、body 长什么样"，而且新写一个 route 时**忘记加守卫没有任何信号**。

> 初稿曾把 `models-config/test` 返回的 `{ ok: false, error }` 当作"形状已漂移"的证据。那是错的：那个 route 从成功到失败全程用 `{ ok, ... }`，`ok` 是"模型测试通过了吗"这个问题的答案，不是错误包装约定。它是另一种自洽的契约，不是漂移。这条重复的代价是重复本身，不是不一致。

**修法**：`apiRoute(handler, opts)` 把守卫 + try/catch + 错误形状收进一个 seam。

#### 已完成

新建 [lib/api-route.ts](../lib/api-route.ts)：

| 导出 | 作用 |
|---|---|
| `apiRoute(handler, { json?, errorStatus? })` | 包住 handler：同源检查 → content-type 检查 → try/catch → 统一错误体。第二参数原样透传，动态段的 `{ params }` 照常到达 |
| `guardApiRequest(req, { json? })` | 同一套策略，给返回流或非 JSON 的 route 用 |
| `apiError(error, status?)` | 唯一的错误响应形状 |

`json` 默认按方法推断：GET/HEAD 不要求，其余要求——一个不检查 content-type 的写入端点会被跨站表单 POST 够到。

route 现在写成 `export const GET = apiRoute(...)`，handler 只写成功路径和自己那些状态码（找不到 id 的 404）。以 `todos` 为例：98 行 → 62 行。

12 个接口测试（`lib/api-route.test.mjs`）钉住 403 / 415 / 400 / 500 / 自定义状态码 / params 透传。另外在一个临时无密码实例（`PI_WEB_DIST_DIR=.next-preview`，用完已销毁）上过了真实 Next：200 / 415 / 400 / 404 四条路径都对。

#### 内联守卫也一并收掉了

另有 25 个 route 从没写过本地 `guard()`，而是内联一行 `if (!isApiRequestAllowed(req)) return ...`（`notes/route.ts` 还藏着第 18 个本地守卫，名字叫 `denied`）。这些也都转了。

顺带把 `errorStatus` 的默认值改成**按方法推断**，和 `json` 一致：GET/HEAD 抛错是服务端的锅（500），写入抛错通常是请求体的问题（400）。原先每个读端点都要手写 `{ errorStatus: 500 }`，15 个 route 的这行现在可以删掉。

**三个刻意保留的例外**，都在代码里写了原因：

| route | 为什么不用 `apiRoute` |
|---|---|
| `files/[...path]` | GET 流式返回文件字节，POST 是 multipart——JSON 错误体和 content-type 检查都不适用。改用 `guardApiRequest()` 共享策略 |
| `notes/attachments` | 同上，GET 返回附件字节。本地 `denied()` 改成转调 `guardApiRequest()` |
| `models-config/test` | 全程 `{ ok, ... }` 契约，`ok` 是"模型测试通过了吗"的答案。套上去会让被拒请求返回裸 `{ error }`，破坏唯一调用方读的那个字段 |

最终：`apiRoute` 包住 **82 个 handler**，`app/api/**/route.ts` 里 `"Untrusted API request"` 字面量剩 **2 处**（都是上面记录在案的例外）。

---

### 2.5 ⚠️ `settings.ts` 的 23 个 setter

> **已修（2026-09-16）**：route 305 行 → **49 行**，23 个 import → 4 个。

[app/api/robin/settings/route.ts](../app/api/robin/settings/route.ts) 原本 305 行，import 23 个独立函数（`setDailyAgenda`、`setGmailDigest`、`setTelegramToken`、`setGoogleCalendarSources`…），手写 14 个 `typeof body.x` 分支。

典型的宽接口浅模块：加一个设置要同时改两个文件，HTTP adapter 必须知道每一项设置的名字和形状。

**真正该搬走的不是 setter，是强制转换。** route 里那 100 行 `typeof x === "string" ? ... : ""`、`Number(...)`、`locale === "zh" ? "zh" : "en"`、chatIds 的字符串/数组双形态——这些都是域知识：locale 允许哪些值、缺字段意味着"保持不变"而空串意味着"清空"。它们本来就属于 `settings.ts`，和 `addTodo` 校验 title/due 是同一类事。

**新接口**（`extension/robin/settings.ts`）：

| 导出 | 作用 |
|---|---|
| `settingsView()` | 四个 section 的配置状态 + 文件位置。永远不含密文 |
| `applySettingsSection(section, body)` | 收下浏览器发来的任意 JSON，按 section 强制转换并写入 |
| `clearSettingsSection(section)` | 忘掉某个 section 的凭据，环境变量重新成为回退 |
| `detectTelegramChats()` | 一次性 chat-id 发现（原本 50 行解析逻辑在 route 里） |

route 现在只剩三件 HTTP 的事：解析 body、把 `{ error, status? }` 映射成状态码、拼 `googleRedirectUri`（唯一依赖请求 origin 的字段，所以它该留在 route）。

新增 7 个接口测试，钉住此前完全没测过的转换规则：凭据必须成对、同一日历不能加两次、找不到 id 是 404 不是静默、空 token 保持不变而空 chatIds 清空、digest 受众吃字符串也吃数组且只留整数、未知 locale 回退而不是原样存。

**一处措辞变化**：未知 section 的错误信息从 `section must be "google", "googleCalendars", "notion", or "telegram"` 变成 `section must be one of: google, googleCalendars, notion, telegram`（改由 `SETTINGS_SECTIONS` 生成）。`SettingsPanel.tsx` 不读这个字符串。

---

### 2.6 ⚠️ 循环依赖：一个真的，一个是我的误报

> **已修（2026-09-15）**：真的那个已拆；另一个不存在。现在运行时循环为 **0**。

```
extension/robin/jobs.ts          ↔  extension/robin/job-evidence.ts        ← 真的
extension/robin/product-playbook.ts  ↔  extension/robin/product-shape.ts   ← 误报
```

**product 那一对不是循环**：两个方向都是纯类型（`import type { LibraryCategory }` 和 `export type { StepId }`），编译时全部擦除，运行时没有这条边。初稿的检测脚本没有区分值导入和类型导入。重新检测（区分之后）：拆掉 job 那一个之后，**468 个模块里运行时循环为 0**。

`job-evidence.ts` 需要 `jobs.ts` 的 `extractYearsRequired` / `hasDegreeExperienceAlternatives`；`jobs.ts` 需要 `job-evidence.ts` 的 `needsJobScoring` / `experienceProblem` / `reviewProblem`。ESM 靠提升活着，但说明接缝画错了位置。

**修法**：那几个纯解析函数下沉到两边都能依赖的第三个模块。

新建 [extension/robin/job-requirements.ts](../extension/robin/job-requirements.ts)（156 行）：`cleanPostingDescription`、`extractYearsRequired`、`hasDegreeExperienceAlternatives` 及其私有正则。纯字符串处理，不碰 store，不认识 `Job` 类型。`jobs.ts` 再导出它们，所以 `job-intake` / `job-providers` / 两个测试文件的调用点一个没动；`job-evidence.ts` 直接从新模块取值，`Job` / `JobProfile` 改成 `import type`——边断了。

#### job 簇的规模，以及它其实没问题（2026-09-16 实测）

```
 2146L  job-providers.ts      1088L  jobs.ts          470L  job-directory.ts
  321L  job-intake.ts          221L  job-tools.ts     215L  job-rubric.ts
  164L  job-scan.ts            202L  job-profile.ts   134L  job-domain.ts
  102L  job-evidence.ts
────────
 5063L  10 个文件
```

初稿看着 `job-providers.ts` 2146 行 / 29 导出就写了"值得单独做一次 deepening"。实测之后**这个判断是错的**——按导出被谁用分类：

| 模块 | 值导出 | 有生产调用方 | 仅测试用 | 无人用 |
|---|---|---|---|---|
| `job-providers.ts` | 23 | **8** | 14 | 1 |
| `jobs.ts` | 22 | **21** | 0 | 1 |

`job-providers.ts` 的真实接口是 **8 个**：`makeFetchContext`（6 个调用方）、`FetchContext` 类型、`findDeadPostings`、`hydrateDescriptions`、`resolveProvider`、`providerById`、`BOARD_PROVIDERS`、`COMPANY_PROVIDERS`。2146 行实现藏在 8 个导出后面——按 depth-as-leverage 这是**深模块**，正是我们想要的形状，不是问题。

那 14 个"仅测试用"的导出（`parseListings`、`workdayPostedAt`、`parseHnHiringComment`、`parseIcimsSearchPage`…）确实是"越过接口测试"，但这里是**可辩护的取舍**：每个 parser 对付一个招聘板自己的畸形 HTML，改成透过 `hydrateDescriptions` 测就得给每个板子备一套 fixture，测试会更脆而不是更稳。记录下来，不改。

已修的只有两个白捡的：`PROVIDERS` 和 `compileKeyword` 都只在本文件内用，`export` 是多余的，去掉。

**教训和 §2.1 是同一条**：行数和导出数都不能单独判断一个模块的形状。`jobs.ts` 22 个导出里 21 个有真实调用方——它是宽接口；`job-providers.ts` 23 个里只有 8 个——它是深模块。两者行数相近，结论相反。

---

### 2.7 ⚠️ 两个死模块，各有一个"保护空气"的测试

> **已修（2026-09-15）**：两个模块及其测试已删。

```
 50L  lib/session-tree.ts                    ← 仅 lib/session-tree.test.mjs 引用
 89L  extension/robin/capability-clusters.ts ← 仅其自身测试引用
```

生产代码零引用。删之前逐个确认了接替者：

- `lib/session-tree.ts` 的 `buildSessionTree`（递归树）被 `lib/session-family.ts` 的 `listSessionFamilies`（扁平 root + subagents）取代，`SessionSidebar` 和 `AppShell` 用的都是后者
- `extension/robin/capability-clusters.ts` 的 `CAPABILITY_CLUSTERS` 被 `industry-world.ts` 的 `INDUSTRY_CLUSTERS` 取代，`buildCapabilityTree()` 读的是后者

它还导出一个 `ROLE_STAGES`——按岗位把 domain 切成阶段的分期表。那是被否掉的设计：现在页面上写的是"the role reference only recolours the same world"，岗位只改配色不做筛选。留着它等于把一个已经否掉的方向摆在原地当诱饵。

测试是绿的，但什么都没保护——反而让人以为这些模块还在服役。

（`lib/http-dispatcher.ts`、`components/FileViewer.tsx`、`components/TerminalPanel.tsx`、`components/AgentsConfig.tsx`、`scripts/telegram/bridge.ts` 也没有静态 import，但它们分别经由 `instrumentation.ts` 的动态 import、`next/dynamic` 和独立入口加载——**不是死代码**。）

---

### 2.8 🔴 上帝组件仍在原地

`docs/frontend-audit.md`（v0.8.8）记录了 6 个共 12,564 行。v0.8.9 复测：

| 文件 | 行数 | useState | 扇出 | 测试 |
|---|---|---|---|---|
| `components/ChatInput.tsx` | 2523（原 2638） | 20 | 13 | ✅ |
| `components/AppShell.tsx` | 2520 | 40 | **37** | ✅ 5 个文件 24 个 |
| `components/ModelsConfig.tsx` | 2337 | 29 | — | ✅ |
| `components/SessionSidebar.tsx` | 2329 | 45 | 12 | ✅ |
| `components/MessageView.tsx` | 1789 | 20 | 13 | ✅ |
| `components/ChatWindow.tsx` | 1663 | 8 | 19 | ✅ |
| `extension/robin/research.ts` | 1413 | — | — | ❌ **无** |

> **更正**：初稿写"`AppShell.tsx` 零测试"是错的。我查的是 `components/AppShell.test.*`，而实际的文件叫 `AppShell.mobile-toolbar.test.mjs` / `AppShell.auto-name.test.mjs` / `AppShell.file-viewer-state.test.mjs` / `AppShell.terminal-tab.test.mjs` / `AppShell.workspace-memory.test.mjs`——**5 个文件共 24 个测试**。真正没有测试的是 `extension/robin/research.ts`。

#### AppShell 的依赖分析（2026-09-16）

吃过 §2.1 的教训，**先量再拆**。`node scripts/analyse-hook-deps.mjs components/AppShell.tsx`：

```
40 state + 18 ref，68 个单元 → 61 个在同一个连通分量
最好的单刀：删 selectedSession，61 → 53
```

和 `useAgentSession` 一样没有割点。但**逐个试探主题分组之后，找到了一个真接缝**：

| 拿掉哪一组 | 团从 61 变成 |
|---|---|
| **面板可见性**（`sidebarOpen` `rightPanelOpen` `activeTopPanel` `topPanelPos` `mobileToolbarMoreOpen` `mobileSidebarReady`） | **43** ✅ |
| 会话选择（9 个） | 50 |
| 文件页签（3 个） | 58 |
| ChatWindow 状态镜像（9 个） | 58 |
| 终端 / 项目信任 / 设置弹窗 | 60 / 60 / 61 |

**面板那一组放出 18 个单元**，而且放出来的正是它自己的逻辑：`toggleTopPanel`、`handleSidebarToggle`、`handleRightPanelToggle`、`handleMobileToolbarMoreToggle`、`openSessionStatsPanel`，加上三个响应式宽度 helper 和几个 effect。

这是本次分析里唯一一个「拿掉一组状态，逻辑跟着整块走」的地方——`useAgentSession` 里一个都没有。

**而且几何部分已经拆出去了**：`lib/panel-layout.ts`（断点与 clamp）和 `hooks/useResizablePanel.ts`（拖拽手势）都已存在。留在 `AppShell` 里的只剩「面板开着还是关着」这一层状态——也就是说这一刀只差最后一步。

#### 已做：抽出 `lib/shell-panels.ts`（2026-09-16）

按仓库自己的先例（`agent-stream-lifecycle.ts`）做成**纯 reducer**，不碰 React：

```ts
shellPanelReducer(state, event, viewport) → state
```

`state` 是四个面板的开关，`viewport` 由 `useIsMobile()` 传进来而不是存一份（存一份会漂）。14 个事件，12 个测试。

收回的规则：

- **手机上四个面板互斥**——每个都是全宽的，同时开两个等于一个都没开。这条原本是 `if (isMobile) setSidebarOpen(false)` 在 **8 处**重复
- 溢出菜单只在"点击来自菜单内部"时保留（`keepMobileToolbar`），从工具栏点则收起
- 失去存在理由的面板自己关掉（没有分支了就关分支面板）
- 搜索快捷键在任何视口都打开侧栏

| | 改前 | 改后 |
|---|---|---|
| `useState` | 42 | 38 |
| 内联 `if (isMobile) set…` | 8 | **0** |
| 面板规则的测试 | 0（只有 source-grep 间接钉） | **12 个行为测试** |

#### 预测又偏了：61 → 56，不是 43

模拟说拿掉面板组团会变 43，实际只到 56。

**和 §2.1 是同一个错误，我又犯了一次。** 模拟把 6 个变量**整个从图里删掉**，包括它们的全部写入点；实际做的是把 6 个变量合并成 1 个 `panels`，那 ~50 个写入点变成了 ~50 次 `dispatchPanel`——它们依然全都碰同一个状态，连得只会更紧。

放出来的 5 个单元，是那些**只在渲染里读**面板状态、不再写它的。

**这条规律现在有两个样本了：合并状态变量不会解耦碰它的单元，只会改变谁能写。** 要解耦得搬单元。

真正拿到的是别的东西：规则从 8 处重复变成 1 处、有了 12 个测试、`AppShell` 少了 4 个 `useState`。这些都值得，但不是"可拆性"。

#### 与 §2.1 的对照

同样的脚本、同样的方法，两个文件给出相反的答案：

- `useAgentSession`：没有任何分组能让团明显裂开 → **不该拆**，耦合来自调用方要的东西
- `AppShell`：面板组一拿掉就放出 18 个单元 → **可以拆**，而且大半工作已经做完了

「2500 行」对这两个结论毫无区分力。行数不是拆的理由。

---

## 3. 建议顺序

按 (回报 ÷ 风险) 排：

| # | 动作 | 风险 | 对应 |
|---|---|---|---|
| 1 | ✅ 补 AGENTS.md File Map + `components/robin/` 小节 | 无 | 2.2 |
| 2 | ✅ 六个域的读接口收回 domain；`store.ts` 不再被任何 route 或 `lib/` 直连 | 低（有 Todo 当模板 + 接口层测试） | 2.3 |
| 3 | ✅ `apiRoute()` 收掉 18 份 guard / 15 份 fail + 25 个内联守卫 | 低（纯机械，route 层已有测试） | 2.4 |
| 4 | ✅ 拆 `jobs.ts ↔ job-evidence.ts` 的环 | 低 | 2.6 |
| 5 | ✅ 删 `lib/session-tree.ts`、`extension/robin/capability-clusters.ts` 及其测试 | 低 | 2.7 |
| 6 | ✅ `settings.ts` → `applySettingsSection()` / `settingsView()` | 中 | 2.5 |
| 7 | 🟡 `useAgentSession`：状态机已独占自己的状态（24 处写 → 2 处）。**但拆不开**——耦合来自 `ChatWindow` 要的东西，不是 hook 自己 | — | 2.1 |
| 8 | 🟡 `AppShell.tsx`：面板规则已抽成 `lib/shell-panels.ts`（8 处重复 → 1 处，+12 测试）。团 61 → 56，仍无第二刀 | — | 2.8 |
| 9 | ✅ 量过了：`job-providers.ts` 真实接口只有 8 个导出，是深模块，不动 | — | 2.6 |

第 7 条不要和前六条混在同一批改动里。

---

## 4. 本轮之外顺手修的

- `eslint.config.mjs` 加了 `ignores: [".next-*/"]`。`.gitignore` 早就写了 `/.next-*/`，而 `next.config.ts` 里就记着用 `PI_WEB_DIST_DIR=.next-preview` 起临时实例的做法——照做一次，eslint 就去 lint 构建产物，报出 334 个不属于源码的错误。两边对齐。
