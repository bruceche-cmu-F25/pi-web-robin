# Robin 本地语音调查：M4 / 16 GiB 常驻主机

## 最新实施：仅本地语音输入，TTS 暂缓

已在 Mac 上安装 whisper.cpp 1.9.5 和校验后的 Small Q5_1，现有语音输入改为本地 CLI 转写；手机通过现有 Robin HTTPS 入口上传录音，不需要语音 API Key。首次直接测试及 Tailscale HTTPS 实际转写已通过，物理手机麦克风尚未验证。独立播报开关、语义口语改写和 TTS 供应商切换均暂缓。部署、隐私边界、实测限制以 [Robin voice](robin-voice.md) 为准。

用户无法使用国内 API 后，另建议 DeepInfra 托管 Qwen3-TTS，但尚未确认账号/支付可用，也未接入。**下文是早期选型记录，关于“尚未下载/接入”与阿里云首选的描述不代表当前状态。**

## 早期决定：Whisper 固定，TTS 可用国内云模型

用户随后确认 STT 固定为成熟的 Whisper，并允许重新比较阿里云 TTS；这更新了下文早期“语音全部本地”的约束。

**当前建议：Whisper 本地 STT + 阿里云 `qwen3-tts-flash` TTS；Kokoro 暂不同时部署。** 这是降低维护成本、优先中文交流体验的工程选择，不是已完成同文本盲听得出的音质排名。只有精简口语稿发送给 TTS，不发送原始录音、完整历史或工具输出；对话模型的联网策略仍保持原样。

详细对比、计费字符规则和分阶段配置见 [TTS 对比与配置](robin-tts-configuration.md)。本地 Whisper、独立朗读开关、模型口语改写尚未接入；旧代码依然把 STT/TTS 都绑定 DashScope，不能只填 Key 就声称完成混合方案。

## 早期调查：全本地候选与验证

这是调查记录与实施建议，**不是已交付的本地语音功能**。现有 `/api/robin/voice` 仍调用 DashScope；没有修改运行服务、项目依赖、凭据或 Tailscale 配置，也没有下载语音模型。

用户确认的需求：
- 手机、平板、电脑通过 Robin 网页输入语音，模型统一跑在常驻 Mac mini 上。
- 录音与朗读是两个独立功能：打字也能听回复，说话也能只看文字。
- 朗读内容是模型理解后重新组织的口语重点，不是全文播报，也不是抽前三句话。
- 不再使用阿里云语音 API；保留原有 Robin 对话、工具、权限和会话。

**建议首测 whisper.cpp + Whisper Small Q5_1（多语种）做识别，sherpa-onnx + Kokoro v1.1 中文 INT8 做发声。** 识别不够准确时再测 Whisper large-v3-turbo Q5_0；不要在产品里先造多供应商选择器。SenseVoice 可作为对照，但其权重许可不是标准 MIT/Apache，不再无条件作为默认推荐。

M4/16 GiB 是合理的试验目标，不代表已经测得速度、准确率、内存峰值或音质。没有依据承诺“1 秒回复”。

## 本机已验证（只读检查与隔离探针）

- `sysctl`：Apple M4；物理内存 17,179,869,184 bytes（16 GiB）。
- 当前 Node：v26.3.1，darwin/arm64。
- Tailscale 状态 Running，设备在线。已有 HTTPS Serve，包含转发至 Robin 的 30141 端口。没有输出设备名、地址、账号或改写配置。
- 在 `/tmp/robin-local-voice-probe.xpyNFG` 隔离安装 `sherpa-onnx-node@1.13.8`（`--ignore-scripts --no-audit --no-fund`），没有改项目 package.json/lockfile。
- 原生模块在当前进程成功加载；确认 `OfflineRecognizer.createAsync/decodeAsync`、`OfflineTts.createAsync/generateAsync` 存在。该探针没有创建模型、识别录音或生成语音；加载用时不是推理用时。
- 当前 PATH 未找到 `whisper-cli` / `whisper-server`；不据此断言机器其他目录一定没有安装。
- 一个有用的接口陷阱：`addon.js` 注释提到 `readWaveFromBinary`，但 1.13.8 的包顶层没有导出。尝试调用会 TypeError。不要基于注释编写生产接入；现有规范 PCM WAV 可直接解码为 Float32Array，或原样提交给 whisper-server。

