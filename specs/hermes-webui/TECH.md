# 独立 Hermes WebUI：克莱因蓝与白色，手机优先

状态：克莱因蓝／白色界面、独立密码登录与 Tailscale HTTPS 已实施，Google 等后续集成仍按草案推进。用户已授权开始实现；产品行为见 [PRODUCT.md](PRODUCT.md)。
本版取代此前“只使用原样 WebUI、不做 UI 定制”的计划；Pi/Robin 与 Hermes 独立运行、只通过 URL 跳转的约束不变。

## 已交付的第一切片

- 独立源码目录：`/Users/bruce/hermes-personal-ui/`；预览 `http://127.0.0.1:8788`，只绑定 loopback。
- `extension/personal.css`：Night Meadow 主题与手机/桌面布局；`personal.js`：主题注册、导航标签、原生 dialog 设置总览、Pi 跳转、只读模型就绪提示；`links.js`：URL 校验。
- 最新确认恢复克莱因蓝 `#002FA7`／白色：蓝色侧栏与设置页头、深蓝图标栏、白色聊天阅读区；撤掉绿色、暖金及奶油底色，仅回退配色，保留改进后的字号和无顶栏布局。`atmosphere.webp` 及生成脚本已删除，无装饰图片、渐变、光晕或绘图依赖。内部 `personal-blue` 标识不变。
- 顶栏容器隐藏；原手机菜单／新对话按钮移到浮动容器，原节点、id 和事件不变。设置仍从导航进入，聊天正文/代码/输入区与设置页面使用不透明白底。正文默认 17px，字号选项递增；工具摘要移除低透明度。
- `run.py` 复用原先安装的 Python venv 与未修改的社区后端；清理继承凭据，保留独立 HOME/WebUI state/workspace。用户已确认将 `HERMES_HOME` 指向 `/Users/bruce/hermes-preview-Rk5SgB/agent-home`，直接共用 CLI 配置/认证，不复制凭据。该配置缺失时拒绝启动，不回退到空 home。
- 设置概览通过上游 `switchPanel` / `switchSettingsSection` 进入真实配置，保留未保存更改保护。手机使用全屏原生 dialog，未另建前端路由系统。
- Google 区域只显示明确的“未接入”和说明，无伪造的认证状态或连接操作。
- 已验证 Node URL 测试及七种浏览器尺寸（1440×960、1024×768、768×1024、700×900、390×844、375×667、844×390）：无横向溢出、无顶栏占位、设置边界/跳转/焦点恢复、手机按钮、Memory/Skills/Kanban 入口、中英文保存/重载及 URL 验证。验证背景无图片/渐变且不再请求旧背景；正文实底用临时 DOM 样例验证，不创建对话。浏览器无 pageerror。
- 未验证真实模型回复、工具运行/审批/停止、真实手机软键盘、后台重连或 Google OAuth；不宣称这些随着 UI 完成。
- 原 8787 预览和两个上游源码未修改。Pi 只增加导航链接，未修改引擎、业务状态或认证。

## 已实施：与 CLI 共用 Agent home

用户明确确认后，仅重启定制 WebUI，Pi 监听进程未变化；启动前确认无运行中会话。WebUI 继续使用自身密码和 `state/webui`，模型、工具配置、记忆、Skills、任务及 Agent 侧状态共用 CLI home；修改这些共享内容会同时影响 CLI。默认 `~/.hermes` 和旧 `state/agent-home` 未移动或覆盖。

只读 HTTPS 验证：配置路径正确，读取到 `openai-codex / gpt-5.6-sol`，provider/chat readiness 为 true，输入框模型一致，独立登录/注销通过；配置、认证和任务文件切换前后完整性一致。无模型推理请求。接通配置时检查到 0 个任务，未启动 Gateway；后续按用户单独授权启用，见下一节。

`tests/launcher_test.py` 在临时目录验证共享 home、独立 WebUI、环境清理及缺失配置/密码时 fail closed；`tests/shared-home-check.cjs` 验证当前部署，只读业务数据。会写入语言偏好的旧 `access-check.cjs` 已加入隔离 home 检查，拒绝对当前共享目录直接运行。实际工具依赖、模型推理与真实定时任务执行仍分别待验证；调度循环的运行验证见下节。

## 已实施：Gateway 后台调度与登录自启动

