# 数字人 Agent 技术方案

> 一个以 Agent 为大脑、知识库为记忆、语音为输入、数字人为输出的实时对话系统。

---

## 1. 系统定位

这个项目把课程里已经分散实现的能力——Agent、RAG 知识库、语音识别、语音合成——组合成一个完整产品：

**用户对着一个数字人说话，数字人以特定人物的声音、表情、口型实时回答，回答内容基于注入的知识库。**

它解决的不是"模型能不能回答"的问题，而是"交互形式能不能让人觉得在和一个真人对话"的问题。

核心技术链条：

```
用户说话 → ASR 识别 → Agent 思考（RAG 检索 + 人设 Prompt）→ 文字回复
                                                              ↓
                                               数字人 SDK（TTS + 口型 + 表情）
                                                              ↓
                                                    WebRTC 推流 → 浏览器播放
```

课程里已有的模块在这个链条中的位置：

| 已有模块 | 在本项目中的角色 |
|---|---|
| `tts-stt-test` / `asr-and-tts-nest-service` | 语音识别（ASR）直接复用；TTS 在纯语音模式下复用，数字人模式下由 SDK 接管 |
| `milvus-test` / `rag-test` | 知识库检索层直接复用 |
| `langgraph-test` | Agent 执行模式直接复用 |
| `hello-nest-langchain` | NestJS + LangChain 服务模式直接复用 |
| `task-system-test` | NestJS 模块化组织模式复用（本项目不需要 EventEmitter2 解耦——事件流比 mini-manus 简单，Gateway 直接调 Service 即可） |

---

## 2. 整体架构

```mermaid
flowchart TB
    subgraph 浏览器
        MIC["麦克风"]
        VID["视频播放器"]
        TXT["文字显示区"]
        CTL["控制面板"]
    end

    subgraph 后端
        GW["WebSocket Gateway\n(信令 + ASR 音频 + 控制)"]
        AS["Agent Service\n(LangGraph)"]
        KB["Knowledge Base\n(Milvus + RAG)"]
        DH["Digital Human Service\n(云 SDK 封装)"]
    end

    subgraph 云服务
        ASR["ASR 服务\n(语音识别)"]
        DHSDK["数字人 SDK\n(TTS + 口型 + 表情 + 渲染)"]
    end

    MIC -->|WebSocket 二进制音频| GW
    GW -->|音频流| ASR
    ASR -->|识别文本| GW
    GW -->|用户问题| AS
    AS -->|检索| KB
    AS -->|回复文本（流式）| DH
    DH -->|文本 + 参数| DHSDK
    DHSDK ==>|WebRTC 视频/音频流| VID
    GW -->|WebSocket 信令| VID
    GW -->|文字流| TXT
    CTL -->|WebSocket 控制指令| GW
```

---

## 3. 两种模式

这个项目支持两种交互模式，共享同一个 Agent 大脑和知识库，只是输出层不同：

### 模式 A：纯语音对话（不需要数字人）

```
用户说话 → WebSocket(binary) → ASR → 文字
文字 → Agent(RAG) → 回复文字（流式）
回复文字 → TTS(语音克隆) → WebSocket(binary) → MediaSource/SourceBuffer → 播放
同时：回复文字 → WebSocket(JSON) → 前端文字显示
```

这个模式复用 `asr-and-tts-nest-service` 的架构，升级点是：
1. TTS 使用克隆后的声音
2. Agent 接入 RAG 知识库和人设系统

### 模式 B：数字人对话

```
用户说话 → WebSocket(binary) → ASR → 文字
文字 → Agent(RAG) → 回复文字（流式）
回复文字 → 数字人 SDK → 视频+音频流 → WebRTC → 浏览器播放
同时：回复文字 → WebSocket(JSON) → 前端文字显示
WebSocket 负责：WebRTC 信令交换（SDP offer/answer, ICE candidates）
```

和模式 A 的区别：
- TTS 不再由后端单独调用，而是由数字人 SDK 内置处理
- 输出从"音频流"变成"视频 + 音频流"
- 多了 WebRTC 连接，多了信令交换

---

## 4. 三层协议

这个项目同时用到三种实时通信协议，各管各的事：

```
┌─────────────────────────────────────────────────────┐
│  WebRTC                                              │
│  数字人的视频 + 音频实时推流                            │
│  特点：P2P 媒体传输，低延迟，浏览器原生支持               │
│  只在数字人模式下使用                                   │
├─────────────────────────────────────────────────────┤
│  WebSocket                                           │
│  - 上行：麦克风音频(binary) / 控制指令(JSON)            │
│  - 下行：ASR 识别结果 / Agent 回复文字 / WebRTC 信令    │
│  - 纯语音模式下也承载 TTS 音频(binary)                  │
│  特点：双向、全双工、低延迟                              │
├─────────────────────────────────────────────────────┤
│  HTTP REST                                           │
│  - 知识库管理（上传文档、查询状态）                      │
│  - 人设配置（创建/编辑角色）                            │
│  - 会话历史查询                                        │
│  特点：请求-响应、无状态                                │
└─────────────────────────────────────────────────────┘
```