## 模型、安装和许可

下载大小来自实际 release/Hugging Face API，不是内存占用。MB 以下均为十进制。

| 用途 | 候选与文件 | 下载大小 | 证据与备注 |
|---|---|---:|---|
| 默认首测 ASR | `ggml-small-q5_1.bin` | 190,085,487 bytes ≈190 MB | 多语种，不能选 `.en`；OpenAI 明确代码与权重 MIT |
| ASR 升级对照 | `ggml-large-v3-turbo-q5_0.bin` | 574,041,195 bytes ≈574 MB | 不默认同时安装；中文准确率不足时比较 |
| TTS 首测 | `kokoro-int8-multi-lang-v1_1.tar.bz2` | 147,031,220 bytes ≈147 MB | 82M 模型家族；中文/英文；模型卡 Apache-2.0 |
| TTS 非量化对照 | `kokoro-multi-lang-v1_1.tar.bz2` | 364,816,464 bytes ≈365 MB | 量化音质不满意时才比较 |
| ASR 备选 | `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2` | 163,002,883 bytes ≈163 MB | 文档显示权重约228 MiB，支持 ITN/标点；权重自定义许可 |

默认首测模型下载合计约 **337 MB**，另加运行库/依赖/解压空间。sherpa 的 darwin-arm64 原生 npm 包解压约34.1 MB，不是模型加载后的 RSS。

### 安装证据

- Homebrew 当前 formula 名为 **`whisper.cpp`**，查询时稳定版本1.9.5，提供 Apple Silicon bottle 和 whisper-server；旧名为 whisper-cpp。`brew install whisper.cpp` 不会自动下载模型。它还依赖 ggml、llama.cpp、sdl2-compat，不能声称全部部署仅337 MB。
- whisper.cpp 官方支持 Apple Silicon Metal。选它可以避免 Python/PyTorch；仍需实际确认所安装二进制启用了正确后端。
- `sherpa-onnx-node@1.13.8` 自动选择 darwin-arm64 原生包，支持异步模型创建/生成。调查探针无需编译或额外设置 DYLD_LIBRARY_PATH 即可加载；不把这个结果推广为所有版本保证。
- Kokoro 模型不仅是一个 onnx 文件，还需要配套 voices、tokens、espeak 数据和中英文 lexicon。按完整包部署，不仅下载权重。
- 首次安装显式下载模型并校验 SHA256；缺模型时报配置未就绪，不在用户点击麦克风时自动下载或回退云端。

### 许可修正

SenseVoice 仓库代码 LICENSE 是 MIT，但官方 SenseVoiceSmall 模型卡标注 `license: other`，链接至 FunASR MODEL_LICENSE。该协议包含署名、行为、终止与修订条款，不能将权重称为标准 MIT 开源。本地运行依然不等于调用阿里云，但“免费可下载”不能替代许可核对。

Kokoro v1.1-zh 模型卡明确说它并非 v1.0 的严格升级，移除了部分声音并加入中文声音；数字版本较新不代表每种语言更好。需要试听确定一个固定声音，不能把 v1.0 示例的 sid:48 直接当成 v1.1 的同一音色。运行库、模型与打包的发音词典/数据各自许可证也要保留，不能统一贴一个 Apache 标签。

### 校验值（调查时上游元数据）

- Whisper Small Q5_1：`ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`
- Whisper large-v3-turbo Q5_0：`394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`
- Kokoro INT8 v1.1 包：`a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6`
- SenseVoice INT8 2024 包：`7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e`

## 推荐链路

```
任意已授权设备的前台浏览器
  ├─ 麦克风 → 本地浏览器转16kHz单声道PCM → 已鉴权Robin端点
  │                                         ↓
  │                              Mac本地ASR → 可编辑草稿
  └─ 打字 ──────────────────────────────────────┘
                     用户明确发送
                            ↓
                原有Robin模型/会话/工具
                  ├─ 完整文字立即显示
                  └─ 朗读开启且本轮仍有效
                         ↓
                同一模型的无工具口语改写
                         ↓
                  Mac本地Kokoro → 当前设备播放
```