用户明确批准后，先检查共享 home 及命名 profiles 无任务、没有已有网关或消息平台配置，再用原生 `hermes gateway install` 安装当前 home 专属的 `~/Library/LaunchAgents/ai.hermes.gateway-fbc7a47d.plist`。没有改配置模型/认证、没有操作 Pi 或 WebUI 进程，没有创建任务。

- 原生 LaunchAgent 使用现有 venv 与同一 `HERMES_HOME`，当前用户登录后 `RunAtLoad` 启动，异常退出由 `KeepAlive.SuccessfulExit=false` 拉起；正常停止不会立即重启。不是登录前的系统服务，也未实际重启 Mac 做验收。
- 保留原生监督与停止语义，不自行实现 scheduler。没有启用 API_SERVER_KEY/HTTP listener 或消息平台；网关进程树验证无 TCP 监听，WebUI 直接识别共享本机状态，无需新增远程端口。
- 已验证 launchd 运行状态、Gateway running、成功心跳跨周期推进、WebUI configured/running 均为 true，以及任务页提示消失。任务数仍为 0，无模型推理或实际任务执行。`tests/shared-home-check.cjs --require-gateway` 可只读复验网页状态。
- Mac 必须保持唤醒；WebUI 本身仍按原方式启动，未随本次设置登录自启。具体任务、时区、工具权限与投递渠道需另行配置。停止/撤销命令见独立项目 README。

## 已实施：受保护的手机入口

用户明确批准后，在原 Tailscale Serve 配置旁新增 HTTPS **8443 → 127.0.0.1:8788**，保持原 **443 → 127.0.0.1:30141**。仅 tailnet 可达，没有 Funnel 或 LAN 裸端口。

- 使用 Hermes 原生 `/api/settings` 建立独立密码，不复制任何 Pi/模型/Google 凭据。初始密码保存在本机私有文件，未打印；实际认证由原生设置中的哈希负责，支持在 UI 改密。
- launcher 强制 Secure cookie，使用独立 `hermes_personal_session` 名称；重启时若密码配置缺失则拒绝启动。相同域名下不同端口不是 cookie 隔离边界，不宣称它是安全沙箱。
- `components/robin/RobinMargin.tsx` 增加原生 `<a>`，由 `lib/hermes-navigation.ts` 为 loopback 或当前 `.ts.net` 主机生成全新地址，不附带 session/cwd/查询串。Hermes 返回同主机 443 的 Pi；显式保存的 Pi 地址优先。
- 实际 HTTPS + 手机尺寸 Chrome 验证：未登录 API 401、登录表单、认证后读取、定制 UI、返回 Pi 链接、原生 CSRF 注销、注销后 API 401；TLS 校验开启。Pi 导航逻辑测试、既有导航测试、类型检查和相关 lint 通过。
- Pi 保持原进程；WebUI 只重启本实例以应用 cookie 设置，WebUI 自身没有登录自启。Gateway 后续按单独授权安装了上述 LaunchAgent。
- 撤销新增转发只用 `tailscale serve --https=8443 off`，不能 reset 全部 Serve 配置。部署 URL、密码取用和运行说明见独立项目 README。
- 实际手机连接 tailnet、软键盘和后台恢复仍需真人确认。

## Context

### 用户已确定的方向

- Hermes 是独立应用，不嵌入 Robin，不改 Pi 引擎，不共享 Pi 会话或认证。
- 以手机浏览器为主要使用场景之一，而不是把桌面三栏缩小。
- 最新确认覆盖参考图及蓝绿配色尝试：恢复克莱因蓝与白色，不使用绿色、暖金、风景或光效背景。保留清晰字号、无顶栏布局和手机菜单，依靠留白和字体建立层次。
- 保留社区 WebUI 大部分功能；重组设置页，提供普通“打开 Pi”链接。
- 为 Hermes 单独配置 Gmail 与 Google Calendar 读写，不复制 Robin token。
- 官方 Desktop 是交互参考，不是把 Electron 打包给浏览器。

### 已验证与未验证