### 4.1 实现选型：统一使用原生 WebSocket

V1 统一采用浏览器原生 `WebSocket` + 后端 `ws` 风格网关，不引入 Socket.IO。这样可以直接复用 `asr-and-tts-nest-service` 的设计思路，也避免同时维护两套事件语义。

这意味着文档里的所有实时控制消息最终都落成：
- 浏览器端：`ws.addEventListener('message', ...)` + `ws.send(JSON.stringify(...))`
- 后端：`client.send(JSON.stringify(...))`
- 不使用 `ws.on('event') / ws.emit(...)` 这种 Socket.IO 风格 API

### 4.2 WebSocket 消息封包

除纯语音模式下的 TTS 音频帧外，所有实时消息都使用统一的 JSON 封包：

```typescript
interface WsEnvelope<T = unknown> {
  type: string;   // 如 webrtc:offer / webrtc:answer / conversation:text_chunk
  sessionId: string;
  turnId?: string;   // 一轮用户提问 + 一轮助手回答
  seq?: number;      // 同一 turn 内的流式顺序号
  status?: 'start' | 'streaming' | 'completed' | 'interrupted' | 'failed';
  payload: T;
}
```

推荐的消息类型：
- `session:start`
- `asr:final`
- `conversation:start`
- `conversation:text_chunk`
- `conversation:done`
- `conversation:interrupt`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice-candidate`
- `tts:start`
- `tts:end`
- `error`

纯语音模式下，TTS 音频继续走 Binary，但前后必须有 JSON 控制帧：
1. 服务端先发 `tts:start`，其中带 `sessionId`、`turnId`、音频编码信息
2. 服务端连续发送该 `turnId` 对应的二进制音频帧
3. 服务端最后发 `tts:end`
4. 前端只消费当前 `activeTurnId` 的音频帧，旧 turn 的迟到音频直接丢弃

### 为什么不全用 WebSocket

WebSocket 能做一切实时通信，但：

- 视频推流用 WebSocket 是灾难——没有拥塞控制、没有自适应码率、没有硬件编解码加速。WebRTC 专门为这件事设计，浏览器有原生优化。
- 知识库管理、人设配置这些低频操作用 REST 更合适——无状态、可缓存、调试方便。

### WebRTC 在这个项目中的角色

WebRTC 的难点不在使用，而在理解。

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant S as 后端(信令)
    participant D as 数字人 SDK

    B->>S: WebSocket: 请求开始对话
    S->>D: 初始化数字人会话
    D->>S: SDP Offer (媒体能力描述)
    S->>B: WebSocket: 转发 SDP Offer
    B->>B: 创建 RTCPeerConnection
    B->>S: WebSocket: SDP Answer
    S->>D: 转发 SDP Answer
    Note over B,D: ICE 候选交换（多轮，省略）
    D==>>B: WebRTC: 视频+音频流（持续推送）

    Note over B,S: 对话开始后
    B->>S: WebSocket: 麦克风音频
    S->>S: ASR → Agent → 回复文字
    S->>D: 回复文字
    D==>>B: WebRTC: 数字人说话（视频+音频）
```

关键概念：
- **SDP（Session Description Protocol）**：双方交换"我支持什么编码格式、什么分辨率"
- **ICE（Interactive Connectivity Establishment）**：双方探测网络路径，找到能通的连接方式
- **信令服务器**：就是我们的 WebSocket Gateway，只负责转发 SDP 和 ICE，不碰媒体流本身

云厂商的数字人 SDK 会把 WebRTC 的细节封装好。但理解这三个概念是必要的——不然你连 SDK 的回调参数都看不懂。

---

## 5. Agent 大脑

### 5.1 职责

Agent 是整个系统的大脑。它接收用户问题，检索知识库，按照人设回答。

和 mini-manus 的 Agent 不同：
- mini-manus 的 Agent 是**任务型**——拆步骤、调工具、生成产物
- 这个 Agent 是**对话型**——理解问题、检索知识、生成符合人设的回答

所以这里**不需要 planner/executor/evaluator 四节点结构**，用一个简单的 RAG + 对话 Agent 就够了。

### 5.2 执行流程

```mermaid
flowchart LR
    Q["用户问题"] --> R["RAG 检索"]
    R --> P["构建 Prompt\n(人设 + 检索结果 + 对话历史)"]
    P --> L["LLM 流式生成"]
    L --> O["回复文字流"]
```

### 5.3 Prompt 结构

```
System:
  你是{角色名}。{角色简介}
  你的说话风格：{风格描述}
  你的专业领域：{领域描述}

  以下是与当前问题相关的知识：
  ---
  {RAG 检索结果，top-k 条}
  ---

  要求：
  1. 始终以{角色名}的身份回答
  2. 回答基于上述知识，不要编造不在知识库中的内容
  3. 如果知识库中没有相关信息，诚实说"这个我不太清楚"
  4. 语气和用词要符合角色人设
  5. 回答要口语化，适合语音朗读（避免长列表、代码块、复杂格式）

History:
  {最近 N 轮对话}

User:
  {当前问题}
```

