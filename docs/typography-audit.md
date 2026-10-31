# 全站字体审查

## 结论

**字体分工基本合理，但同级字号、正文行距和移动端覆盖规则还没有真正统一。** 不能把当前状态称为“所有页面都协调”。最值得先修的不是换字体，而是两个共享 CSS 覆盖问题：输入框的 16px 下限被写成了固定字号；正文字号被提高后，行距仍按 13px 根字号换算。

本报告记录修复前的审查快照：该轮没有修改应用样式或用户数据。后续已按 [统一排版规范](typography.md) 修复共享字段下限、正文行距、同级页头与重点手机操作；下文的 Before/After 保留为历史证据，当前规则与验证范围以规范为准。

## 范围与证据

- 盘点当前 31 个 `app/**/page.tsx` 路由文件。
- 静态扫描 `app` 的 CSS 与 `components` 的 CSS/TSX，共 266 个文件，其中 64 个样式表；提取 3,097 行字号、字体、字重、行距及相关 utility 声明。数量是检索候选，不代表缺陷数量。
- 浏览器检查 26 个页面/视图配置：Home 四个 tab、邮箱、AI 周报、求职、活动、看板、设置、学习中心、课程、FSO 路线图、GPT-2、视频清单、刷题、Notes、Obsidian 阅读、研究首页/课题、产品项目、市场验证、工具箱、录音、外联、Chat 空状态。
- 104 份视图快照：中文 390px Glass、中文 320px Dark glass、中文 1440px Glass、英文 390px Dark glass。最初的看板 fixture 缺少 capacity/google，修正 fixture 后单独复查通过；不将测试数据导致的错误当成产品缺陷。
- 主轮使用触控能力模拟；额外用普通鼠标环境复查 Product / Research / Learning，区分宽屏触控设备与普通桌面。
- 用 `getComputedStyle` 读取实际字号、字重、字体栈、行距，结合截图，而不只根据 CSS 声明推断。
- 所有应用 API 使用模拟数据，不发送真实 prompt、不修改个人记录。初始页面和浅层/空状态覆盖不代表所有展开、错误、弹窗、长列表都已测试。

本轮的原始材料（临时文件，不保证长期保留）：

- `/tmp/pi-typography-audit/source-inventory.txt`
- `/tmp/pi-typography-audit/metrics.json`
- `/tmp/pi-typography-audit/*.png`
- `/tmp/pi-typography-kanban/`：修正 fixture 后的看板截图
- `/tmp/pi-typography-mouse/`：普通鼠标环境对照
- `/tmp/pi-typography-audit.mjs`：只读采样脚本

## 发现：按修复价值排序

| 优先级 / 位置 | Before：实际状态 | After：建议 | 原因 |
| --- | --- | --- | --- |
| P2 · `app/globals.css:5840–5847`；`components/robin/ProductIdeas.module.css:36,100`；`components/robin/ResearchWorkspace.module.css:42,230` | 全局防 iOS 缩放规则是 `font-size: 16px !important`。Product 项目名本应手机 26px / 桌面 30px，却在手机和宽屏触控设备都只有 16px；Research 目标本应手机 18px / 桌面 20px，也被压到 16px。普通鼠标桌面对照分别恢复为 30px、20px。 | 保留 **至少 16px** 的字段下限，同时保留标题型 input、重点 textarea 自己更大的字号。使用明确的字段字号约定，不继续逐处堆叠补丁。 | “防止过小”变成了“全部缩成同样大”，削弱标题层级。Notes 已有局部 `24px !important`，所以同类标题在不同工作区表现不一致。 |
| P2 · `app/globals.css:2108–2117`；`components/robin/LearningShelf.tsx:39` | `.text-sm` 被改成 15px，但行距仍为 `1.375rem`，实际仅 **17.875px（1.19 倍）**；`.text-xs` 是 13px / 14.625px（1.125 倍）。Learning 的 `leading-relaxed` 被该规则覆盖，Jobs、Events、Product、Outreach 的多行说明也受影响。 | 连续正文使用约 1.5–1.7 倍行距；单行标签、数据与紧凑控件另设规则。不要用高优先级容器选择器统一覆盖所有 `.text-sm` 的行距。 | 中文多行说明容易挤在一起；手机因另一条覆盖反而更松，桌面/手机切换时密度突变。 |
| P2 · `components/robin/Dashboard.module.css:17`；`app/globals.css:3452`；`components/robin/FsoWorkspace.module.css:144`；`components/robin/RecordingsWorkspace.module.css:78`；`components/robin/ToolboxWorkspace.module.css:149` | 手机同级页标题：Home 24px，邮箱/求职/学习 26px，FSO 28px，录音 32px，工具箱 36px。相邻页面像采用了不同的标题尺度。 | 常规工作区手机页头统一 24px 衬线常规字重；斜体作为这一层级的稳定特征。文档内容标题、课程文章标题、设置表单标题按角色保留例外，而不是全站 `h1` 一刀切。 | 工具箱标题比 Home 大 50%，跳转时最明显。Home 四个 tab 本身已经统一，不需要重改。 |
| P2 · `components/robin/NotesWorkspace.module.css:371,384,729`；`components/robin/ObsidianWorkspace.module.css:8,101,136`；`components/robin/FsoWorkspace.tsx` 的页头操作及其 shared button 样式 | Notes 的“笔记库 / 笔记 / 编辑 / 预览”等实际只有 **11px**；Obsidian 的“刷新 / 阅读 / 笔记预览”也是 11px；FSO 的“路线图 / 笔记本”仅 **10px**。 | 手机常用操作建议 13–14px，次级说明 12–13px；保留至少 44px 点击区。数字角标、图谱密集刻度可以例外，不盲目放大所有小文字。 | 点击范围足够不代表文字好读；当前入口文字和 16px 字段、24px 标题之间落差过大。 |
| P3 · `app/globals.css:855–869,3452`；`components/robin/LearningHub.tsx:22`；`components/robin/JobsBoard.tsx:557` | 根字号是 13px，Tailwind `text-3xl` 实际为 **24.375px**；手机却又被固定覆盖成 26px。Learning / Jobs / GPT-2 / Watch 因而出现“桌面标题比手机更小”，Product 页头也有 24px → 26px 的类似倒挂。 | 页头用明确的共享角色字号，不混用默认 16px 根字号假设、局部 px 和全局手机覆盖；不要为解决标题问题修改全站根字号。 | 全局改根字号会连带改变间距、控件和代码；应在排版角色层修复。 |

