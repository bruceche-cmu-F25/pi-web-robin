# Robin —— pi-web 的个人仪表盘

[English](./README.md)

待办、日历、链接收藏，全部由 pi 驱动。数据是 `~/.pi/robin` 下的普通 JSON 文件，
而能碰这些数据的 agent 被限制在固定工具白名单内——没有 shell，没有文件系统。

- **仪表盘** 在 `/dashboard` —— 助手输入框、日历（议程 / 周 / 月）、待办、链接。
- **agent 工具** 在仪表盘、`pi` CLI 和 Telegram 里都能用。
- **Google 日历** 只读接入，合并进日历视图。
- **Gmail** 只读接入：`/dashboard/gmail` 看收件箱，每日邮件简报推到 Telegram。
- **学习中心** 在 `/learn` —— 入口页：两条轨道的入口，以及学习链接书架。别的都不放。
- **编程工作台** 在 `/coding` —— 两条轨道：**刷题**内嵌 NeetCode 路线图，旁边坐着一个
  只给提示、不给答案的教练；**课程**是一份能直接点开的大纲，旁边坐着一个负责讲清楚、并把
  每个回答锚回模块目标的导师。两边都带你自己的记录。
- **Telegram 桥接** 让同一个助手在你离开电脑时也能用 —— 命令、inline 按钮、
  语音消息，以及四种主动推送。

---

## 安装

### 1. 扩展

pi 从 `~/.pi/agent/extensions` 加载扩展。把这个目录软链过去：

```bash
ln -sfn "$PWD/extension/robin" ~/.pi/agent/extensions/robin
```

不需要构建步骤——jiti 直接导入 TypeScript。

> **改动 `extension/robin` 下的任何文件都必须重启 pi-web**（或 `pi` CLI）。扩展
> 在会话启动时加载并缓存，运行中的会话会一直用旧的工具定义。`components/robin`
> 下的 React 组件是正常热更新的。

### 2. 启动 pi-web

```bash
npm run dev
```

然后打开 <http://localhost:30141/dashboard>，或者点侧边栏顶部「+ New」旁边那个网格图标。

> 开发期间**不要**跑 `npm run build`——见 AGENTS.md，它会污染 `.next/` 并弄坏
> `npm run dev`。

### 3. 凭据（可选）

Google 和 Telegram 在 **/dashboard/settings** 里配置，不放 `.env.local`。值存在
`~/.pi/robin/secrets.json`，权限 `0600`，每次请求时读取，所以改完立即生效、不用
重启服务器。同名环境变量仍作为回退，设置页会标注某个值是否来自环境变量。

页面从不显示已存的密钥原文——只显示是否已设置和末四位。服务端不会把密钥发回浏览器。

---

## agent 能做什么

工具白名单在 `tools.ts`；注册逻辑按领域拆在 `*-tools.ts` 模块里，由 `index.ts` 组合：

| 工具 | 你可以这样说 |
| --- | --- |
| `todo_add` | 「明天要交房租」 |
| `todo_update` | 「把交房租改到周五」 |
| `todo_delete` | 「删掉交房租」 |
| `todo_complete` | 「洗车那个做完了」 |
| `todo_list` | 「还有什么没做」 |
| `calendar_create_event` | 「周四下午3点到4点设计评审，在会议室B」 |
| `calendar_list_events` | 「今天有什么安排」 |
| `link_add` | 直接粘一个网址 |
| `link_list` | 「我存过哪些链接」 |
| `gmail_list` | 「今天有什么重要邮件」 |
| `gmail_get` | 「读一下那封面试邮件」 |
| `gmail_review` | 邮件检查回合用它保存分类结果 |
| `provider_usage` | 「OpenAI 和 Anthropic 额度还剩多少，何时重置」 |
| `job_profile` | 评分前读取 CV 和求职规则 |
| `job_pending` | 列出待评分职位 |
| `job_score` | 给一个职位打匹配分 |
| `job_list` | 「看看最好的职位线索」 |
| `job_status` | 标记 shortlist / applied / dropped |
| `job_scan` | 扫描配置过的职位源 |
| `practice_current` | "这道题该怎么下手？" |
| `practice_list` | "双指针还剩哪些没做？" |
| `practice_record` | "做出来了，花了 20 分钟" |
| `practice_status` | "把 Valid Anagram 标成已解" |
| `practice_note` | "记一下：先排序再比较" |
| `practice_due` | "今天该复习什么？" |
| `study_current` | "这一页是干嘛的？" |
| `study_outline` | "架构这条线是怎么串起来的？" |

