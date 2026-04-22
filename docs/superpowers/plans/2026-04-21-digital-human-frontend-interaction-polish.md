# 数字人前端交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧数字人前端的首次使用、知识库验证、数字人准备与消息阅读体验，让主链路更清晰。

**Architecture:** 保持现有 Vue 组件结构不变，优先在问答页补充状态型 UI，并把知识范围提示、空状态引导和滚动反馈集中到聊天主链路中。只做局部组件增强，不改后端协议和数据结构。

**Tech Stack:** Vue 3、TypeScript、Vite、Pinia、Vue Router、Lucide Vue

---

### Task 1: 问答主链路状态收口

**Files:**
- Modify: `digital-human-agent-frontend/src/views/ChatView.vue`
- Modify: `digital-human-agent-frontend/src/components/chat/ChatHeader.vue`
- Create: `digital-human-agent-frontend/src/components/chat/ChatEmptyState.vue`

- [ ] 为问答页补充统一的空状态视图模型，覆盖“未选角色”“未挂载知识库”“待验证知识库未挂载”“已就绪待提问”四种情况。
- [ ] 在头部下方增加知识范围提示区，明确当前回答基于哪个知识库，以及下一步该做什么。
- [ ] 调整头部按钮优先级，让“知识范围/挂载知识库”成为更显眼的动作。

### Task 2: 消息区阅读反馈优化

**Files:**
- Modify: `digital-human-agent-frontend/src/components/chat/MessageList.vue`

- [ ] 调整自动滚动逻辑，仅在用户接近底部时跟随新消息。
- [ ] 当用户停留在历史消息区时，展示“回到最新”操作。

### Task 3: 知识库验证与数字人准备提示强化

**Files:**
- Modify: `digital-human-agent-frontend/src/components/knowledge-base/MountedKnowledgeBaseDrawer.vue`
- Modify: `digital-human-agent-frontend/src/components/chat/DigitalHumanWorkspace.vue`

- [ ] 在知识库挂载抽屉顶部增加“本次验证”提示，区分“已挂载验证”和“待挂载验证”。
- [ ] 在数字人占位区加入更直接的准备动作与阶段说明，减少大面积空等感。

### Task 4: 交互语义与验证

**Files:**
- Modify: `digital-human-agent-frontend/src/components/knowledge-base/KnowledgeBaseCard.vue`

- [ ] 把知识库卡片改成真实按钮语义，改善键盘与焦点体验。
- [ ] 运行 `npm run type-check` 和 `npm run build`，确认本次前端修改没有类型或构建回归。