- 本机已有 `/Users/bruce/hermes-agent` 与 `/Users/bruce/hermes-webui` 两个仓库。
- 社区 WebUI 曾在独立试用目录 `/Users/bruce/hermes-preview-Rk5SgB/` 启动于 `127.0.0.1:8787`；健康检查、初始化接口和浏览器向导通过。该记录不证明服务始终在线。
- 用户已报告 CLI 启动成功；不据此假定完整聊天、审批、续聊或 Google 接入通过。
- 定制 UI 已按上述范围验证；尚未验证手机真实访问、Desktop 运行、Google OAuth 或写操作。
- 手机访问已选定 Tailscale HTTPS + 独立密码；WebUI 状态独立，Agent home 已按用户确认共用此前 CLI 目录。没有迁移/复制凭据或修改默认 `~/.hermes`。
- 交互参考官方 Desktop 与社区 WebUI；参考图配色尝试已撤回，按用户确认恢复克莱因蓝／白色。

### 研究基线

Hermes Agent：`c7e165a06870bfc677f7d9752f2f969896acd837`。
社区 WebUI：`f2d1de93f5b6adf9e66be2234b2c6b7f71e11d26`。

- [Desktop README](https://github.com/NousResearch/hermes-agent/blob/c7e165a06870bfc677f7d9752f2f969896acd837/apps/desktop/README.md) — Electron 管理原生能力，React 管理界面，经 `apps/shared` 连接 `hermes serve` 的 JSON-RPC/WebSocket。
- [Desktop DESIGN.md](https://github.com/NousResearch/hermes-agent/blob/c7e165a06870bfc677f7d9752f2f969896acd837/apps/desktop/DESIGN.md) — 聊天优先、信息层级、预览和设置交互的参考。
- [社区主题](https://github.com/nesquena/hermes-webui/blob/f2d1de93f5b6adf9e66be2234b2c6b7f71e11d26/THEMES.md) — Light/Dark 与 skin 独立；已有蓝色 Poseidon，可用 token 扩展，不必更换框架。
- [社区扩展](https://github.com/nesquena/hermes-webui/blob/f2d1de93f5b6adf9e66be2234b2c6b7f71e11d26/docs/EXTENSIONS.md) — 同源 CSS/JS、`registerHermesSkin`；扩展拥有登录用户能力，不是安全沙箱。
- [社区页面](https://github.com/nesquena/hermes-webui/blob/f2d1de93f5b6adf9e66be2234b2c6b7f71e11d26/static/index.html) — 已有导航、设置分区、移动端抽屉与输入区配置面板。
- [Google OAuth 脚本](https://github.com/NousResearch/hermes-agent/blob/c7e165a06870bfc677f7d9752f2f969896acd837/skills/productivity/google-workspace/scripts/setup.py) — 当前实现固定申请全 Workspace scopes；与 SKILL.md 的 `--services` 指引不一致，不能直接按文档执行。

## Proposed changes

### 1. 只选一套运行基础

以社区 WebUI 当前 Python + 原生 JS 实现为默认基础：继续由其拥有会话、SSE、审批、停止、恢复和配置持久化。官方 Desktop 只作为体验参考，不同时接入其 WebSocket 运行时，不拼接两个会话系统。

不为了外观引入 React/Next.js，不迁移 Pi 的 `ChatWindow`、`useAgentSession` 或 `rpc-manager`。如之后出现必须换框架的具体需求，另立决策。

先在独立定制目录维护主题和导航扩展，不修改正在使用的试用版。需要改设置结构时，才在社区仓库的独立分支/worktree 做小范围补丁。避免用不断扫描 DOM 的脚本覆盖上游的状态管理。

复制或派生上游代码时保留 MIT 许可证及版权声明；“我们的版本”表示定制发行，而非将上游代码宣称为原创。

### 2. 聊天与设置外观（按最新参考图更新）

- 主题：克莱因蓝导航与设置页头、深蓝图标栏、白色阅读面板与深蓝正文。不用 Pi 的视觉样式，不使用装饰背景图片。
- 桌面：会话导航 + 主聊天；工作区按需打开，不默认挤占聊天。
- 手机：单列聊天，会话用抽屉，次级功能从菜单进入；设置使用可返回的全屏页面而非窄弹窗叠加。
- 保留当前模型、连接/执行状态、审批、停止与错误反馈，不能为了简洁隐藏风险信息。
- 输入区适配软键盘与安全区；中文输入法组合期间不能误发送；控件至少 44px 可点区域。
- “打开 Pi”使用独立、可配置的 http/https URL，默认普通同标签跳转；不携带 token、cwd、session 或用户信息。已确认的 Tailscale 部署默认返回同主机 HTTPS 443，loopback 返回本机 30141；其他未配置的主机仍显示未配置状态。
- 保留其余页面能力；只调整入口和视觉，不假称第一版已全面重做所有管理功能。

### 3. 设置重组

目标分组为模型、账号连接、工具与安全、外观、高级。复用现有 provider 登录、模型选择和保存流程，不重写 OAuth 基础。

新增 Google 连接区域需展示真实账号、授权范围、连接/过期/失败状态以及重新授权/断开入口。界面实现与服务端能力分开验证；未接好时明确标为未连接，不提供虚假可用开关。

### 4. Google 读写

- 单独的 Hermes OAuth token，仅申请 Gmail 和 Calendar 所需权限；不自动复制 Pi/Robin credentials。
- 本地 Google skill 的 setup 与执行 wrapper 都有 scopes 校验，需要一起核对；不能只缩小授权页就宣称接入完成。
- 不请求无关的 Drive、Contacts、Sheets、Docs 权限。
- 区分读取、发送/回复、标签修改以及日历创建/修改/删除。当前 wrapper 是否支持日历修改需实查，不由 Calendar scope 推断具体命令已实现。
- 写操作先展示目标和变更；发送、回复、删除、邀请他人须由用户确认。提示词中的“先确认”不等于后端强制审批，若要求不可绕过，必须实现实际写入通道的约束并说明终端权限限制。
- 使用同一个 Google 账号意味着外部数据共享：Hermes 修改的事件可被 Robin 读到；不宣称应用独立意味着外部数据隔离。
- 不自动部署邮件巡检、提醒或定时写操作，以免与 Robin 重复运行。

### 5. 手机可达性单独验证

开发阶段继续只绑定 loopback。正式手机访问建议优先评估私人 VPN（例如 Tailscale）加 HTTPS，保留 WebUI 自身认证。启用任何对外监听、隧道、账号授权或守护进程前确认部署方案。

不直接把无密码的 8787 暴露到公网；手机 localhost 指向手机而非 Mac。PWA/添加到主屏幕只是入口便利，不意味着离线运行 Agent、后台推送或手机替代服务器。后台标签页的连接恢复必须验证；任务是否持续取决于后端存活，Mac 休眠仍是限制。

## Testing and validation

1. 先完成一条真链路：发送 → 流式文本 → 工具状态 → 批准/拒绝 → 停止 → 刷新恢复；不以静态截图代替可用性。
2. 桌面与 390px 手机视口验证：导航、设置返回、中文输入、长代码块、图片附件、焦点和表单错误；原有管理入口仍能访问。
3. 真实 iPhone Safari 或 Android Chrome 验证软键盘、旋转、切到后台再返回、断网重连。模拟器结果不能代替真机结论。
4. 重连不重发 prompt、不重复执行工具；Stop 不伪装成已撤销完成的外部操作；多标签状态不串会话。
5. 定制版独立状态和端口验证；原试用版与 Pi/Robin 服务不重启、不改变凭据和数据。
6. 手机通过最终保护地址登录；未认证 API/流连接拒绝访问；凭据不出现在 URL、浏览器存储、前端日志或截图中。
7. Google 首先读少量数据验证 scope，再经明确批准测试写操作；日历测试优先单独测试日历，邮件不向真实他人自动发测试信。
8. Pi 跳转在手机和电脑都可达且不带会话参数；Hermes 不可用时 Pi 不受影响。
9. 上游升级保留基线和小补丁，升级前重跑聊天、审批、恢复、设置和移动端回归；不自动跟随 main 覆盖定制。

## 实施顺序与待定项

1. 已补充 PRODUCT.md 的可观察行为，完成手机聊天与设置第一版。
2. 已在独立环境做白蓝主题、导航和设置总览，保留上游运行逻辑；等待用户体验反馈。
3. 验证完整聊天与移动端交互，再逐步扩展管理页面。
4. 确认正式数据目录后接 Google 最小权限 OAuth。
5. 确认手机连接方式、认证和可达 Pi URL，完成真机验证后再替换日用入口。

开放问题：手机仅同 Wi-Fi 还是外出也访问；是否已有私人 VPN；正式 Hermes home。以上未确认前不迁移数据、不开放网络、不进行真实 Google 写入。