注意第 5 条：回答要口语化。这是语音场景和文字场景最大的区别——模型默认会输出 Markdown 列表、代码块、长句，这些东西 TTS 读出来会很奇怪。Prompt 里必须显式约束。

### 5.4 对话记忆

短期记忆：最近 N 轮对话，从 `conversation_message` 表查询，拼进 Prompt 的 History 部分。不在内存中维护长期历史——每次用户提问时直接查 DB 取最近 N 条，进程重启不丢上下文。

N 的选择：语音对话轮次短、每轮文字少，N=10 通常够用。不需要像 mini-manus 那样做 result_summary 压缩——对话场景不会像任务执行那样产生大量工具输出。

长期记忆：知识库（Milvus）。不按会话存储，按角色存储——同一个角色的知识库在所有会话中共享。

History 查询的一个关键约束：**默认只取 `status=completed` 的消息进入 Prompt**。被打断或失败的 assistant 半句回复可以保留在 UI 历史里，但不默认回灌给模型，否则会把不完整答案当成上下文。

这里的“无状态”只指**历史上下文不依赖进程内存**，不代表整个实时链路无状态。运行时仍然必须维护：
- 当前 `sessionId` / `turnId`
- `AbortController`
- 断句缓冲区
- 数字人 `speak()` 播报队列
- WebRTC ICE 回调与清理函数

V1 里这些状态放在进程内的 `RealtimeSessionRegistry`。如果后续做多实例部署，需要增加 sticky session，或者把这部分状态迁到外部会话存储。

### 5.5 关于 LangGraph

技术上，这个项目的 Agent 流程是线性的（检索 → 拼 Prompt → 流式生成），用 LangChain 的 LCEL（RunnableSequence）完全够了，不需要复杂的状态图和条件边。

但本项目仍选择 **LangGraph 作为 AgentService 的运行时骨架**，原因是教学连贯性——学生在 mini-manus 里刚学了 StateGraph，这里继续使用同一套模式，只是图退化成一个线性流程：`retrieve -> buildPrompt -> streamAnswer`。Prompt、Model、Parser、Embeddings 这些底层组件依然复用 LangChain。

如果是独立项目而非课程的一部分，直接用 LCEL 也完全合理。

### 5.6 流式输出与 TTS 衔接

Agent 的回复是流式产生的（token by token）。但 TTS 不能逐 token 喂——需要攒到一个语义完整的片段（句子）再送。

策略：**按标点断句缓冲**。

```
Agent 输出 token 流 → 缓冲区 → 遇到句号/问号/感叹号/逗号 → 刷出一段文字
                                                              ↓
                                               TTS（或数字人 SDK）→ 音频/视频
```

缓冲区逻辑：
- 遇到 `。？！；` → 立刻刷出（句子结束）
- 遇到 `，、：` → 如果缓冲区超过 15 字，刷出（防止长从句卡住）
- 缓冲区超过 50 字但没遇到标点 → 强制刷出（兜底）
- Agent 输出结束 → 刷出剩余内容

这个断句缓冲是语音对话体验的关键。太小会让 TTS 频繁启停、语音不连贯；太大会让用户等太久才听到声音。

---

## 6. 知识库与人设系统

### 6.1 知识库架构

复用 `milvus-test` 的 RAG 管线，按角色组织：

```
Milvus Collection: persona_knowledge
├── persona_id: string       // 角色 ID
├── document_id: string      // FK → knowledge_document.id，用于按文档删除/重建
├── chunk_index: int         // 在原文档中的顺序
├── content: text            // 知识片段
├── source: string           // 来源（文档名、URL）
├── category: string         // 分类（背景、专业知识、FAQ 等）
├── embedding: float[1024]   // 向量
└── created_at: datetime
```

`document_id` 和 `chunk_index` 的作用：删除某个文档时，按 `document_id` 精确删除 Milvus 中对应的所有向量，不影响其他文档。没有这两个字段，你只能全量重建——这对已有大量知识的角色是不可接受的。

检索时按 `persona_id` 过滤 + 向量相似度排序，返回 top-5。**设相似度阈值（如 cosine ≥ 0.6），低于阈值的结果丢弃，不塞进 Prompt**——否则不相关的片段会误导模型编造答案。如果全部结果都低于阈值，Agent 应直接回复"这个我不太清楚"，而不是硬凑。

### 6.2 知识入库流程

```mermaid
flowchart LR
    A["上传文档\n(PDF/TXT/URL)"] --> B["文档加载\n(LangChain Loader)"]
    B --> C["文本切分\n(RecursiveCharacterTextSplitter)"]
    C --> D["向量化\n(OpenAI Embeddings)"]
    D --> E["写入 Milvus\n(带 persona_id 标记)"]
```

