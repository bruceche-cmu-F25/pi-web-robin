# Robin：Whisper STT + TTS 选型与配置

## 当前状态

**本地语音输入已实施，其他语音功能暂缓。** whisper.cpp 1.9.5 与校验后的 Small Q5_1 已安装；识别使用本地 CLI，不再调用 DashScope。手机通过既有 Robin HTTPS 上传录音。实际安装路径、配置和测试见 [Robin voice](robin-voice.md)，不是下文早期独立 whisper-server 方案。

用户无法使用国内 API 后，曾建议 DeepInfra 托管 Qwen3-TTS；尚未确认/配置。现有可选阿里云 TTS 未改，未调用付费服务。下文保留为早期选型与配置参考，不是当前待执行清单。

## 早期方案（已被上述实施状态更新）

用户决定 STT 固定 Whisper，TTS 可用国内模型，也可考虑阿里云服务。

**推荐配置：本地 whisper.cpp + multilingual Whisper Small Q5_1；TTS 首选阿里云 qwen3-tts-flash（北京），初始音色 Cherry。** 优先让中文短回复省心可用，不同时安装两套 TTS。Kokoro 是全本地替代，不是云端失败后的静默回退。

该选型记录撰写时尚未部署。现在 STT 已改为本地 Whisper，并拆分了 ASR/TTS 就绪状态；无云端 Key 也可语音输入。TTS 仍未实测或试听。

## 三种 TTS，不要混淆

| | Kokoro v1.1 中文（本地） | 阿里云 qwen3-tts-flash（云） | Qwen3-TTS CustomVoice（本地开源权重） |
|---|---|---|---|
| 优势 | 82M，量化包约147MB；无按次费，发声文本留在Mac | 不占本地推理资源；官方提供拟人音色、多语种/方言、随文本调节语气；已有Robin接入基础 | 国内模型；本地发声；0.6B/1.7B规格和预置音色 |
| 代价 | 配套词典/发音前端维护；中英混读、日期、多音字需实测 | 联网、按量收费；待播报文本交给提供方；受网络/额度影响 | 比Kokoro更重；Mac可用社区MLX实现，但部署与维护更多 |
| 音质结论 | v1.1不是v1.0严格升级；有混读问题反馈，不等于每个实现都失败 | 中文日常交流的优先试听候选，不宣称盲测胜过Kokoro | 不能把开源0.6B、1.7B与云Flash视为相同模型/音质 |
| 本轮建议 | 暂不部署；需要本地隐私或离线发声时选 | 默认推荐 | 当前不选，避免为了发声再引入较重模型栈 |

Kokoro社区问题 #238 是故障样例，不是可靠的总体质量排名。阿里云产品页的“高表现力”也是厂商描述，不是本机对照结果。用同一口语稿比较中文、React/useEffect等词、金额、日期、否定和自然停顿，才能决定用户喜欢的声音。

阿里云文档所称“离线/非实时语音合成”不等于模型在自己的Mac上运行。云API和本地开源Qwen3-TTS是不同交付方式。

## 费用（以本次查到的官方价格页为准）

北京 `qwen3-tts-flash`：**0.8元/万计费字符**，音频输出不另计费。

当前价格页统一字符规则：汉字每个计2字符，英文字母、数字、标点、空格每个计1字符。不要把“每万字符”误写成“每万汉字”。

粗略算例（忽略标点/空格等）：
- 一条100汉字口语回复 ≈200计费字符 ≈0.016元。
- 每天20条、每条100汉字、30天 ≈9.6元/月。
- 每天100条、每条100汉字、30天 ≈48元/月。

这是TTS单项估算，不包含原有对话、精简口语改写的模型用量、电费或网络。免费额度有适用条件和有效期，不用它作为长期成本假设；实际以请求usage与账单为准。

## A. Whisper：仅在Mac主机安装一次

以下是**早期独立服务方案，当前不采用**。当前安装目录为 `~/.pi/robin/models/`，调用 `whisper-cli`，无须新开端口；请按 [现行部署说明](robin-voice.md) 操作，勿重复安装此示例。

```bash
brew install whisper.cpp
mkdir -p "$HOME/.pi/robin/models/whisper"
cd "$HOME/.pi/robin/models/whisper"
curl --fail --location --output ggml-small-q5_1.bin.part \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
printf '%s  %s\n' \
  ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb \
  ggml-small-q5_1.bin.part | shasum -a 256 -c - && \
  mv ggml-small-q5_1.bin.part ggml-small-q5_1.bin
```

模型约190MB；Homebrew运行库及依赖另算。必须用多语种版本，不能用 `.en`。中文准确率不足再比较约574MB的large-v3-turbo Q5_0，不先装两套。

校验成功后，若18081端口空闲，独立测试可运行：

