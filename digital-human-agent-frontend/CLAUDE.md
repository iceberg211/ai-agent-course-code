# 数字人 Agent 前端

Vue 3 + Vite 前端，与后端（NestJS 端口 3001）完全分离，开发时运行在端口 5173。

---

## 目录结构

```
frontend/
├── public/
│   └── favicon.ico
├── src/
│   ├── main.js                    # 应用入口
│   ├── App.vue                    # 根组件（三栏布局 shell，只做布局）
│   ├── style.css                  # 全局样式 + CSS 变量设计系统
│   │
│   ├── components/                # UI 组件（按功能域分目录）
│   │   ├── persona/
│   │   │   ├── PersonaPanel.vue   # 左侧角色面板（整体）
│   │   │   ├── PersonaItem.vue    # 单个角色列表项
│   │   │   └── ConnectionStatus.vue # 底部连接状态指示器
│   │   │
│   │   ├── chat/
│   │   │   ├── ChatHeader.vue     # 对话区顶栏（当前角色 + 知识库按钮）
│   │   │   ├── MessageList.vue    # 消息滚动容器（处理空态）
│   │   │   ├── MessageItem.vue    # 单条消息（user / assistant 两种形态）
│   │   │   ├── TypingIndicator.vue # AI 打字三点动画
│   │   │   ├── CitationChips.vue  # 引用来源 chip 列表
│   │   │   └── ChatControls.vue   # 底部控制栏（状态点 + 麦克风按钮 + 提示）
│   │   │
│   │   ├── knowledge/
│   │   │   ├── DocsDrawer.vue     # 右侧知识库抽屉（整体）
│   │   │   ├── UploadZone.vue     # 拖拽 / 点击上传区域
│   │   │   └── DocItem.vue        # 单条文档行（状态 + 删除）
│   │   │
│   │   └── common/
│   │       ├── IconButton.vue     # 统一图标按钮（带 aria-label）
│   │       └── ToastAlert.vue     # 全局 Toast 通知
│   │
│   ├── hooks/               # 可复用逻辑
│   │   ├── useWebSocket.js        # WS 连接 + 事件总线
│   │   ├── useAudio.js            # MediaRecorder 录音 + MediaSource TTS 播放
│   │   ├── useConversation.js     # 对话状态机（5 状态）+ 消息列表管理
│   │   └── useKnowledge.js        # 知识库 CRUD（文档上传、列表、删除）
│   │
│   └── stores/                    # Pinia 全局状态（跨组件共享）
│       ├── persona.js             # 角色列表 + 当前选中角色
│       └── session.js             # sessionId、conversationId、连接状态
│
├── vite.config.js                 # proxy: /api → 3001, /ws → 3001
├── CLAUDE.md                      # 本文件
└── package.json
```

---

## 组件职责说明

### App.vue
只负责三栏布局 shell + 全局 Toast。不写业务逻辑。

```
PersonaPanel | ChatHeader + MessageList + ChatControls | DocsDrawer（可切换）
```

### persona/PersonaPanel.vue
- 展示角色列表（`PersonaItem` × n）
- 底部 `ConnectionStatus`
- 不处理选择逻辑——事件向上 emit，由 App.vue / store 处理

### persona/PersonaItem.vue
Props: `persona`, `active`
Emits: `select`

### chat/MessageList.vue
Props: `messages`
- 空态展示
- 自动滚动到底部（watch messages）
- 遍历渲染 `MessageItem`

### chat/MessageItem.vue
Props: `message` (`{ id, role, content, citations, streaming }`)
- role=user：右对齐气泡
- role=assistant：左对齐气泡 + 左紫边 + `TypingIndicator`（streaming && !content）
- 底部渲染 `CitationChips`

### chat/ChatControls.vue
Props: `state`, `disabled`
Emits: `mic-down`, `mic-up`
- 麦克风按钮（56×56px，5 种状态样式）
- 左侧状态点 + 文字，右侧操作提示

### knowledge/DocsDrawer.vue
Props: `personaId`, `open`
Emits: `close`
- 内嵌 `UploadZone` + `DocItem` 列表
- 使用 `useKnowledge` composable

### common/IconButton.vue
Props: `icon`（Lucide 组件）, `label`, `active`, `variant`
统一封装所有图标按钮，保证 aria-label 不遗漏。

---

## 状态管理策略