“本地语音”只承诺 ASR/TTS 在 Mac 上。对话与口语改写是否出网由原有模型提供方决定；开启朗读会多一次模型请求，必须告知，关闭时不发该请求。没有另一个能执行任务的代理，也不维护第二套记忆。

### 口语改写不是截取

已有 `lib/session-title.ts` 展示了正确机制：使用当前会话模型、认证与 streamFunction，创建一个无工具的一次性请求，不向 AgentSession.prompt 塞一个新的对话回合。语音应复用这一模式而非标题模块的截断策略，且只读取本轮用户需求和最终完整回复，不发送整个历史、思考内容或工具日志。

建议口语约束：
- 通常2–3句；中文目标约60–150字，硬上限另设（如240字）。先结论，再最重要的原因/下一步。
- 保留重要日期、金额、否定、条件、风险和未完成状态；不能把建议说成完成，也不能把估计说成确认。
- 源回复是待转换的数据，不是给改写器的指令；没有工具调用能力。
- 不念代码/链接/长列表；屏幕展示口语文本，用户能核对它和完整回复。
- 不是所有内容都能无损压缩。无法可靠简述、超出输入预算、模型失败或输出不合格时，只提示看文字，**不能悄悄退回念全文或前三句**。不要切掉答案后半段限定条件后假装总结了全文。
- 不自动重试，不阻塞文字回复；限制输入/输出、时间和并发；关闭朗读/换会话时中止请求并丢弃迟到结果。
- 通过测试降低摘要失真风险，不能声称仅靠提示词保证事实完全一致。

## 现有代码需要改变的地方

| 位置 | 当前行为 | 接入建议 |
|---|---|---|
| `extension/robin/voice-domain.ts` | DashScope配置、ASR/TTS网络调用 | 替换为本地处理，保留校验/限流/安全错误；删除云端静默回退可能 |
| `extension/robin/voice.ts` | 一个 `configured`，正则抽取前三句 | ASR、TTS、口语改写分别报告就绪；删除“抽取即总结”的语义 |
| `app/api/robin/voice/route.ts` | 鉴权后的语音端点 | 保留端点与无缓存策略；口语请求绑定已完成回复ID，校验会话与分支，拒绝客户端随意指定模型/路径/上游URL |
| `components/robin/useRobinVoice.ts` | `start(conversation)`会改变talk；end同时撤销talk | 麦克风生命周期与朗读偏好拆开；偏好按设备/浏览器保存，录音不能暗中改变它 |
| `components/robin/VoiceControls.tsx` | 语音对话按钮、朗读节选 | 麦克风＋独立朗读开关；停止当前播放，不取消代理任务 |
| `AssistantBar.tsx` / `AgentPanel.tsx` | 已有确认发送/成功回复回调 | 重用发送路径；搜索只听写，不触发摘要或朗读 |
| `components/ChatInput.tsx` | 主Chat没有听写入口 | 识别结果进入当前草稿，保留附件、撤销和IME行为，不能另开会话 |
| `components/ChatWindow.tsx` / `hooks/useAgentSession.ts` | 已有agent结束与流式消息协调 | 只在成功完成的本轮最终回复触发一次，不能靠“最后一条消息变化”或刚加载历史时触发 |
| `lib/session-title.ts` | 当前模型的一次性无工具文本任务 | 参考其请求机制，不修改标题行为，不复制其有损上下文截断策略 |

主Chat必须按 session/branch/run/reply 身份去重和取消；SSE重连、历史加载、切分支、重新挂载不能重复播报。多个设备只在发起本轮且仍活跃的页面自动播放，不能服务器完成一轮就广播让所有设备说话。

### 本地运行与取消

