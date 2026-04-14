# Browser Sandbox / Cloud Computer — Design Spec

**Date:** 2026-04-14  
**Status:** Approved  
**Scope:** Mini-Manus — 浏览器沙箱云电脑完整链路（技术方案文档 §7.3 路线 B 第一版）

---

## 1. 目标

让 Agent 能在隔离的 Docker 容器内操控真实浏览器（Computer Use 范式）：

- 前端实时看到 Agent 正在浏览的画面（noVNC 嵌入 Run 详情页）
- Agent 通过 `computer_action` 工具截图、点击、输入文字
- 容器随 Run 按需创建，Run 结束自动销毁

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Container (per Run)                                     │
│                                                                 │
│  Xvfb :1 (1280×720x24)                                         │
│       ↓ 虚拟显示器                                              │
│  Chromium ──── CDP :9222  ←─── Playwright (NestJS)             │
│       ↓ 渲染到 Xvfb                                             │
│  x11vnc ─── VNC :5900                                          │
│       ↓                                                         │
│  websockify :6080  ←── WS proxy ←── NestJS HTTP upgrade        │
└─────────────────────────────────────────────────────────────────┘
                                            ↑                ↑
                                     鉴权+代理        CDP 截图/点击
                                            ↑
                                    前端 noVNC 组件
                                    (Run 详情页右侧栏)
```

---

## 3. Docker 镜像

**路径：** `mini-manus/docker/browser-sandbox/`

### Dockerfile

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    chromium-browser \
    python3-websockify \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m sandbox
USER sandbox

COPY --chown=sandbox entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6080 9222

ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh

```bash
#!/bin/bash
set -e

Xvfb :1 -screen 0 1280x720x24 &
x11vnc -display :1 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -quiet &
websockify 0.0.0.0:6080 localhost:5900 &

exec DISPLAY=:1 chromium-browser \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --force-device-scale-factor=1 \
  about:blank
```

### 安全约束

- 非 root 用户（`--user sandbox`）
- `--shm-size=1g`（防 Chromium /dev/shm 崩溃）
- 不挂载宿主机目录，不挂载 Docker socket
- 容器超时（默认 10min）后强制 `docker kill`

---

## 4. 后端服务

### 4.1 VncContainerService

**文件：** `backend/src/browser/vnc-container.service.ts`

使用 `dockerode`（已安装）管理容器生命周期。

```typescript
interface ContainerRecord {
  containerId: string;
  runId: string;
  vncPort: number;   // 宿主机映射的 websockify 端口
  cdpPort: number;   // 宿主机映射的 Chrome CDP 端口
  startedAt: Date;
}

class VncContainerService {
  startContainer(runId: string): Promise<ContainerRecord>
  stopContainer(runId: string): Promise<void>
  getContainer(runId: string): ContainerRecord | undefined
  stopAll(): Promise<void>  // OnModuleDestroy
}
```

**启动流程：**
1. `docker.createContainer()` with port bindings (随机宿主机端口) + `--shm-size=1g`
2. `container.start()`
3. 轮询 `http://localhost:{cdpPort}/json/version`，最多 10s，500ms 间隔
4. 就绪后存入 Map，发出 `browser_session.started` 事件

**停止流程：**
1. `container.stop()` → `container.remove()`
2. 从 Map 删除
3. 发出 `browser_session.ended` 事件

**监听容器异常退出：**
```typescript
dockerode.getEvents({ filters: { type: ['container'], event: ['die'] } })
// 自动清理对应 runId 的记录
```

### 4.2 VNC WebSocket 代理

**文件：** `backend/src/browser/vnc-proxy.ts`

在 `main.ts` 的 NestJS HTTP server 上挂载 `upgrade` 事件处理器。

**路由匹配：** `GET /api/vnc/:runId` + `Upgrade: websocket`

**代理逻辑：**
```typescript
server.on('upgrade', (req, socket, head) => {
  const runId = extractRunId(req.url); // /api/vnc/:runId
  const container = vncContainerService.getContainer(runId);
  if (!container) { socket.destroy(); return; }

  // 校验 runId 合法（属于存活容器）
  // TCP 级双向 pipe（不解析 WebSocket 帧）
  const target = net.createConnection(container.vncPort, 'localhost');
  target.write(head);
  socket.pipe(target).pipe(socket);
  socket.on('error', () => target.destroy());
  target.on('error', () => socket.destroy());
});
```

鉴权：直接用 runId 查 VncContainerService Map，存在即合法（容器和 Run 同生命周期）。