几个值得知道的行为：

- **日期区间是一个事件。**「19号到22号去芝加哥」会变成一条带 `endDate` 的事件，
  而不是四条。
- **粘链接会抓真实标题。** `link_add` 去取页面的 `<title>`，而不是从 URL 猜；
  工具返回值会说明标题的来源。
- **`calendar_list_events` 包含 Google 事件**，和仪表盘显示的一致，并标注为只读。
- **相对日期按你的本地日期解析**，列表类工具会在输出里显式说明当天日期。
- **订阅额度直接向 Provider 查询。** `provider_usage` 使用 Pi 已管理的 OpenAI Codex
  和 Anthropic OAuth 登录，只返回百分比和重置时间，不暴露令牌。这些 Provider
  专用接口不是稳定的统一标准，未来可能变化。

### 刻意做不到的

- **没有 shell，没有文件系统。** 助手会话只激活工具白名单，pi 自带的 `bash`、
  `read`、`write`、`edit` 全部不激活。这是工具注册层面的边界，不是提示词约束。
- **不写 Google。** 只读接入：能看到你的 Google 日程，但加不了、改不了、删不了。
- **不能删除。** 没有注册删除类工具。删待办、日程或链接要在仪表盘上点。远程删除
  数据的风险和收益不对等。

---

## 仪表盘

**助手输入框** —— 打一句话，agent 执行，面板立即刷新。回复下面那行（「记了待办」）
来自**真实执行过的工具调用**，不是模型自己说的。

**日历** —— 三个视图，按浏览器记住选择：

- **议程** —— 未来三天出详情，其余每天压成一行。
- **周** —— 时间网格，顶部有全天条。同时段重叠的事件并排分列。网格按内容高度
  渲染（默认 07:00–22:00，自动扩张以覆盖所有事件），所以不会吞掉页面滚动。
- **月** —— 从本周开始的滚动四周窗口，不是自然月。跨天事件画成一条连续横条。

**待办** —— 按 已逾期 / 今天 / 明天 / 之后 / 未定日期 分组；当天完成的保留在底部，之前完成的不显示。

**链接** —— 按分组显示，带 `rel="noopener noreferrer"` 打开。

界面跟随 pi-web 顶栏选择的语言，日期格式也跟着切换。

---

## 刷题工作台

`/learn` 是入口：两个入口卡、一排学习链接书架，以后要加第三个入口也加在那里。只有
刷题那个入口带数字，因为只有那一侧记数。每个入口直接落到对应轨道（`/coding?track=curriculum`），并把它记成默认。

**书架是同一批资源的另一种排法。** 大纲按教学顺序排：什么必须先懂。书架保留这份清单
最初被收集时的分组，那是你**已经知道要找什么**时找回它的方式。书架存的是条目
id 而不是 URL，所以两边永远不会对"这个链接指向哪"产生分歧。仪表盘上保存的链接是另一
回事，属于一天中的另一段时间，仍留在原处。

`/coding` 是两条轨道。**刷题**三栏：路线图轨 + NeetCode 本体 + 教练。**课程**两栏：
大纲 + 导师——因为没什么值得内嵌的，目录里三分之二要么是里程碑、要么是明确拒绝被内嵌
的站点，而教程放在真正的标签页里也比塞进一个我们控制的窄框里好读。课程的资料就开在
标签页。你在哪条轨道上是浏览器偏好；每条轨道上打开的是什么则是服务端状态，因为
agent 要读它。

**用户在看什么，对我们是个黑盒。** 跨域 frame 什么都不会告诉我们——读不到它的地址，
也不知道你解出了什么；我们打开的标签页告诉得更少。所以点击不是装饰：**点哪一个，才是
告诉服务端你正在看哪一个**，而这条记录是右边那个 agent 能回答"这一个"的唯一依据。
刷题那栏的 frame 里是 NeetCode 自己的题目页，带 Python 编辑器和判题，所以不用离开
这个页面就能把题做完。

**题库在本地。** `neetcode-catalog.ts` 由
[neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode) 的
`.problemSiteData.json`（MIT）生成，并在生成时从站点 bundle 里读出 NeetCode 自己的
每题 slug —— NeetCode 150 全部 150 道都有，所以默认清单上的每道题都能内嵌。没有的
那些链去 LeetCode，因为 LeetCode 拒绝被内嵌。重新生成：

