# 统一排版规范

本规范是 Pi Web / Robin 的排版约定；颜色、材质和圆角继续参照 [视觉语言](pi-visual-language.md)。[字体审查](typography-audit.md) 是修复前的历史快照，不是当前设计目标。

**统一同一种角色，不把所有文字变成同一种字体。** 工作区标题表达层级，控件服务操作，正文服务阅读，代码与数据服务精确辨认。

## 1. 字体分工

| 角色 | 字体 token | 规则 |
| --- | --- | --- |
| 常规工作区页名、分区标题 | `--font-serif` | 400，斜体；只作用于标题，不给整个容器加斜体 |
| 导航、常用按钮、表单标签、保存反馈 | `--font-ui` | 正体，默认常规字重；强调可用 500–600，不靠全大写和过大字距制造层级 |
| 普通正文 | 所在阅读面的字体 | 保留既有衬线正文 / UI 正文，不因字号修复改掉阅读面字体 |
| 长文阅读 | 阅读模式自己的字体 | 例如 Obsidian 保留 UI 正体正文与正体章节标题；不是工作区页名 |
| 代码、路径、技术标识、需对齐的数据 | `--font-mono` | 正体；比较数值时使用 `font-variant-numeric: tabular-nums` |
| 短、固定、低频标牌 | `--font-pixel` | 少量使用；不能作为长说明、移动端常用操作或整页默认字体 |

中文使用已有 CJK fallback，不新增远程字体或无授权字体。中英、明暗主题保持相同的角色和尺寸；不承诺所有系统的实际字形一致。用户的 UI / 等宽字体偏好继续有效。Home 的日程时间使用 UI 字体是既有例外，不强制换回等宽字体。

## 2. 尺度与行距

下表是默认显示尺度，不是给每个元素强加固定 px。标题 token 使用 `max(px, rem)` 保留当前像素下限，并允许更大的根文字设置放大；浏览器缩放不得禁用。

| 角色 | ≥960px | <960px | 行距 / 字重 |
| --- | --- | --- | --- |
| 常规工作区页名 | 32px | 24px | 1.25 / 400，衬线斜体 |
| 共享分区标题 | 22px | 20px | 1.25 / 400，衬线斜体 |
| 普通正文 | 15–16px | 15–16px | 1.5–1.7；共享小正文默认 1.6 |
| 长文阅读 | 16–18px | 16–18px | 1.7–1.8，章节可用自己的字号比例 |
| 常用操作 | 13–14px | 至少 13px | 约 1.4；触控目标至少 44px |
| 元数据 / 辅助说明 | 12–13px | 12–13px | 多行约 1.5–1.6，单行紧凑标签可较小行距 |
| 普通输入字段 | 按表单设计 | 触控或≤640px 至少 16px | 保持自己的字重、字体和行距 |

小角标、图表刻度、紧凑技术仪表允许低于 12px，但不能把主要操作或关键说明藏在其中。字号和点击区域是两项独立要求，不能用 44px 点击区替代可读文字。

### 实现入口

`app/globals.css` 是共享角色的唯一尺寸来源：

- `--type-page-size`：`max(32px, 2rem)`；959px 以下 `max(24px, 1.5rem)`。
- `--type-section-size`：`max(22px, 1.375rem)`；959px 以下 `max(20px, 1.25rem)`。
- `--type-action-size`：`max(13px, 1rem)`，供常用小操作使用。
- `.pi-page-title` / `.pi-section-title`：新页优先复用；已有 CSS module 可使用同一 token，保留自己的间距、布局和颜色。

```tsx
<h1 className="pi-page-title">工作区名称</h1>
```

```css
.header h1 {
  font: italic 400 var(--type-page-size)/1.25 var(--font-serif);
}
```

不要给所有 `h1` 加手机字号覆盖，也不要继续用 `text-3xl` 猜测页名字号：项目根字号为 13px，而不是 Tailwind 示例常假设的 16px。**不得为修复标题修改全局根字号**，否则间距、代码和已有控件也会一起改变。

## 3. 字段字号：16px 是下限，不是上限

`(max-width: 640px), (any-pointer: coarse)` 覆盖窄屏、横屏手机、触控平板和配有鼠标的触控设备。全局规则为：

```css
font-size: max(16px, var(--field-font-size, 16px)) !important;
```

大于普通字段的 input / textarea **在字段自身**声明 `--field-font-size`，并在基础 `font` 或 `font-size` 中使用它。不要声明在容器上，否则普通子字段也会继承大字号；不要再添加局部 `font-size: ... !important` 对抗下限。

```css
.titleInput {
  --field-font-size: max(30px, 1.875rem);
  font: 400 var(--field-font-size)/1.5 var(--font-serif);
}
@container (max-width: 700px) {
  .titleInput { --field-font-size: max(26px, 1.625rem); }
}
```