### 4.3 computer_action Tool

**文件：** `backend/src/tool/tools/browser/computer-action.tool.ts`

```typescript
// Zod 输入 schema
{
  action: z.enum(['screenshot', 'click', 'type']),
  run_id: z.string(),          // 对应容器的 runId
  x: z.number().optional(),    // click
  y: z.number().optional(),    // click
  text: z.string().optional()  // type
}

// 输出：每次操作后都附带截图（让 LLM 看到操作结果）
{
  action: string,
  url: string,
  title: string,
  screenshot_base64: string,  // PNG base64
  width: number,
  height: number
}
```

**实现路径：**
- `screenshot` → `page.screenshot({ type: 'png' })` → base64
- `click` → `page.mouse.click(x, y)` → 等待 500ms → screenshot
- `type` → `page.keyboard.type(text)` → screenshot

**触发容器启动：** tool 调用时如果该 runId 容器不存在，自动调 `VncContainerService.startContainer(runId)`（懒启动）。

### 4.4 BrowserSessionService 扩展

新增方法：
```typescript
openViaCdp(cdpPort: number, runId: string): Promise<BrowserOpenResult>
```
内部使用 `chromium.connectOverCDP(`http://localhost:${cdpPort}`)` 替代本地 launch。

---

## 5. 前端

### 5.1 依赖

```bash
pnpm add @novnc/novnc
```

### 5.2 VncPanel 组件

**文件：** `frontend/src/domains/task/components/VncPanel.tsx`

```
┌────────────────────────────────────────┐
│  🌐 AI 正在浏览                [收起]  │
├────────────────────────────────────────┤
│                                        │
│   [noVNC RFB canvas — 等比缩放]        │
│                                        │
│   当前页面：https://...                │
└────────────────────────────────────────┘
```

- 挂载时 `new RFB(canvas, ws://host/api/vnc/{runId})`
- 卸载时 `rfb.disconnect()`
- canvas 宽度 = 容器宽度，高度按 16:9 (1280×720) 等比计算
- 状态：`connecting` | `connected` | `disconnected`

### 5.3 socket.io 事件

| 事件 | 载荷 | 前端行为 |
|------|------|---------|
| `browser_session.started` | `{ runId }` | 显示 VncPanel，连接 `/api/vnc/{runId}` |
| `browser_session.ended` | `{ runId }` | 断开 RFB，隐藏 VncPanel |

### 5.4 Run 详情页布局

```
有浏览器 session 时：
┌──────────────────┬──────────────────┐
│  步骤列表 (左)    │  VncPanel (右)   │
└──────────────────┴──────────────────┘

无浏览器 session 时：
┌────────────────────────────────────┐
│  步骤列表（全宽，现有布局）          │
└────────────────────────────────────┘
```

---

## 6. 数据流（一次完整 Run）

1. Agent 调用 `computer_action` → `VncContainerService.startContainer(runId)`（懒启动）
2. 容器内 Xvfb → Chromium → x11vnc → websockify 顺序启动
3. 后端轮询 CDP 就绪 → `BrowserSessionService.openViaCdp(cdpPort, runId)`
4. 后端发出 `browser_session.started { runId }` via socket.io
5. 前端 VncPanel 显示，连接 `WS /api/vnc/{runId}` → HTTP upgrade → TCP pipe → websockify
6. Agent 调用 `screenshot` → `page.screenshot()` → base64 → LLM 看到画面
7. Agent 调用 `click(x, y)` → `page.mouse.click(x, y)` → VNC 画面同步更新
8. Run 结束 → `VncContainerService.stopContainer(runId)` → 容器销毁
9. 后端发出 `browser_session.ended` → 前端 VncPanel 收起

---

## 7. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VNC_SANDBOX_ENABLED` | `false` | 显式开启浏览器沙箱 |
| `VNC_SANDBOX_IMAGE` | `mini-manus-browser-sandbox` | Docker 镜像名 |
| `VNC_SANDBOX_TIMEOUT_MS` | `600000` | 容器最大存活时间（10min）|
| `VNC_SANDBOX_SHM_SIZE` | `1g` | 容器 /dev/shm 大小 |

---

## 8. 不在本版本范围内

- 人工接管（HITL 鼠标点击前端画面操控容器）
- 持久化登录态（Cookie/Session 跨 Run 保留）
- 容器池化/预热
- `scroll`、键盘快捷键等扩展交互原语
- `browser_sessions` 数据库表（本版本进程内 Map 管理）