切分策略：
- chunk_size: 500 字符（语音场景下检索结果要短，不能一次塞一大段）
- chunk_overlap: 100 字符
- 语言敏感切分：中文按句号/段落优先切分

### 6.3 人设配置

```typescript
interface Persona {
  id: string;
  name: string;                // "李老师"
  avatar_url: string;          // 数字人形象对应的 ID / URL
  voice_id: string;            // 克隆语音的 ID
  description: string;         // 角色简介
  speaking_style: string;      // "说话温和，喜欢用比喻，偶尔讲冷笑话"
  expertise: string[];         // ["机器学习", "Python", "数据分析"]
  system_prompt_extra: string; // 额外的系统提示（可选）
}
```

人设不存向量库，存 MySQL。它是 Prompt 的一部分，不是检索的对象。

---

## 7. 语音交互层

### 7.1 语音输入（ASR）

直接复用 `asr-and-tts-nest-service` 的模式：

```
浏览器麦克风 → MediaRecorder → WebSocket(binary) → 后端 → 腾讯云 ASR → 识别结果
```

两种 ASR 模式：
- **一句话识别**（V1）：用户说完一句话后发送完整音频，批量识别。延迟高但简单。
- **实时流式识别**（V2）：音频边录边发，ASR 边听边出中间结果。延迟低但需要处理 VAD（语音活动检测）和中间结果/最终结果的区分。

V1 先用一句话识别，交互形式是"按住说话，松开发送"。这和大多数语音助手的交互一致，用户理解成本低。

这里要把按钮语义钉死：**松开按钮只表示“结束当前录音并发送识别”**；如果数字人正在思考或说话，用户再次按下按钮才表示“打断并开始新一轮录音”。不要把“松开”同时定义成“发送”和“打断”。

### 7.2 语音输出（TTS）—— 纯语音模式

在不接数字人 SDK 的情况下，TTS 复用 `asr-and-tts-nest-service` 的流式 TTS：

```
Agent 回复文字（按句缓冲）→ 腾讯云流式 TTS(WSv2) → 二进制音频帧 → WebSocket → 浏览器
```

浏览器端播放：

```javascript
// MediaSource + SourceBuffer 实现流式音频播放
const mediaSource = new MediaSource();
audio.src = URL.createObjectURL(mediaSource);

mediaSource.addEventListener('sourceopen', () => {
  const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
  const appendQueue = [];
  let activeTurnId = null;

  const flushQueue = () => {
    if (sourceBuffer.updating || appendQueue.length === 0) return;
    sourceBuffer.appendBuffer(appendQueue.shift());
  };

  sourceBuffer.addEventListener('updateend', flushQueue);

  ws.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);

      if (msg.type === 'tts:start') activeTurnId = msg.turnId;
      if (msg.type === 'tts:end' && msg.turnId === activeTurnId) activeTurnId = null;
      return;
    }

    // 只追加当前 turn 的音频，旧 turn 的迟到帧直接丢弃
    if (activeTurnId && event.data instanceof Blob) {
      appendQueue.push(new Uint8Array(await event.data.arrayBuffer()));
      flushQueue();
    }
  });
});
```

MediaSource 的优势：音频边收边播，不需要等全部生成完。用户感知到的延迟 = ASR 时间 + Agent 首 token 时间 + TTS 首帧时间，通常 1-3 秒。

### 7.3 语音输出 —— 数字人模式

数字人模式下，**不需要单独调 TTS**。数字人 SDK 内部集成了：
1. 文字 → 语音（TTS，可使用克隆声音）
2. 语音 → 口型驱动
3. 口型 + 表情 + 动作 → 视频帧
4. 视频帧 → WebRTC 推流

后端只需要把 Agent 的回复文字（按句缓冲后）送给数字人 SDK，剩下的全由 SDK 处理。

---

## 8. 语音克隆

### 8.1 定位

语音克隆的目的是让数字人用目标人物的声音说话，而不是用默认的 TTS 声音。

它是一个**前置的一次性操作**，不是实时流程的一部分：

```
目标人物语音样本（3-10 分钟） → 语音克隆服务 → 生成 voice_id → 存入 Persona 配置
                                                                  ↓
                                                运行时 TTS / 数字人 SDK 使用该 voice_id
```

### 8.2 方案选择

| 方案 | 特点 | 适用场景 |
|---|---|---|
| 云厂商语音克隆 API | 开箱即用，质量稳定，按调用计费 | 生产环境、课程演示 |
| CosyVoice / GPT-SoVITS | 开源，可本地部署，需要 GPU | 教学、定制化需求 |

V1 建议用云厂商 API（和 ASR/TTS 同一家，降低集成成本）。教学时可以额外演示开源方案的部署和效果对比。

### 8.3 语音样本要求