已接入：Product 项目名（30 / 窄栏26）、Notes 标题（30 / 手机24）、Canvas 标题（22 / 手机20）、Research 目标（20 / ≤760px 18）、日程编辑标题（24）、看板说明（20）。这些是**内容编辑角色**，不要求跟外层工作区页名同号。Chat 保留自己的 `max(16px, --chat-content-font-size)` 下限，较大用户字号不可被缩小。

## 4. 正文行距与 CSS 优先级

Robin 的 `.text-sm` 是 15px、`.text-xs` 是 13px。不能继续用基于 13px 根字号换算的 `1.375rem` / `1.125rem` 行距，否则实际只剩约 1.19 / 1.13 倍。

- 共享默认行距使用无单位比例：小正文 1.6，较大文字 1.4。
- 默认行距选择器使用 `:where()` 的零 specificity；本地阅读面、控件的明确行距优先。
- Tailwind `leading-*` 通过 `var(--tw-leading, 默认值)` 保留；例如 `leading-relaxed` 仍为 1.625。
- 手机不再用高优先级 `.text-sm` / `.text-xs` 行距覆盖读写面。
- 紧凑元数据、时间、单行标签可维持独立行距；不为了“统一”把所有内容都撑成正文。

## 5. 本轮落地范围与例外

常规工作区页头接入同一尺寸：Home、邮箱、AI 周报、求职、活动、看板、学习中心、课程/学习路线、FSO、GPT-2、视频清单、播客、刷题路线、Obsidian 外壳、研究、产品、验证、工具箱及内页、录音、Mac、外联。

手机 Notes 的编辑/预览、归档操作，Obsidian 的刷新/阅读/预览等操作，以及 FSO 页头操作，改为至少 13px 的 UI 正体并保留 44px 目标。Canvas 工具栏操作同样接入。不是批量放大所有小标注。

保留的差异：

- Settings 是密集表单，保留 UI 正体和既有表单标题尺度。
- Home 主时间、事件内容标题、统计大数字不是页面名称，保留自身层级。
- Obsidian / Markdown / 课程文章、论文标题和章节使用自己的阅读尺度；全局页头规则不进入文章。
- 刷题顶部的短工作区标牌与正文路线图标题不是同一角色。
- 代码、终端、图表、导图节点、简历 PDF、第三方 iframe 不做字形或尺度统一。
- 不改路由、保存流程、会话、数据模型和用户内容。

## 6. 验收

基础回归：

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/typography.mjs
node_modules/.bin/tsc --noEmit
```

`e2e/typography.mjs` 使用模拟 API，检查 26 个页面/视图 × 320/390/1440px、中英、Glass / Dark glass 的 104 个快照：页头角色、标题字段、根级溢出和页面异常；另检查 390/812/960/1440px 的共享行距、局部 leading、较大聊天字号和根文字放大。`AUDIT_TOUCH=false` 可复查鼠标环境；`AUDIT_PAGES` 可选择页面；产物在 `AUDIT_OUT`（默认 `/tmp/pi-typography`）。所有非 GET 应用请求拦截，不提交真实数据。

共享开发服务若返回旧的全局 CSS，可像 `e2e/mobile-native.mjs` 一样通过 `E2E_GLOBAL_CSS` 替换为当前源码经 PostCSS 编译的样式，**不能叠加在旧规则上**。这仅验证源码效果，不证明运行中的服务缓存已更新；报告必须区分两者，不为测试中断运行中的会话。

本轮验证记录：

- 当前源码经 PostCSS 编译后，`typography.mjs` 的 104 个状态全部通过，零页面异常、零根级横向溢出；另有 7 个工作区 × 4 个状态的鼠标环境复查通过。
- `dashboard-phone-tabs.mjs`、`workspace-chat-style.mjs`、`notes-mobile-reading.mjs`、`calendar-edit.mjs`、`mobile-native.mjs` 通过，均使用同一份源码编译的全局 CSS。不原生支持样式替换的既有脚本通过临时 Playwright runner 替换样式，不修改应用 API；不是把旧 CSS 与新 CSS 叠加。
- `mobile-native.mjs` 的旧首页助手定位已失效，现改在仍具有共享抽屉的 Learning 页测试；检查内容与触控/鼠标覆盖保留。
- TypeScript、改动 TSX / E2E 文件的 ESLint、`git diff --check` 通过。
- 运行中的开发服务仍返回不含 `--type-page-size` 的旧全局 CSS；本轮没有停止服务或中断会话。实际服务需要刷新编译缓存后，才能按默认命令（不注入样式）重新验证。
- 截图及指标：`/tmp/pi-typography-final/`、`/tmp/pi-typography-final-mouse/`；临时产物不保证长期保留。

还应按改动执行手机页签、Notes、聊天和日程弹窗回归。320px 长中文/英文、换行、横屏、读屏标签和焦点不能因为统一字号而退化。不要用隐藏溢出掩盖文字被裁切。

Chromium 模拟不能代替 iPhone/Safari 的真实字体回退、键盘缩放、系统文字设置和触摸体验；104 个快照也不代表每个弹窗、错误状态、主题和外部页面都通过。