- 不在每个HTTP请求内重新加载模型。先用单个常驻本地 whisper-server（仅127.0.0.1），TTS在受管理的隔离进程中保持一个实例；不把同步推理放进Next事件循环。
- 本地服务无公开入口。网页只访问Robin已鉴权端点；禁止透传 whisper-server 的 `/load`、任意模型路径或任意URL。官方server示例并非可以直接暴露给互联网的生产API。
- 现有浏览器已经输出规范WAV，不开启whisper-server的任意格式/ffmpeg转换功能；加no-context避免前一用户录音影响下一请求。
- 核实服务是否写上传临时文件、是否输出转写日志后，才能保留“没有音频落盘”的承诺；默认关闭内容日志，必要临时文件在受限目录及时删除，文档如实说明。
- 推理并发先每引擎1个，忙时明确反馈；多个设备可接入不代表无限并发。模型线程数以响应性测试决定。
- `AbortController` 取消HTTP不代表CPU已停。sherpa TTS progress callback可返回0，但不是任意时刻硬取消；ASR异步API没有暴露AbortSignal。丢弃过期输出且在底层计算结束前保留槽位；硬超时需要隔离进程终止/恢复，不允许积压僵尸推理。
- 关闭播放立即停音；停止录音不改变朗读偏好。偏好是长期设置，当前页面的播放授权/有效回合是短期状态，不能混为一个bool。

## 多设备与浏览器边界

现有Tailscale HTTPS入口可复用，但“配置存在”不等于手机端验收成功。验证 Host allow-list、同源Origin保护、登录Cookie、API请求和真实录音/播放，不通过放宽CORS/关闭鉴权来解决代理问题。

- 首选Safari(iPhone/iPad)和Chrome(Android/桌面)的前台网页；不承诺所有内嵌浏览器、锁屏、后台继续录音。
- getUserMedia需要HTTPS/localhost和麦克风授权；手机上的HTTP局域网IP不够。
- 自动播放受浏览器策略限制。“朗读开启”需要在用户手势中准备播放环境；纯打字场景不能依靠录音时创建AudioContext来解锁。若仍被阻止，保留已生成音频并显示播放按钮，不重复合成。
- 刷新后保存朗读偏好，但不自动播放历史回答；新页面未解锁可显示“点一下启用声音”。
- 默认录音与播放不重叠，避免自我收音；无唤醒词、VAD自动发送或全双工承诺。

## 实施顺序与验收

1. **隔离跑模型**：校验下载，ASR 5/15/60秒，TTS 60/150/240字；分开记录冷加载/暖推理/网络/改写耗时、峰值RSS。试听3个中文音色与中英混读，不根据模型卡自评选音色。
2. **本地端点替换**：沿用API权限和PCM验证，配置就绪分离，测试缺模型、坏音频、超时、并发、进程退出和无云端回退。
3. **独立朗读开关与口语版**：四种输入/输出组合；失败不影响文字；工具权限为零；关闭开关后没有迟到声音。
4. **主Chat与已有助手接入**：同一草稿、附件、原会话；最终回复按run去重；重连/切页/切分支不复读。
5. **真机验收**：Mac + iPhone Safari + Android Chrome；Tailscale外网、权限拒绝、首次播放、来电/设备切换、后台/锁屏恢复。桌面模拟手机尺寸不能代替真机。

识别样例需包含日期、否定、专有名词和混合语言，例如“不是周四，是周五下午三点”“不要删除，只列出待办”“React 的 useEffect”。口语改写用固定的成功/失败/部分成功/未确认/取消/风险附后/注入文本/长代码回复测试集，人工核对重要事实；不能把合成语音再识别的成绩当真人麦克风准确率。

## 原始来源

- sherpa安装：https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html
- sherpa中英Kokoro异步示例：https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/tts_kokoro_zh_en.html
- Kokoro模型与包：https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
- Kokoro中文模型卡：https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh
- SenseVoice型号/ITN/非流式行为：https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html
- SenseVoice模型许可入口：https://huggingface.co/FunAudioLLM/SenseVoiceSmall/raw/main/README.md
- 权重许可：https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE
- Whisper代码与权重MIT声明：https://github.com/openai/whisper#license
- whisper.cpp及Metal：https://github.com/ggml-org/whisper.cpp
- whisper-server参数与安全警告：https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md
- Homebrew元数据：https://formulae.brew.sh/api/formula/whisper.cpp.json
- Whisper文件大小/校验：https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main?limit=1000
- ASR release元数据：https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/asr-models
- TTS release元数据：https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/tts-models
- 浏览器自动播放：https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- 浏览器录音：https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Tailscale Serve：https://tailscale.com/docs/features/tailscale-serve