- 时长：3-10 分钟的清晰语音
- 格式：WAV/MP3，16kHz 以上采样率
- 内容：正常语速、无背景噪音、覆盖多种语气（陈述、疑问、感叹）
- 注意：样本质量直接决定克隆效果。噪音多、语速不均匀的样本会导致克隆声音不自然

---

## 9. 数字人层

### 9.1 数字人 SDK 做了什么

从外部看，数字人 SDK 就是一个黑盒：

```
输入：文字 + voice_id + 数字人形象 ID
输出：WebRTC 视频流（包含口型同步、表情变化、身体动作的数字人视频 + 对应音频）
```

SDK 内部做了至少 4 件事：
1. **TTS**：文字 → 音频波形
2. **口型驱动（Lip Sync）**：音频波形 → 嘴型关键帧序列
3. **表情/动作生成**：基于文本语义 + 音频韵律生成面部表情和身体动作
4. **实时渲染 + 推流**：把数字人形象 + 口型 + 表情 + 动作合成视频帧，通过 WebRTC 推出

### 9.2 后端集成方式

后端不需要了解数字人渲染的细节。它只需要：

```typescript
interface DigitalHumanService {
  // 创建会话：初始化数字人，返回 WebRTC 信令信息
  createSession(personaId: string): Promise<{
    sessionId: string;
    sdpOffer: RTCSessionDescriptionInit;
  }>;

  // 交换 SDP Answer
  setAnswer(sessionId: string, sdpAnswer: RTCSessionDescriptionInit): Promise<void>;

  // 交换 ICE Candidate（浏览器 → SDK）
  addIceCandidate(sessionId: string, candidate: RTCIceCandidateInit): Promise<void>;

  // 注册 SDK → 浏览器的 ICE Candidate 回调，返回取消订阅函数
  onIceCandidate(
    sessionId: string,
    callback: (candidate: RTCIceCandidateInit) => void,
  ): () => void;

  // 发送文字让数字人说话（内部维护播报队列，前一句未完成时排队等待）
  speak(sessionId: string, turnId: string, text: string): Promise<void>;

  // 打断当前说话；如果带 turnId，则只打断当前激活轮次
  interrupt(sessionId: string, turnId?: string): Promise<void>;

  // 关闭会话，同时释放播报队列、ICE 回调和 SDK 侧资源
  closeSession(sessionId: string): Promise<void>;
}
```

整个后端只需要实现这个接口。具体 SDK 的 API 差异封装在这一层内部。

注意 `speak()` 的队列语义：连续调用 `speak()` 不应该让后一句覆盖前一句。如果 SDK 不自带排队机制，后端需要在 Service 内部维护一个 FIFO 队列——等 SDK 回调"当前句播报完毕"后再弹出下一句。`interrupt()` 清空整个队列。

**STUN/TURN**：WebRTC 在 NAT 环境下需要 STUN 服务器发现公网 IP，复杂网络环境还需要 TURN 服务器中转。云厂商的数字人 SDK 通常自带 STUN/TURN，不需要自己部署。但在选型时要确认这一点——如果厂商不提供，需要自建或使用公共 STUN 服务。

### 9.3 WebRTC 信令流程（后端视角）

后端在 WebRTC 中的角色是**信令中继**——把浏览器和数字人 SDK 之间的 SDP/ICE 消息通过 WebSocket 转发。

```typescript
// WebSocket Gateway 处理信令（原生 WebSocket 风格）
async function handleJsonMessage(client: WebSocket, raw: string) {
  const msg = JSON.parse(raw);

  if (msg.type === 'webrtc:answer') {
    await this.digitalHumanService.setAnswer(
      msg.sessionId,
      msg.payload.sdpAnswer,
    );
  }

  if (msg.type === 'webrtc:ice-candidate') {
    await this.digitalHumanService.addIceCandidate(
      msg.sessionId,
      msg.payload.candidate,
    );
  }
}

const unsubscribe = this.digitalHumanService.onIceCandidate(
  sessionId,
  (candidate) => {
    client.send(JSON.stringify({
      type: 'webrtc:ice-candidate',
      sessionId,
      payload: { candidate },
    }));
  },
);

// 会话关闭时调用 unsubscribe()
```

ICE 是双向的：浏览器把自己的候选路径告诉 SDK，SDK 也把自己的候选路径告诉浏览器。漏掉任何一个方向都会导致连接建立失败。

后端不碰媒体流。视频和音频直接从数字人 SDK 的服务器走 WebRTC 到浏览器，延迟最低。

### 9.4 打断机制

语音对话的一个重要体验：用户随时可以打断数字人说话。

打断必须级联中止整条链路，不能只停末端：

```
前端发送 { type: 'conversation:interrupt', sessionId, turnId }
       ↓
1. `RealtimeSessionRegistry` 标记当前 `turnId` 为 interrupted
2. `AbortController.abort()` → 取消 LLM 流式生成（停止扣 token）
3. 清空断句缓冲区（丢弃已缓冲但未发送的文字）
4. 清空 `speak()` 播报队列（丢弃已排队但未播报的句子）
5. `digitalHumanService.interrupt(sessionId, turnId)`（停止当前播报）
6. 前端丢弃 `turnId !== activeTurnId` 的尚未渲染文字和音频
```