**本地状态**（`ref` in composable）：
- 录音状态、TTS 播放状态 → `useAudio`
- 对话状态机（idle/recording/thinking/speaking）→ `useConversation`
- 文档列表 → `useKnowledge`

**全局状态**（Pinia store）：
- 角色列表 + 当前 personaId → `persona.js`
- WebSocket sessionId + 连接状态 → `session.js`

**原则**：只有需要跨组件层级共享、或在多个无父子关系的组件中使用的数据才进 store。

---

## 设计系统（UI UX Pro Max · AI/Chatbot Platform 规范）

**样式**：AI-Native UI + Minimalism
**字体**：Plus Jakarta Sans（Google Fonts）

### CSS 变量

```css
--primary:        #7C3AED;   /* AI 紫，主按钮、active 边框 */
--primary-light:  #A78BFA;   /* 浅紫，打字指示器 */
--primary-bg:     #FAF5FF;   /* 极淡紫，页面背景、侧边栏 */
--primary-muted:  #DDD6FE;   /* 淡紫，chip 边框、hover */
--accent:         #0891B2;   /* 青蓝，次级交互 */
--surface:        #FFFFFF;   /* 对话区背景 */
--ai-bubble:      #F9FAFB;   /* AI 气泡背景 */
--user-bubble:    #7C3AED;   /* 用户气泡背景 */
--border:         #E5E7EB;
--border-muted:   #EDE9FE;
--text:           #0F172A;   /* 对比度 15.3:1 ✓ */
--text-secondary: #64748B;   /* 对比度 5.9:1 ✓ */
--text-muted:     #94A3B8;
--success:        #059669;
--warning:        #D97706;
--error:          #DC2626;
```

### 关键规范（来自 UI UX Pro Max skill）

| 规范 | 实现 |
|---|---|
| 最小触摸目标 44×44px | 麦克风按钮 56px，图标按钮 34px（内容区非主操作） |
| 禁止 emoji 当图标 | 全部使用 `lucide-vue-next` SVG 图标 |
| 颜色对比度 4.5:1 | 所有文字/背景组合已通过 WCAG AA 验证 |
| 动画时长 150-300ms | 进入 200ms ease-out，退出 180ms ease-in |
| 只用 transform/opacity 做动画 | 不动 width/height/top/left |
| AI 气泡用 context card 风格 | `border-left: 3px solid var(--primary)` |
| 打字指示器 | 3个点，8×8px，`dot-bounce` 弹跳动画，间隔 180ms |
| Focus ring | 全局 `*:focus-visible { outline: 2px solid var(--primary) }` |
| prefers-reduced-motion | 全局 media query 禁用动画 |
| aria-label | 每个图标按钮、麦克风按钮、消息区均有 aria-label |

### 气泡设计

```
用户消息：右对齐，#7C3AED 底，白字，border-bottom-right-radius: 4px
AI 消息：左对齐，#F9FAFB 底，深字，border-left: 3px solid #7C3AED，border-bottom-left-radius: 4px
```

---

## 麦克风状态机

```
idle ──(按下)──► recording ──(松开)──► thinking
  ▲                  ▲                    │
  │                  │                    ▼
  └──(tts:end)── speaking ◄──(tts:start)──┘
                  │ ▲
           (按下打断)
```

| 状态 | 按钮颜色 | 动画 | 图标 |
|---|---|---|---|
| idle | `#7C3AED` 紫 + 紫色光晕 | 静止 | MicIcon |
| recording | `#DC2626` 红 | pulse-ring | StopCircleIcon |
| thinking | `#D97706` 橙 | breathe | PauseIcon |
| speaking | `#059669` 绿 | glow-green | PauseIcon |

---

## 开发运行

```bash
# 后端（另开终端）
cd digital-human-agent && npm run start:dev   # 端口 3001

# 前端
cd digital-human-agent/frontend && npm run dev  # 端口 5173
```

访问 http://localhost:5173

---

## 约定

- 组件命名：PascalCase，文件名与组件名一致
- Composable 命名：`use` 前缀，camelCase
- 图标全部从 `lucide-vue-next` 导入，不使用 emoji 作为功能图标
- CSS 只写 scoped（组件内）+ 全局变量（style.css），不写全局类名
- 不引入 UI 组件库（Element Plus / Vuetify），保持轻量
- `v-for` 必须有 `:key`，key 用稳定 ID 不用 index
