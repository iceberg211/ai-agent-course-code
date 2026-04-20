# digital-human-agent / Agent 协作说明

## 1. 项目定位
- 技术栈：`NestJS 11 + TypeORM + PostgreSQL(Supabase) + ws + LangChain/LangGraph`
- 职责：角色管理、知识库检索、ASR/TTS、会话网关、文本流接口、语音克隆、数字人模式编排
- 默认端口：`3001`

## 2. 常用命令
- 安装依赖：`pnpm install`
- 开发启动：`pnpm start:dev`
- 构建：`pnpm build`
- 单测：`pnpm test`
- E2E：`pnpm test:e2e`
- 数据库迁移：`pnpm db:migrate`

## 3. 关键目录
- `src/gateway`：WebSocket 会话主链路（语音/数字人模式分流）
- `src/chat`：`/chat` 文本流接口（AI SDK 协议）
- `src/knowledge`：知识库定义、检索配置、persona 挂载关系
- `src/knowledge-content`：文档摄入、chunk 管理、向量检索、rerank
- `src/asr` / `src/tts`：阿里兼容模式语音能力
- `src/voice-clone`：语音样本上传与训练状态
- `src/digital-human`：数字人会话与 WebRTC 信令抽象
- `supabase/migrations`：数据库 DDL 和 RPC

## 4. 环境变量（最小集）
- `DATABASE_URL`：TypeORM 连接串
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（阿里兼容地址）
- `ASR_MODEL=paraformer-realtime-v2`
- `TTS_MODEL=cosyvoice-v1`
- `TTS_DEFAULT_VOICE=longxiaochun`

可选：
- `VOICE_CLONE_MOCK_DELAY_MS`（语音克隆 mock 训练时长，毫秒）
- `SESSION_HISTORY_LIMIT`（会话恢复历史条数）
- `TYPEORM_LOGGING=true`（联调排障时打开）

## 5. 联调入口
- Swagger：`http://localhost:3001/api/docs`
- 文本对话：`POST /chat`
- 角色：`/personas`
- 知识库：`/knowledge-bases`、`/personas/:personaId/knowledge-bases`
- 检索调试：`/knowledge-bases/:kbId/search`、`/personas/:personaId/search`
- 语音克隆：`POST /voice-clone/:personaId`、`GET /voice-clone/:personaId/status`
- WS：`ws://localhost:3001/ws/conversation`

## 6. 研发约定
- 导入路径统一使用根别名 `@/`，不要继续新增 `../../` 形式的相对导入。
- 单文件目标长度 `<= 300` 行，硬上限 `400` 行；超过必须拆分服务、控制器或辅助模块。
- 新接口必须补充 Swagger 注解与 DTO 校验。
- 常量管理统一收口到 `src/common/constants`，但只放两类内容：
  - 跨模块复用的系统级常量，例如 DI token、Provider 名称、默认模型名、共享文件类型、共享默认配置。
  - 被多个模块共同依赖、需要单点维护的映射或默认值。
- 不要把单文件内的局部数字阈值、一次性边界值硬抽到 `common/constants`；这类值应就近放在所属文件，保证可读性。
- 提示词统一放在 `src/common/prompts`，并且必须使用 LangChain 的 `ChatPromptTemplate` / `PromptTemplate` 管理。
- Service / Controller 中不要再直接内联大段 `SystemMessage`、`HumanMessage` 提示词字符串；统一从 `@/common/prompts` 引入。
- `knowledge-content` 模块目录保持 `controllers / dto / entities / services / types / knowledge-content.module.ts` 结构，不要再回到平铺写法。
- 网关改动优先保证打断语义：`interrupt -> LLM 停止 -> 播报停止 -> 状态回收`。
- 检索链路默认 fail-open：外部依赖失败不阻断对话主流程。
- 会话结构字段变更时，同步更新：
  - `src/realtime-session/realtime-session.interface.ts`
  - `src/gateway/conversation.gateway.ts`
  - 前端 `useAppController.ts` 的协议处理

## 7. 当前阶段状态（简）
- 第一/二阶段已落地（语音主链路 + RAG 两阶段 + 引用 + 知识库管理）。
- 第三/四阶段已接入可运行版本：
  - 语音克隆：当前为 mock 训练流程，完成后写入 `persona.voiceId`
  - 数字人：当前为 mock provider，信令链路可跑，真实视频流待接入厂商 SDK