如果只做“停止数字人播报”而不做 `AbortController.abort()`，会出现：用户已经打断了，LLM 还在继续生成、继续扣 token，生成的文字还会流进缓冲区、流进播报队列，数字人会在短暂停顿后又开始说旧回答。

实现方式：Agent 调用链启动时创建 `AbortController`，传入 LangChain 的 `signal` 参数。打断时调用 `controller.abort()`，整条链路同步终止。

### 9.5 会话生命周期与清理

以下场景必须显式清理旧会话，而不是只创建新会话：
1. 切换角色
2. 页面刷新 / 关闭
3. WebRTC 建连失败后重试
4. WebSocket 断线重连

统一清理动作：
- `AbortController.abort()`
- `digitalHumanService.closeSession(sessionId)`
- 调用 `onIceCandidate()` 返回的取消订阅函数
- 销毁前端 `RTCPeerConnection`
- 清空本地字幕缓冲和音频队列
- 从 `RealtimeSessionRegistry` 删除该 `sessionId` 的运行时状态

这一步不仅是资源释放问题，也影响计费和用户体验。旧会话不清理，后面很容易出现串流、串字幕和重复扣费。

---

## 10. 前端设计

### 10.1 页面布局

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│              ┌──────────────────┐                    │
│              │                  │                    │
│              │   数字人视频区     │                    │
│              │   (WebRTC video) │                    │
│              │                  │                    │
│              └──────────────────┘                    │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  对话文字区（可折叠）                             │  │
│  │  用户: React Compiler 是什么？                    │  │
│  │  李老师: React Compiler 是 React 19 引入的...    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│         🎤 [按住说话]    ⚙️ [设置]    ⏹️ [结束]       │
│                                                      │
│  侧边栏（可折叠）：                                    │
│  ├ 角色选择                                           │
│  ├ 知识库管理                                         │
│  └ 会话历史                                           │
└─────────────────────────────────────────────────────┘
```

### 10.2 核心交互

前端需要显式维护 5 个状态，避免“发送”和“打断”混在一个按钮动作里：

| 状态 | 含义 | 麦克风按钮行为 | 下一状态 |
|---|---|---|---|
| `idle` | 空闲，未录音、未播报 | 按下开始录音 | `recording` |
| `recording` | 正在采集用户语音 | 松开结束录音并上传音频 | `thinking` |
| `thinking` | ASR / Agent 处理中，数字人尚未开口 | 再次按下：先发 `conversation:interrupt`，再开始新录音 | `recording` |
| `speaking` | 数字人正在播报 | 再次按下：先发 `conversation:interrupt`，再开始新录音 | `recording` |
| `closed` | 会话已结束 | 禁用麦克风按钮 | - |

核心交互：

| 操作 | 前端 | 后端 |
|---|---|---|
| 选择角色 | 关闭旧会话 → 初始化新 Persona 会话 → 建立 WebRTC | `closeSession(old)` → `createSession(new)` |
| 说话 | `idle` 按下开始录音，`recording` 松开发送音频 | ASR → Agent → 创建 `turnId` → speak 队列 |
| 听回答 | WebRTC video 播放 + 当前 `turnId` 的文字同步显示 | Agent 流式回复 → 按句缓冲 → 数字人 SDK |
| 打断插话 | `thinking/speaking` 状态再次按下，发送 `conversation:interrupt`，立即开始新录音 | 中断当前 `turnId`，清空缓冲与播报队列 |
| 上传知识 | 文件上传 → REST API | 文档加载 → 切分 → 向量化 → 写入 Milvus |
| 查看历史 | 展开侧边栏 → 加载历史对话 | 查询会话记录 |

### 10.3 WebRTC 前端接入

```javascript
// 简化的 WebRTC 接入流程（原生 WebSocket 风格）
const pc = new RTCPeerConnection(iceConfig);
const ws = new WebSocket('/ws/conversation');
const pendingRemoteCandidates = [];
let remoteDescriptionReady = false;
let currentSessionId = '';

ws.addEventListener('message', async (event) => {
  if (typeof event.data !== 'string') return;

  const msg = JSON.parse(event.data);
  if (msg.sessionId !== currentSessionId) return;

  if (msg.type === 'webrtc:offer') {
    await pc.setRemoteDescription(msg.payload.offer);
    remoteDescriptionReady = true;

    while (pendingRemoteCandidates.length > 0) {
      await pc.addIceCandidate(pendingRemoteCandidates.shift());
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({
      type: 'webrtc:answer',
      sessionId: currentSessionId,
      payload: { sdpAnswer: answer },
    }));
  }

  if (msg.type === 'webrtc:ice-candidate') {
    const candidate = msg.payload.candidate;
    if (!remoteDescriptionReady) {
      pendingRemoteCandidates.push(candidate);
    } else {
      await pc.addIceCandidate(candidate);
    }
  }
});

