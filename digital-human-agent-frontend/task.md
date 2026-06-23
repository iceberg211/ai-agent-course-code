# 任务进度表

- `[x]` 后端服务缺陷修复与时序优化
  - `[x]` 调整文档物理删除时序（先清理外部 ES 索引和图谱，后物理删除主记录）
  - `[x]` 优化重试与状态流转记录
- `[x]` 前端路由与导航条补齐
  - `[x]` 在 `router/index.ts` 中注册 `/dashboard`、`/documents`、`/search`、`/profile` 路由
- `[x]` 前端新页面视图开发
  - `[x]` 新增 `/dashboard` 首页大盘页，展示已有统计数据及最近记录
  - `[x]` 新增 `/documents` 跨知识库文档管理页，支持搜索、多维筛选、操作面板和错态重传
  - `[x]` 新增 `/search` 智能搜索页，支持文本命中、ES 召回高亮渲染、跳转对话发起
  - `[x]` 新增 `/profile` 个人中心展示与重置模块
- `[x]` AI 问答组件增强与集成
  - `[x]` 在 `ChatView.vue` 挂载 `ConversationHistoryPanel.vue` 实现会话历史闭环
  - `[x]` 在 `MessageItem.vue` 中集入复制、有用/无用点踩反馈（持久化）及重新生成
  - `[x]` 升级引用气泡 `CitationChips.vue` 点击行为冒泡
  - `[x]` 开发独立的引用详情侧边抽屉 `CitationDetailDrawer.vue` 并集成到 `ChatView.vue`
- `[x]` 验证与构建
  - `[x]` 前端 `npm run build` 打包校验