### 代表性页头实测

以下均为页面外壳标题，不含文档正文标题。桌面一栏是 1440px 视口；本表所列页头不依赖触控/鼠标能力。

| 页面 | 手机 390px | 桌面 1440px |
| --- | ---: | ---: |
| Home 日期 / Calendar / Tasks / More | 24px | Home 32px |
| 邮箱 | 26px | 36px |
| 求职 | 26px | 24.375px |
| 活动 | 26px | 44px |
| 学习中心 / GPT-2 / 视频清单 | 26px | 24.375px |
| FSO 路线图 | 28px | 34px |
| 看板 | 24px | 28px |
| Research 课题 | 24px | 28px |
| Product 外壳 | 26px | 24px |
| 录音转写 | 32px | 40px |
| 工具箱 | 36px | 48px |

## 合理之处：不建议为了“统一”而抹平

- **衬线标题/阅读、系统 UI 控件、等宽代码/路径/数据**的分工本身成立。没有必要只留下一个字体栈。
- Home 日期和其他三个 tab 的 24px 衬线斜体已经一致；日程主时间 34px、事件标题 18px、任务正文 15px 是有意义的内容层级，不是字号失控。
- 设置属于密集表单，用系统 UI 正体与较明显的字重是合理例外；不应该把字段说明改成衬线斜体。
- Obsidian 完整阅读的 18px 正文、正体章节标题是阅读模式，不应套用 24px 手机导航页头规则。长文的 h1/h2 也不必和工作区页名同号。
- 代码、Markdown 源码编辑、文件路径、终端继续保留等宽字体。Notes 编辑状态显示等宽、预览显示阅读字体是角色切换，不是错误。
- 主 Chat、Notes 助手、练习助手、产品伙伴、Research / 论文侧聊的输入区与消息排版共用规则。`e2e/workspace-chat-style.mjs` 本轮通过，覆盖四主题、320/375/1440px 以及模拟草稿/发送/工具展开。
- 已采样状态未发现页面根级横向溢出；这不能推导出所有局部文本都没有截断。目录省略、地图横向平移等需要按其交互语义单独判断。

## 建议收敛的排版角色

这些是下一轮的设计建议，尚未执行：

| 角色 | 建议基准 |
| --- | --- |
| 手机工作区页头 | 24px，衬线，400，统一斜体 |
| 桌面常规工作区页头 | 约 28–32px，按同一 token 使用 |
| 分区标题 | 18–22px，不与页头抢层级 |
| 普通正文 | 15–16px，1.5–1.7 行距 |
| 专注长文阅读 | 16–18px，约 1.7–1.8 行距，保留现有阅读模式 |
| 常用操作 | 13–14px，正体，常规/中等字重 |
| 元数据 / 辅助说明 | 12–13px；小角标/图表刻度明确例外 |
| 输入字段 | 至少 16px；标题型字段可更大，不能被全局规则缩小 |
| 代码 / 路径 / 数值表 | 等宽；需要比较的数字使用 tabular-nums |

优先顺序：**字段字号下限 → 正文行距 → 页头角色 → 手机小字操作**。前两项是可复现的 CSS 问题；后两项带有审美取舍，应局部验证，而非全局粗暴替换。

## 未覆盖与限制

- 没有物理 iPhone、Safari/iOS 系统文字放大或真实字体回退的验证；Chromium 截图不能保证所有设备上的中英文笔形完全一致。
- 本轮浏览器未逐态覆盖简历 PDF、Mac 图表、所有外联子视图、活动详情、登录页，以及第三方课程/题目 iframe；它们不能被标记为“全部通过”。PDF/外部课程正文也不应强行改成本站字体。
- 没有对全站每一种主题、每个禁用/错误/弹窗状态做像素对比度认证；Glass/Dark glass 为主要采样主题，聊天另有四主题回归。
- `e2e/design-continuity.mjs` 在定位产品页旧的 `My ideas 25` 按钮时超时，未执行到后续 Settings 检查；本轮不把该脚本算作通过，也不因此认定设置字体有问题。
- 审美一致性不是二元测试结果。当前有明确可修的问题，也有应保留的角色差异；报告不能作为“所有地方都不会突兀”的保证。