pc.onicecandidate = (event) => {
  if (!event.candidate) return;

  ws.send(JSON.stringify({
    type: 'webrtc:ice-candidate',
    sessionId: currentSessionId,
    payload: { candidate: event.candidate },
  }));
};

pc.ontrack = (event) => {
  videoElement.srcObject = event.streams[0];
};
```

云厂商 SDK 通常会把上面这些封装成一个 `init()` 方法。但理解底层流程对排查连接问题至关重要。

---

## 11. 后端模块划分

| 模块 | 职责 | 核心导出 |
|---|---|---|
| **GatewayModule** | WebSocket Gateway：ASR 音频接收、WebRTC 信令中继、控制指令、文字推送 | ConversationGateway |
| **RealtimeSessionModule** | 实时会话状态：`sessionId` / `turnId`、`AbortController`、断句缓冲、播报队列、ICE 清理函数 | RealtimeSessionRegistry |
| **AgentModule** | LangGraph 线性对话图：检索 + 人设 Prompt + 流式生成 | AgentService |
| **KnowledgeModule** | 知识库管理：文档上传、切分、向量化、Milvus CRUD | KnowledgeService |
| **PersonaModule** | 人设管理：角色 CRUD、语音/形象配置 | PersonaService |
| **AsrModule** | ASR 封装：音频流 → 文字 | AsrService |
| **TtsModule** | 流式 TTS 封装（纯语音模式用） | TtsService |
| **DigitalHumanModule** | 数字人 SDK 封装：会话管理、speak、interrupt | DigitalHumanService |
| **ConversationModule** | 会话记录：对话历史持久化 | ConversationService |

调用关系：

```mermaid
flowchart LR
    GW["ConversationGateway"] --> ASR["AsrService"]
    GW --> RS["RealtimeSessionRegistry"]
    GW --> AG["AgentService"]
    AG --> KB["KnowledgeService\n(Milvus)"]
    AG --> PS["PersonaService"]
    GW --> DH["DigitalHumanService"]
    GW --> TTS["TtsService\n(纯语音模式)"]
    GW --> CS["ConversationService"]
```

和 mini-manus 后端的区别：
- 没有 TaskModule（不是任务系统）
- 没有 EventEmitter2 解耦层（数字人项目的事件流更简单，Gateway 直接调 Service 即可）
- 多了 ASR/TTS/DigitalHuman 三个和语音相关的模块

补充说明：`ConversationGateway` 不应该自己偷偷维护复杂状态；这些状态统一收口到 `RealtimeSessionRegistry`，这样打断、重连、角色切换时才有单一真相来源。

---

## 12. 数据模型

这个项目的数据模型比 mini-manus 简单得多——不需要 revision/run/plan/step 的分层。

```
persona                          // 角色配置
├── id: UUID, PK
├── name: string
├── description: text
├── speaking_style: text
├── expertise: JSON (string[])
├── voice_id: string             // 语音克隆 ID
├── avatar_id: string            // 数字人形象 ID
├── system_prompt_extra: text?
├── created_at: datetime
└── updated_at: datetime

conversation                     // 会话
├── id: UUID, PK
├── persona_id: UUID, FK
├── created_at: datetime
└── updated_at: datetime

conversation_message             // 对话消息
├── id: UUID, PK
├── conversation_id: UUID, FK
├── turn_id: UUID                // 同一轮 user + assistant 的关联键
├── role: enum(user, assistant)
├── seq: int                     // 同一 turn 内的顺序号
├── content: text
├── status: enum(completed, interrupted, failed)
├── created_at: datetime
└── updated_at: datetime