```bash
whisper-server \
  --model "$HOME/.pi/robin/models/whisper/ggml-small-q5_1.bin" \
  --host 127.0.0.1 --port 18081 \
  --language auto --no-context --no-timestamps
```

只绑定回环，不将推理端口暴露给手机或Tailscale；手机仍只访问鉴权后的Robin。无上下文避免不同录音间带入历史。初步测试后再管理常驻/重启，不用每次录音启动一个冷模型。

上述服务**不会自动被当前Robin调用**。接入代码要将规范WAV转为该服务要求的multipart请求、固定路径/参数、保留限流与错误边界；不能代理其 `/load` 或任意客户端参数。也不等同于原有长录音转写模块的 `ROBIN_WHISPER_BIN` 配置（那个模块调用的是不同参数格式的Python Whisper CLI）。

## B. 阿里云TTS：只需要服务端Key

先完成代码中的本地STT替换，再进行这一步：

1. 在阿里云百炼开通服务，选择 **华北2（北京）**，按官方说明创建 API Key，确认可访问 `qwen3-tts-flash` 并设置费用提醒。
2. 在Mac的 `/Users/bruce/pi-web-robin/.env.local` 私下填写：

```dotenv
ROBIN_VOICE_API_KEY=你的北京地域百炼Key
```

当前代码也接受 `DASHSCOPE_API_KEY`，二者选一即可，`ROBIN_VOICE_API_KEY` 优先。不要给变量加 `NEXT_PUBLIC_`，不要发到聊天里，不要提交到Git。

3. 现有默认origin为 `https://dashscope.aliyuncs.com`。只有账号明确使用北京业务空间专属endpoint时，才填写控制台实际给出的地址：

```dotenv
ROBIN_VOICE_ORIGIN=https://实际工作空间.cn-beijing.maas.aliyuncs.com
```

这是origin，不包含 `/api/v1` 或 `/compatible-mode/v1`。不要原样复制“实际工作空间”。Key和endpoint地域必须匹配；当前Robin实现不支持新加坡Key/endpoint。

4. 接入完成后择时重启现有Robin服务以读取环境变量，不启动第二个抢占dev lock的实例。先检查配置，再用一段非敏感短文本做一次实际合成，检查usage；“Key存在”不等于权限/余额已验证。

### TTS默认参数

- `model`: `qwen3-tts-flash`
- `voice`: `Cherry`（先作为初始试听音色，不声称是最终最自然的声音）
- 单一中文稿：`language_type: Chinese`
- 明确中英混合稿：`language_type: Auto`，需实测混读，不保证自动发音完全正确。

这些是请求参数，**不是目前已有的环境变量**。当前代码硬编码Cherry及Auto，不能虚构 `ROBIN_TTS_VOICE` 等开关让用户配置无效变量。最终接入时再按需求实现明确的设置。

官方API单次文本上限600字符；Robin口语稿应远短于它。官方支持流式音频输出，但当前实现是完整WAV下载后播放；第一版不把厂商流式能力写成Robin已支持。

## C. 用户最终使用方式

- 每台设备打开已有的Robin HTTPS入口、登录；无需安装Whisper/TTS模型。
- 麦克风只控制听写，识别后先检查文字再发送。
- 独立“精简语音回复”开关决定是否生成口语稿和播放；打字也能听，不必开启麦克风。
- 原始录音只到Mac做Whisper识别。只有生成的短口语稿发给阿里云TTS，不发完整历史/工具日志。对话和改写仍按原有模型提供方处理。
- 关闭开关立即停止播放并取消/丢弃迟到请求，已经提交的任务继续。
- 朗读失败显示可恢复的错误，文字回复不受影响；不偷偷改用另一家云或本地声音。
- iPhone等浏览器首次可能要点播放以解锁音频；不承诺锁屏后台持续对话。

## 仍需实现与验证

本地Whisper接入；ASR/TTS就绪分离；独立且按设备记住的朗读开关；取代前三句抽取的无工具语义改写；主Chat接入；真机录音与播放测试。仅设置Key不能完成这些。

## 来源

- 阿里云价格与字符规则：https://help.aliyun.com/zh/model-studio/model-pricing
- Qwen3-TTS-Flash模型及价格：https://help.aliyun.com/zh/model-studio/qwen3-tts-flash
- 非实时/流式API、语言参数和600字符上限：https://help.aliyun.com/zh/model-studio/qwen-tts-api
- 音色与使用说明：https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide
- 创建Key：https://help.aliyun.com/zh/model-studio/get-api-key
- Kokoro中文模型卡：https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh
- Kokoro混读问题样例：https://github.com/hexgrad/kokoro/issues/238
- 阿里开源Qwen3-TTS：https://github.com/QwenLM/Qwen3-TTS
- 社区Mac MLX实现：https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md
- Whisper部署与模型校验来源：[上一轮调查](robin-local-voice-investigation.md)