```bash
node scripts/refresh-neetcode-catalog.mjs
```

运行时不向 NeetCode 请求任何东西，所以不管 frame 加载得成不成，路线图轨、你的记录
和复习队列都照常工作。

**教练只给提示，不给答案。** 它跑在自己的会话里，只有六个工具，并且**没有任何取答案
的途径**——没有 shell、没有文件系统、没有会返回实现的工具。它按提示阶梯往上爬（先问
你试过什么 → 点出模式 → 给关键不变量 → 讲清算法 → 只有你明确要求才写代码），并把爬到
第几级记进记录里：需要四级提示才解出来的题，理应比一次没要提示的更早回来。

**记录**存在 `~/.pi/robin/practice.json`。每道题有状态、历次尝试、笔记，以及由掌握度
推出的复习日期（1/3/7/21/60 天）。状态和笔记可以在面板里手改；教练通过工具写的是同
一份记录。

---

### 课程轨道

第二条轨道把路线图换成大纲、把教练换成导师，并且去掉了中间那栏：大纲本身就是页面，
上面每一份资料都开在新标签页。使用习惯完全一样，只是少了一栏。

**这是课程，不是收藏夹。** `curriculum.ts` 是手写的，不是生成的——因为**顺序本身就是
内容**：六条线（语言基础、全栈、Python 工程、架构与系统设计、项目健身房、审美与动效），
每个模块都写明「学完你应该能做到什么」，并以一个必须动手做出来的里程碑收尾。

**这一侧不记录任何进度。** 没有状态、没有计数、没有复习队列，也没有任何能写这些的
工具——导师想把一章标成"读完"都无处可写。刷题那侧记数，是因为复习计划的好坏完全取决
于它对"你解出过什么"的记录；读书不是这么回事，给阅读加进度条，量的恰恰是唯一不重要
的那个东西。roadmap 负责说清有什么、每个模块是为了什么；你从中拿到了什么，是你自己
的事。

**这一侧只做入口。** 每个条目都是通往别处的一扇门，点了就在新标签页打开，所以目录里
不再记录谁允许被内嵌——frame 没了，这件事也就不重要了。

**导师负责讲清楚，教练负责不讲。** 这是两件相反的事——别人替你解的题什么都教不会你，
但没人讲的概念永远只是个词——所以两者跑在各自的会话里、各有各的工具。导师会把每个
回答锚在模块的 outcome 上，在诚实的前提下尽量往系统层面带，并且**不会替你把没做完的
标成做完**。

**存储**只有一个文件 `~/.pi/robin/study-state.json`，里面是两个 id：最近打开的资源，
和大纲正在显示的那条线。前者的存在纯粹是机械原因——它开在的那个标签页不归我们看，否则
导师根本无从回答关于"这一页"的问题。

### 分栏宽度

每条缝都能调：拖它、双击复位、或者聚焦后用方向键微调。宽度按浏览器保存，并且两条
轨道共用——同一个工作台，同一套布局，读书时拉宽的面板，回去刷题还是那么宽。**缝之间
那栏有 320px 的下限**，不管两侧要多宽：在刷题轨上它装的是一整个第三方应用，90px 宽的
编辑器不是"小一号的功能"，是功能没了。

拖动能穿过 frame，靠的是缝会捕获指针。否则光标一进跨域 iframe，普通的 move 监听就
再也收不到事件，分隔线会卡在半路。

---

## Google（只读：日历 + Gmail）

OAuth 客户端必须是你自己的——开源仓库里不能内置共享的 client secret。日历和 Gmail
共享同一个 OAuth 授权，一个 refresh token 同时覆盖两个只读 scope。