knowledge_document               // 知识文档（原始）
├── id: UUID, PK
├── persona_id: UUID, FK
├── filename: string
├── status: enum(pending, processing, completed, failed)
├── chunk_count: int
├── created_at: datetime
```

向量数据在 Milvus 里，不在 MySQL。MySQL 只存元数据。

运行时状态不落 MySQL，统一放在 `RealtimeSessionRegistry`：

```
realtime_session                 // 运行时内存结构（V1）
├── session_id
├── conversation_id
├── persona_id
├── active_turn_id
├── abort_controller
├── sentence_buffer
├── speak_queue
├── ice_unsubscribe
└── ws_client_id
```

落库策略建议：
- 用户消息：ASR 返回最终文本后一次写入 `conversation_message`
- 助手消息：流式过程中先走内存 / WebSocket 推送，结束时合并后一次写入 DB
- 被打断的助手消息：以 `status=interrupted` 落库，默认不参与下一轮 Prompt

---

## 13. 已有实现复用清单

| 已有代码 | 复用什么 | 需要改什么 |
|---|---|---|
| `asr-and-tts-nest-service/speech.gateway.ts` | WebSocket 双协议模式（JSON + Binary）的**设计思路** | 需要重写：现有 Gateway 不支持麦克风二进制上行和 WebRTC 信令，需要新建 ConversationGateway |
| `asr-and-tts-nest-service/tencent-tts-session.ts` | 流式 TTS 会话管理的**封装模式** | 加按句缓冲逻辑 + AbortController 支持 |
| `asr-and-tts-nest-service/speech.service.ts` | ASR 一句话识别封装 | 接口可复用，但注意它是整段音频识别，不是实时流式 ASR |
| `milvus-test/src/rag.mjs` | 向量检索 + RAG 流程 | 改为按 persona_id 过滤检索 |
| `rag-test/src/splitters/` | 文本切分策略 | 调整 chunk_size 适配语音场景 |
| `hello-nest-langchain/src/ai/` | LangChain 流式对话链 | 加 RAG context + 人设 Prompt |
| `langgraph-test/src/02-tool-agent-graph.mjs` | LangGraph Agent 模式 | 简化为对话模式（不需要工具循环） |

---

## 14. 前置验证项

开工前需要用最小 demo 验证以下 4 个供应商相关的假设，否则实现中途可能需要返工：

| 验证项 | 要验证的假设 | 如果不成立的影响 |
|---|---|---|
| 数字人 SDK 的 `speak()` 是否支持排队 | 连续调用 speak() 时后一句等前一句说完 | 不支持则后端需要自建播报队列 |
| 语音克隆 voice_id 是否能同时用于独立 TTS 和数字人 SDK | 同一个 voice_id 在两个模式下通用 | 不通用则需要分别克隆，或只支持其中一种模式 |
| 数字人 SDK 是否自带 STUN/TURN | WebRTC 在 NAT 环境下能正常连接 | 不自带则需要自建/采购 TURN 服务 |
| 数字人 SDK 的 interrupt() 延迟 | 调用后 < 500ms 内停止播报 | 延迟太高则打断体验差，需要考虑前端本地静音兜底 |

每项验证写一个最小脚本（调 SDK API → 观察行为），半天内可以全部完成。

---

## 15. V1 范围

### 做

1. 纯语音对话模式（模式 A）：麦克风 → ASR → Agent(RAG) → TTS → 流式播放
2. 数字人对话模式（模式 B）：麦克风 → ASR → Agent(RAG) → 数字人 SDK → WebRTC
3. 知识库管理：上传文档 → 切分 → 向量化 → 检索
4. 人设系统：创建角色、配置声音/形象/知识库
5. 语音克隆：上传语音样本 → 生成 voice_id
6. 按句缓冲的流式 TTS 衔接
7. 对话历史持久化
8. 前端：数字人视频区 + 对话文字区 + 按住说话 + 角色选择

### 不做

1. 实时流式 ASR（V1 用"按住说话"的一句话识别）
2. 多角色同屏对话
3. 数字人形象定制（用 SDK 预设形象）
4. 自托管语音克隆模型（用云 API）
5. 数字人视频录制/回放
6. 多人会议模式

### V1 部署假设

1. 后端先按单实例部署；如果提前上多实例，至少要有 sticky session
2. 单个 `sessionId` 同一时刻只允许一个活跃 `turnId`
3. WebRTC / 数字人 SDK 的资源由服务端显式清理，不依赖超时自动回收

---

## 16. 实现顺序

### 第一步：纯语音对话（不接数字人）

在 `asr-and-tts-nest-service` 基础上升级：
1. 接入 Milvus 知识库
2. 加入人设 Prompt
3. 实现按句缓冲
4. 前端加"按住说话"交互

完成后你已经有一个能用克隆声音、基于知识库回答的语音助手。

### 第二步：加知识库管理

1. 文档上传 API
2. 切分 + 向量化流水线
3. 前端知识库管理界面

### 第三步：接数字人 SDK

1. 封装 DigitalHumanService
2. WebSocket 加 WebRTC 信令消息
3. 前端 WebRTC 接入
4. 打断机制

### 第四步：语音克隆

1. 封装语音克隆 API
2. 前端语音样本上传
3. 人设配置关联 voice_id

这个顺序的逻辑：先让 Agent + 知识库 + 语音跑通（核心价值），再加数字人（交互升级），最后加语音克隆（个性化）。

---

## 17. 成功标准

完整流程：

1. 创建一个角色"李老师"，上传一份 React 相关的技术文档作为知识库
2. 上传李老师的语音样本，完成语音克隆
3. 选择"李老师"角色，进入对话
4. 浏览器显示数字人形象，数字人处于待命状态
5. 按住说话："React Compiler 是什么？"
6. 数字人用李老师的声音回答，口型同步，表情自然
7. 回答内容来自上传的知识库，不编造
8. 对话文字同步显示在文字区
9. 用户可以随时打断数字人说话
10. 切换到另一个角色，知识库和声音同步切换

10 条全部走通 = 一个完整的"知识库 + 数字人 + 语音克隆 + 实时对话"系统。
