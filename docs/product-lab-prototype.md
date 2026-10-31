# 产品实验室：可点击样板与现有实现核对

## 本次范围

用户确认没有现成 Figma；先做可点击样板，Outreach 暂不改动。

入口：`/prototypes/product-lab/index.html`。文件在
`public/prototypes/product-lab/{index.html,lab.css,lab.js}`。
这是可丢弃的独立静态样板，不是正式产品迁移或新功能上线。
用户随后选择 A 并明确要求开始实施；正式 `/product` 现已采用 A，细节见
[product-workspace.md](product-workspace.md)。样板本身仍独立、使用虚构数据。
不导入应用组件，不注册任务，不读取真实产品、联系人或凭据。
既有工作树中的产品／Outreach 改动保持原样。

## 两个方向

- **A · 三栏工作台**：左侧项目索引，中间当前问题／实验／证据，右侧讨论伙伴。
- **B · 聚焦手记**：横向项目索引、居中的连续文档，伙伴在文档之后，不同时争抢阅读宽度。
- 手机使用项目目录与工作区／伙伴切换，不硬挤三栏。
- 默认打开一个明确标为虚构的演示产品；可回到实验室总览、进入想法收件箱。
- 保留 Pi 的语义配色、衬线标题／UI 控件分工与圆角层级，不修改全局主题。
  独立 CSS 镜像基础浅／深色 token，不代表已接入所有生产主题。

可体验：记录想法 → 从收件箱开始探索 → 讨论 → 预览并采纳假设／实验草稿
→ 记录支持或反对观察 → 人工记录结论。产品笔记、讨论草稿和对话按项目隔离；
切项目、视图和布局保留当前页面内的编辑。前进后退恢复 URL 中的项目／视图／布局。
对话是明确标识的预设脚本，不声称理解任意输入或联网研究。
任意输入只获得通用演示问题，不伪造调研结果。

所有编辑仅保存在页面内存，刷新重置；UI 顶部及编辑处明确提示。
无 localStorage／服务端写入；不采用真实联系人作为样例。
CSP `connect-src 'none'` / `form-action 'none'` 禁止接口连接及原生表单外发。
动态文字转义后显示。原有工具链接先解释边界，再由用户在新标签页打开，
不预加载、不 iframe 嵌入、不调用发送或批准接口。

## 现有实现核对（代码检查，不是生产安全认证）

完整目标在 [`specs/market-validation/PRODUCT.md`](../specs/market-validation/PRODUCT.md)。
该文件明确为规格草案，不能把 62 项行为全部算作已实现。
本次没有编辑这个规格，也没有变更旧 Outreach 的发送规则。

| 能力 | 检查到的实现 | 边界 |
|---|---|---|
| 新市场验证 | `components/robin/ValidationWorkspace.tsx`、`extension/robin/validation-domain.ts`、`app/api/robin/validation/**` | 描述、候选人群、AI 草案讨论、人工标准批准、观察／反例、结论、版本、导出；没有新多产品 CRM／发送路径 |
| 原有入口 | `app/product/jarvis/page.tsx` → `/outreach` → `/outreach/research` | 历史书签仍可进入原工作区 |
| 联系人和队列 | `components/robin/JarvisDiscovery.tsx`、`OutreachQueue.tsx` | 8 个视图：crm、contacts、review、send、sent、connections、templates、automation；产品选择目前固定 Jarvis，不能视为多产品集成 |
| 审核／发送分离 | `app/api/robin/jarvis/outreach/route.ts`、`prepareJarvisOutreachBatch` | `approve-for-send` 传 `queueEmail=false`，不设置自动邮件排队时间；历史 `prepare-batch` 另有排队语义，不能混用 |
| 邮件发送 | 同一路由的 `send`，`claimJarvisSend` / `finishJarvisSend` | 需要 confirmed、当前 revision、已审核收件人与草稿，使用发送租约；先存 pending，失败置 uncertain，不自动再次发送 |
| 发件账号 | `extension/robin/jarvis-mail.ts` | 使用独立 `outreach` Gmail grant；获取令牌前后核对发件身份，不回退到学校账号 |
| 社交渠道 | `updateJarvisSocialOutreach`、`updateLinkedInConnection` | 社媒有草稿、人工发送／回复记录；LinkedIn 邀请与消息分开，待接受邀请阻止该渠道的消息记录 |
| CRM 概览 | `components/robin/OutreachCrm.tsx` | 发送记录按时间／渠道统计，人工社媒记录不代表已验证送达；当前分类不是历史分类快照 |

详情参见 [`docs/cold-reach.md`](cold-reach.md) 与
[`docs/agents/market-validation.md`](agents/market-validation.md)。

### 一个明确的规格差异，留待真实整合前处理

`PRODUCT.md` 的 P44 希望疑似自动回复等情况暂停外联；目前
`extension/robin/jarvis-mail.ts` 的 `readJarvisThread` 明确过滤自动回复／休假回复，
注释说明它们不阻止后续跟进。这是旧行为与新目标的差异，不能直接宣称旧系统
符合新规格。本次按用户要求**没有修改它**。

本次没有检查真实 OAuth 连接状态、当前后台发送情况、真实联系人历史或线上送达。
没有连接旧数据到新实验，也没有停止、启动或迁移任何 runner。

## 检查

```sh
node --check public/prototypes/product-lab/lab.js
node --env-file-if-exists=.env.local e2e/product-lab-prototype.mjs
node --experimental-strip-types --test \
  extension/robin/jarvis-domain.test.mjs \
  extension/robin/validation-domain.test.mjs
```

现有两个 domain 测试文件通过 **91 项测试**，使用临时目录／模拟响应，不发真实邮件。
样板浏览器检查覆盖两种布局、明暗主题、320–1440px 与短屏横向、显式采纳／取消、
项目隔离、原始笔记保留、实验草稿、人工结论、反例、HTML 文本转义、弹窗 Escape 与焦点返回、
Outreach 出口地址以及刷新重置。测试禁止所有页面 API 请求，并验证无外部资源请求。
截图在 `/tmp/product-lab-prototype/`。这不是移动真机测试，也不是完整新 Outreach 的验收。