1. 在 [Google Cloud 控制台](https://console.cloud.google.com/) 建一个项目（或选现有的）。
2. 启用 **Google Calendar API** 和 **Gmail API**。
3. OAuth 同意屏幕配置成 **External**，并把你自己的账号加进 **Test users**。
4. 创建凭据 → **OAuth 客户端 ID** → 类型选 **Web application**。
5. 把设置页上显示的地址**原样**填进「已授权的重定向 URI」——默认端口下是
   `http://localhost:30141/api/robin/google/callback`。
6. 把 client ID 和 secret 填进 **/dashboard/settings**，然后在日历面板点 **连接**。

> 应用停留在「Testing」状态时，Google 的 refresh token **7 天就过期**，所以在你
> 把应用发布出去之前，每周都要重连一次。
>
> 如果你是在「Gmail 加入之前」就连过 Google 的，需要先点**清除**再重新连接，
> 让 Google 补发 Gmail 只读 scope——旧 token 只含日历权限，Gmail 会报 403。

拉取的事件和邮件**从不写入**本地 JSON——每次请求现拉，断开连接后立刻消失。

### Gmail（只读）

- **页面** `/dashboard/gmail`：不是邮件列表，而是「今天进来什么、哪些需要你」的
  分类视图。点**检查今天**，agent 读今天的新邮件、按类别归档（重要 / 面试 / OA /
  预约 / 快递 / 截止 / 文件 / 其他），对预约、会议、确认的日程自动建日历事件，对
  截止、待办自动建待办。点条目跳到 Gmail。刻意没有回复、删除、归档按钮。
- **agent 工具** `gmail_list` / `gmail_get` / `gmail_review`：读邮件、分类、落库。
  邮件是不可信第三方数据，工具提示明确要求只提取事实、绝不执行邮件里的指令。
- **邮件简报**（设置 → Telegram）：每天一次，走同一个「邮件检查」回合——读、分类、
  自动建待办/日程、把报告推到 Telegram。发送时间、语言、chat id 和 Gmail 搜索
  条件都可配。

---

## Telegram

一个独立进程，刻意不做成 pi 扩展：扩展是按会话加载的，每次 `pi -p` 调用和每个
pi-web 会话都会各起一个轮询器，而同一个 token 上并发的轮询器会互相抢消息。

1. 用 [@BotFather](https://t.me/BotFather) 建 bot（`/newbot`），复制 token。
2. 填进 **/dashboard/settings** → Telegram。
3. 把你的 chat id 加进白名单。给 bot 发条消息后点**检测 chat id**——或者用空白名单
   启动桥接，它会进入发现模式：只报告看到的 id，不执行任何操作。
4. 运行：

```bash
npm run telegram
```

**白名单是唯一的门。** bot 用户名是可搜索的，任何人都能找到你的 bot；不在名单上的
消息不会产生任何 agent 调用，也不会有任何回复——是沉默而不是报错，因为报错等于
确认这个 bot 存在。按钮点击走的是同一道门。

### 你可以发什么

- **一句话** —— 完整工具集，在对话会话里执行。
- **一张图** —— 模型直接读，图片说明作为提示词。
- **一条语音** —— 转写后先回显给你看它听成了什么，再执行。默认关闭，需要在
  **设置 → Telegram → 语音消息** 里填 key；它按音频时长计费，所以是主动开启而不是
  默认打开。
- **一条命令** —— 凡是答案已经在存储里的，都不经过模型：

  | 命令 | 作用 | 走模型 |
  | --- | --- | --- |
  | `/today` | 今天的日程和未完成待办，每条带**完成**按钮 | 否 |
  | `/jobs` | 最值得看的职位，带处理按钮 | 否 |
  | `/mail` | 读并归档今天的邮件 | 是 |
  | `/usage` | OpenAI 和 Anthropic 的额度窗口 | 是 |
  | `/status` | bridge 运行时长，以及 pi-web 是否可达 | 否 |
  | `/reset` | 开一段新对话，忘掉当前上下文 | 否 |
  | `/help` | 上面这张表 | 否 |

  `/today` 以前要跑一整个两分钟的 agent 回合，来回答一个两次 GET 就能答的问题。
  不认识的命令会落回模型，所以一句碰巧以斜杠开头的话仍然正常工作。

### 按钮

求职推送、`/jobs` 和 `/today` 都带 inline 按钮——职位是候选 / 已投 / 丢弃，待办是
完成。**按下去不经过模型**：payload 是桥接自己写的，所以处理它是一次查表加一次
`PATCH`，而不是一次理解。`parseCallback` 只接受按钮能产生的那几种 payload，其余
一律拒绝。

按过的按钮会从消息上撤掉，旁边的链接按钮会留下——你把一个职位标成「已投」的那一刻，
恰恰最可能想点开它。键盘只记在内存里：重启后残留的按钮依然能用，因为按钮背后的每个
操作都是幂等的。

### 四种推送

都在**设置 → Telegram** 里配置，也都按 chat 记录投递状态，所以重启桥接或重试部分
失败的群发不会重复发送。

- **每日简报** —— 定时推送今天的日程和未完成待办，每条待办带**完成**按钮。
- **邮件简报** —— agent 读最近的邮件、分类、把发现的待办和日程建好，然后汇报。
  Google 没连接时当天跳过，不会每小时重试。
- **求职推送** —— 每天两次：扫板、给积压的职位打分、推最好的那些，带编号的处理
  按钮。另有一次夜间全量扫描走完整个 ATS 目录。
- **日程提醒** —— 在事件开始前若干分钟提醒一次，包含 Google 日历。它不绑定固定
  时刻，而是跟着轮询周期走（每 30 秒一轮）。严格只看未来，所以早上十点重启不会把
  一上午的事重播一遍。

### 值得知道的性质

- **长轮询，不用 webhook。** 机器上不监听任何公网端口，不需要证书或内网穿透。
- 桥接通过 HTTP 调用 pi-web 的 `/api/robin/assistant`，所以它**继承同一套工具边界**，
  而不是另起一套。
- 回复跟随发送者的 Telegram 客户端语言。
- **Markdown 会被渲染。** 模型写的是 Markdown，Telegram 认的是一小撮 HTML；
  `format.ts` 负责转换并切分，保证代码块不会跨消息断开。Telegram 拒绝解析的消息
  会退回纯文本重发，而不是丢掉。
- **每个回合都显示"正在输入"**，每四秒刷新一次——两分钟没有任何反馈，和 bot 挂了
  是分不出来的。
- **设置每轮都会重读。** 在仪表盘上改发送时间或白名单，一个轮询窗口内就生效。唯一
  的例外是 bot token：它是桥接长轮询的地址本身，改它仍然要重启。
- **轮询和定时任务并行。** 一次求职推送要扫板、打分、等打分器跑完，最坏二十分钟；
  它不再把轮询器一起堵住。
- **按 chat 限流** —— 令牌桶，突发 5 条、每分钟 12 条。白名单挡住了陌生人，所以
  这是成本上限而不是安全控制。
- **pi-web 必须在运行。** 桥接是它的客户端；pi-web 停了，每条消息都会回错误。
  `/status` 会同时报告两者。

### 让它一直活着

桥接一挂，所有提醒、推送和回复都跟着停，而且不会有任何提示。macOS 上：

```bash
scripts/telegram/launchd/install.sh
```

这会装一个带 `KeepAlive` 的 launchd **user agent**——不是 daemon：它以你的身份运行、
需要你的主目录，也没有理由在你登录之前就启动。日志写在 `~/.pi/robin/logs/`。加
`--with-pi-web` 可以把 pi-web 一起纳入守护（走已发布的 CLI，而不是 `npm run dev`
——被守护的服务不该是个开发服务器），`--uninstall` 移除两者。

---

## 数据

全部在 `~/.pi/robin`（可用 `ROBIN_DATA_DIR` 覆盖）：

| 文件 | 内容 |
| --- | --- |
| `todos.json` | 待办列表 |
| `events.json` | 本地创建的日历事件 |
| `links.json` | 保存的链接 |
| `assistant.json` | 交互助手与只读简报助手使用的 pi 会话 id |
| `telegram-state.json` | 当天已成功发送每日简报的 chat |
| `secrets.json` | Google、Telegram、转写凭据和 Telegram 设置 —— **权限 0600** |
| `google.json` | Google refresh token —— **长期有效的凭据，权限 0600** |
| `gmail-digest-state.json` | 邮件简报每天向哪些 chat 发过 |
| `mail-review.json` | 今天邮件的分类检查结果 |
| `reminder-state.json` | 哪些事件已经提醒过 |

前五个刻意用普通 JSON：可以 grep、可以进 git、可以像普通文件一样备份。

`secrets.json` 和 `google.json` 是例外——它们存的是你日历和消息账号的长期凭据。
不要放进任何你不会放密码的仓库或同步目录。

---

## 开发

### 模块边界

客户端组件只能从纯逻辑模块导入。被导入模块的依赖图里**任何一处** `node:fs` 都会
弄坏浏览器打包——Turbopack 会直接报错而不是警告。

| 模块 | 可进客户端 | 内容 |
| --- | --- | --- |
| `dates.ts` | 是 | 本地日历日期、周/月网格计算 |
| `events.ts` | 是 | 事件模型、排序、分组 |
| `layout.ts` | 是 | 重叠分列、跨天条泳道 |
| `links.ts` | 是 | 链接模型、URL 规范化、分组 |
| `tools.ts` | 是 | 助手的工具白名单 |
| `*-tools.ts` | **否** | 服务端工具注册模块 |
| `toolkit.ts` | **否** | 共享工具返回值辅助函数 |
| `store.ts` | **否** | 文件读写 |
| `paths.ts` | **否** | 数据目录与原子 JSON 读写 |
| `settings.ts` | **否** | 凭据存储 |
| `fetch-title.ts` | **否** | 出站抓取页面标题 |
| `google-calendar.ts` | **否** | OAuth 与 Google 日历拉取 |
| `gmail.ts` | **否** | 只读 Gmail 列表 / 详情拉取 |

从服务端模块里 `import type` 是安全的——类型导入会被擦除。

### 桥接的模块

`scripts/telegram` 是第二个、更小的模块边界。那里没有任何文件 import `bridge.ts`，
所以它组合起来的各个处理器都能脱离它单独测试：

| 模块 | 内容 |
| --- | --- |
| `bridge.ts` | 组合层：轮询循环、定时任务，以及一条消息意味着什么 |
| `protocol.ts` | Telegram 的线上格式 → 桥接自己的格式。纯函数 |
| `format.ts` | Markdown → Telegram HTML，以及不会切坏它的分块。纯函数 |
| `telegram-api.ts` | Telegram 客户端：发送、编辑、输入指示、文件下载 |
| `pi-web.ts` | pi-web 客户端，含一次 assistant 回合 |
| `commands.ts` | 斜杠命令 |
| `callbacks.ts` | 按钮词汇表，以及按下去做什么 |
| `reminders.ts` | 哪些事件快开始了 |
| `ratelimit.ts` | 按 chat 的令牌桶。纯函数 |
| `transcribe.ts` | 语音 → 文字 |
| `schedule.ts` | 哪些推送到点了、发给哪些 chat。纯函数 |
| `launchd/` | user agent 模板及其安装脚本 |

### 时间

两类值，绝不混用（详见 `dates.ts` 文件头注释）：

- **本地日历日期**（`YYYY-MM-DD`）和**墙上时间**（`HH:MM`）—— `Todo.due`、
  `CalendarEvent.date` / `endDate` / `start` / `end`。是用户说「明天下午三点」时
  指的东西，永不做时区转换。
- **时刻**（UTC ISO）—— `createdAt`、`completedAt`。表示某件事发生的瞬间。

用 `new Date().toISOString().slice(0, 10)` 取「今天」正是这个划分要防的 bug：在
UTC 以西的时区，每天下午它就提前跳到第二天。请用 `localDate()`。

`endDate` 是**闭区间**——「19 号到 22 号」包含 22 号当天。Google 的全天事件 API
用的是开区间，所以 `google-calendar.ts` 会做转换。

### 测试

```bash
npm test
```

日期计算、布局算法、Google 事件映射、Telegram 协议、凭据存储都有直接的单元测试，
因为这些地方出错时在界面上很难看出来。

---

## 对上游 pi-web 的改动

Robin 基本是纯增量的。新增目录：`extension/robin`、`components/robin`、
`app/api/robin`、`app/dashboard`、`scripts/telegram`。

动了八个已有文件：

| 文件 | 原因 |
| --- | --- |
| `README.md` | 指向本文档的入口 |
| `components/SessionSidebar.tsx` | 侧边栏顶部的仪表盘入口 |
| `lib/i18n/messages/en.ts`、`zh-CN.ts` | 仪表盘文案 |
| `lib/request-security.ts` | 让 Google OAuth 回调豁免同源检查——跨站重定向永远过不了那道检查，改由 `state` nonce 认证 |
| `lib/request-security.test.mjs` | 把这个豁免锁死在一个路径、一个方法上 |
| `tsconfig.json` | `allowImportingTsExtensions`，因为这些模块同时被 jiti、webpack 和 Node 的 ESM 测试运行器导入，而 Node 要求显式的 `.ts` |
| `package.json` | `npm run telegram`、类型检查用的 `typebox`、测试 glob 加上 `scripts/**` |

`package-lock.json` 因为 `typebox` 这个 devDependency 而变化。上游自带的
`README.ja.md` 和 `README.ru.md` 没有动——那是上游维护的语言版本，本 fork 只维护
中英两份 Robin 文档。
