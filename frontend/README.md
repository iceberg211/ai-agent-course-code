# Digital Human Agent 前端

本目录是 Digital Human Agent 的前端子项目。仓库整体结构、后端与基础设施启动方式见[项目根 README](../README.md)。

技术栈：`Vue 3 + Vite + TypeScript + Pinia + Vue Router + Tailwind CSS`。

## 主要页面

- 登录、用户资料和权限管理
- 知识库、文档、版本和任务管理
- 智能搜索、文本问答和引用查看
- 数字人、语音和 WebSocket 实时交互
- RAG 评测、健康状态和知识图谱查看

## 本地开发

```bash
pnpm install
pnpm dev
```

开发服务器默认运行在 `http://localhost:5173`：

- `/api` 请求代理到 `http://localhost:3001`
- `/ws` 请求代理到 `ws://localhost:3001`

因此启动前端前，应先启动后端 HTTP/WebSocket 服务。

## 检查与构建

```bash
pnpm typecheck
pnpm build
pnpm preview
```

当前前端没有配置自动化测试框架，因此 `package.json` 不提供空的测试命令。
