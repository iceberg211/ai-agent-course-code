# digital-human-agent-frontend / Agent 协作说明

## 1. 项目定位
- 技术栈：`Vue 3 + TypeScript + Vite + Pinia + @ai-sdk/vue + WebSocket`
- 职责：角色与会话 UI、文本/语音输入、知识库管理、语音克隆面板、数字人模式切换与信令处理
- 默认端口：`5173`（通过 `/api` 代理到后端）

## 2. 常用命令
- 安装依赖：`pnpm install`
- 开发启动：`pnpm dev`
- 构建：`pnpm build`
- 类型检查：`pnpm type-check`
- 预览：`pnpm preview`

## 3. 关键目录
- `src/App.vue`：应用主布局与各区域拼装
- `src/hooks/useAppController.ts`：主控制器（状态机、WS 事件、文本/语音/数字人协作）
- `src/hooks/useWebSocket.ts`：WebSocket 封装（文本消息 + 二进制音频帧）
- `src/hooks/useAudio.ts`：录音与流式音频播放
- `src/hooks/useKnowledge.ts`：知识库文档管理与检索测试
- `src/hooks/useVoiceClone.ts`：语音克隆上传与状态轮询
- `src/hooks/useDigitalHuman.ts`：WebRTC 信令与视频流处理
- `src/components/*`：分区 UI 组件

## 4. 联调依赖
- 后端服务：`http://localhost:3001`
- 代理路径：
  - REST：`/api/*`
  - WS：`/ws/conversation`
- 关键接口：
  - `/api/personas`
  - `/api/chat`
  - `/api/knowledge/:personaId/documents`
  - `/api/knowledge/:personaId/search`
  - `/api/voice-clone/:personaId`
  - `/api/voice-clone/:personaId/status`

## 5. 前端状态与模式
- 会话状态：`idle | recording | thinking | speaking | closed`
- 模式：`voice | digital-human`
- 语音链路：按住录音 -> 松开发送 -> ASR -> Agent -> TTS/数字人播报
- 文本链路：`@ai-sdk/vue Chat` -> `/api/chat` UIMessage stream

## 6. 研发约定
- 组件尽量无业务副作用，业务逻辑集中在 hooks。
- 新增 WS 消息类型时，必须同步更新：
  - `useAppController.ts` 事件处理
  - 相关类型定义 `src/types.ts`
  - 后端网关消息结构
- 交互改动需保证：
  - 文本发送不会触发麦克风逻辑
  - `interrupt` 可立即中断正在进行的生成/播报
  - 角色切换时会话、缓存和播放器状态完全重置

## 7. 当前阶段状态（简）
- 语音 + 文本 + 知识库 + 引用展示已可用。
- 语音克隆面板可用（当前训练为 mock 流程）。
- 数字人模式已接入信令与视频容器，真实视频流依赖后端接入具体 SDK provider。
