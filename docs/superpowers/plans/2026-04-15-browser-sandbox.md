# Browser Sandbox / Cloud Computer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Docker 容器内运行 Xvfb + Chromium + VNC，让前端通过 noVNC 实时看到 AI 正在浏览的画面，并提供 `computer_action` 工具使 Agent 能截图、点击、输入文字。

**Architecture:** `VncContainerService` 用 dockerode 按需拉起/销毁带有 Xvfb + x11vnc + websockify + Chromium 的 Docker 容器；`VncProxyService` 挂到 NestJS HTTP server 的 `upgrade` 事件，将 `/api/vnc/:runId` 的 WebSocket 连接 TCP pipe 到容器内 websockify；`ComputerActionService` 通过 Playwright CDP 连接容器内 Chromium，执行截图/点击/输入；前端 `VncPanel` 组件用 `@novnc/novnc` 渲染实时画面，嵌入 Run 详情区右侧。

**Tech Stack:** dockerode（已安装）、playwright（已安装）、@novnc/novnc（需安装）、Node.js `net` / `http` 模块、EventEmitter2、socket.io

---

## File Map

### 新建文件

| 文件 | 职责 |
|------|------|
| `mini-manus/docker/browser-sandbox/Dockerfile` | 自定义镜像：Ubuntu + Xvfb + Chromium + x11vnc + websockify |
| `mini-manus/docker/browser-sandbox/entrypoint.sh` | 容器启动脚本，按顺序启动各进程 |
| `backend/src/browser/vnc-container.service.ts` | Docker 容器生命周期管理 |
| `backend/src/browser/vnc-container.service.spec.ts` | 单元测试 |
| `backend/src/browser/computer-action.service.ts` | Playwright CDP 连接管理（runId → Page） |
| `backend/src/browser/computer-action.service.spec.ts` | 单元测试 |
| `backend/src/browser/vnc-proxy.service.ts` | HTTP upgrade WebSocket 代理 |
| `backend/src/tool/tools/browser/computer-action.tool.ts` | computer_action tool |
| `backend/src/tool/tools/browser/computer-action.tool.spec.ts` | 单元测试 |
| `frontend/src/domains/task/components/VncPanel.tsx` | noVNC 实时画面组件 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/src/browser/browser.module.ts` | 添加 Vnc 三服务 + 导出 |
| `backend/src/common/events/task.events.ts` | 添加 `BROWSER_SESSION_STARTED / ENDED` |
| `backend/src/gateway/agent.gateway.ts` | 添加两个 `@OnEvent` 转发 |
| `backend/src/tool/tool.module.ts` | 注册 ComputerActionTool |
| `backend/src/main.ts` | 注册 VNC HTTP upgrade handler |
| `frontend/src/core/socket/task-events.ts` | 添加 browser session 事件 |
| `frontend/src/domains/task/hooks/use-task-socket-sync.ts` | 处理 browser session 事件，暴露 `vncRunId` |
| `frontend/src/pages/task-center/index.tsx` | 集成 VncPanel |

---

## Task 1: Dockerfile + entrypoint.sh

**Files:**
- Create: `mini-manus/docker/browser-sandbox/Dockerfile`
- Create: `mini-manus/docker/browser-sandbox/entrypoint.sh`

- [ ] **Step 1: 创建 Dockerfile**

```dockerfile
# mini-manus/docker/browser-sandbox/Dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    chromium-browser \
    python3-websockify \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 sandbox

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER sandbox

EXPOSE 6080 9222

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: 创建 entrypoint.sh**

```bash
#!/bin/bash
# mini-manus/docker/browser-sandbox/entrypoint.sh
set -e

# 1. 启动虚拟显示器
Xvfb :1 -screen 0 1280x720x24 &

# 2. 等待 Xvfb 就绪（最多 5s）
for i in $(seq 1 10); do
  DISPLAY=:1 xdpyinfo >/dev/null 2>&1 && break
  sleep 0.5
done

# 3. 启动 VNC 服务（监听所有接口，无密码）
x11vnc -display :1 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -quiet &

# 4. 启动 websockify（VNC → WebSocket）
websockify 0.0.0.0:6080 localhost:5900 &

# 5. 启动 Chromium（前台进程）
exec DISPLAY=:1 chromium-browser \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --force-device-scale-factor=1 \
  --window-size=1280,720 \
  about:blank
```

- [ ] **Step 3: 构建镜像并验证**

```bash
cd mini-manus/docker/browser-sandbox
docker build -t mini-manus-browser-sandbox .
```

期望输出：`Successfully built ...`（无报错）

- [ ] **Step 4: 冒烟测试：容器能启动且 CDP 就绪**

```bash
docker run --rm -d \
  --shm-size=1g \
  -p 16080:6080 \
  -p 19222:9222 \
  --name sandbox-test \
  mini-manus-browser-sandbox

# 等待 5s 让 Chromium 启动
sleep 5

# 检查 CDP 是否就绪
curl -s http://localhost:19222/json/version | python3 -m json.tool

# 清理
docker stop sandbox-test
```

期望输出：包含 `"Browser": "Chromium ..."`

- [ ] **Step 5: 提交**

```bash
git add mini-manus/docker/browser-sandbox/
git commit -m "feat: add browser sandbox Dockerfile with Xvfb + Chromium + VNC"
```

---

## Task 2: VncContainerService

**Files:**
- Create: `backend/src/browser/vnc-container.service.ts`
- Create: `backend/src/browser/vnc-container.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// backend/src/browser/vnc-container.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VncContainerService } from './vnc-container.service';

describe('VncContainerService', () => {
  let service: VncContainerService;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    eventEmitter = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VncContainerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
          },
        },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();
    service = module.get(VncContainerService);
  });

  describe('getContainer', () => {
    it('returns undefined when no container is running for the runId', () => {
      expect(service.getContainer('nonexistent-run-id')).toBeUndefined();
    });
  });

  describe('stopContainer', () => {
    it('resolves without error when no container exists for runId', async () => {
      await expect(service.stopContainer('nonexistent-run-id')).resolves.toBeUndefined();
    });
  });

  describe('stopAll', () => {
    it('resolves without error when no containers are running', async () => {
      await expect(service.stopAll()).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd mini-manus/backend
pnpm test -- --testPathPattern=vnc-container
```

期望：`FAIL` — `Cannot find module './vnc-container.service'`

- [ ] **Step 3: 实现 VncContainerService**

```typescript
// backend/src/browser/vnc-container.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import Dockerode from 'dockerode';
import * as http from 'node:http';
import { TASK_EVENTS } from '@/common/events/task.events';

export interface ContainerRecord {
  containerId: string;
  runId: string;
  taskId: string;
  vncPort: number;
  cdpPort: number;
  startedAt: Date;
}

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

@Injectable()
export class VncContainerService implements OnModuleDestroy {
  private readonly logger = new Logger(VncContainerService.name);
  private readonly docker: Dockerode;
  private readonly enabled: boolean;
  private readonly imageName: string;
  private readonly containerTimeoutMs: number;
  private readonly shmSize: number;
  private readonly containers = new Map<string, ContainerRecord>();
  private readonly startLocks = new Map<string, Promise<ContainerRecord>>();

  constructor(
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.enabled = readBoolean(config.get('VNC_SANDBOX_ENABLED'), false);
    this.imageName = config.get('VNC_SANDBOX_IMAGE', 'mini-manus-browser-sandbox');
    this.containerTimeoutMs = Number(config.get('VNC_SANDBOX_TIMEOUT_MS', 600_000));
    this.shmSize = 1024 * 1024 * 1024; // 1GB
    this.docker = new Dockerode({
      socketPath: config.get('DOCKER_SOCKET_PATH', '/var/run/docker.sock'),
    });
  }

  /** Idempotent: returns existing record or starts a new container */
  async ensureRunning(runId: string, taskId: string): Promise<ContainerRecord> {
    if (!this.enabled) {
      throw new Error('VNC_SANDBOX_ENABLED=false — 浏览器沙箱未启用');
    }

    const existing = this.containers.get(runId);
    if (existing) return existing;

    // Deduplicate concurrent calls for the same runId
    const inFlight = this.startLocks.get(runId);
    if (inFlight) return inFlight;

    const promise = this.doStartContainer(runId, taskId).finally(() => {
      this.startLocks.delete(runId);
    });
    this.startLocks.set(runId, promise);
    return promise;
  }

  getContainer(runId: string): ContainerRecord | undefined {
    return this.containers.get(runId);
  }

  async stopContainer(runId: string): Promise<void> {
    const record = this.containers.get(runId);
    if (!record) return;
    this.containers.delete(runId);
    try {
      const container = this.docker.getContainer(record.containerId);
      await container.stop({ t: 5 }).catch(() => undefined);
      await container.remove({ force: true }).catch(() => undefined);
      this.logger.log(`容器已停止: runId=${runId}`);
    } catch (err) {
      this.logger.warn(`停止容器失败 runId=${runId}: ${String(err)}`);
    }
    this.eventEmitter.emit(TASK_EVENTS.BROWSER_SESSION_ENDED, {
      runId,
      taskId: record.taskId,
    });
  }

  async stopAll(): Promise<void> {
    const runIds = Array.from(this.containers.keys());
    await Promise.all(runIds.map((runId) => this.stopContainer(runId)));
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopAll();
  }

  @OnEvent(TASK_EVENTS.RUN_COMPLETED)
  @OnEvent(TASK_EVENTS.RUN_FAILED)
  @OnEvent(TASK_EVENTS.RUN_CANCELLED)
  async onRunTerminal(payload: { runId?: string }): Promise<void> {
    if (payload.runId) {
      await this.stopContainer(payload.runId).catch((err: unknown) => {
        this.logger.warn(`自动清理容器失败: ${String(err)}`);
      });
    }
  }

  private async doStartContainer(runId: string, taskId: string): Promise<ContainerRecord> {
    this.logger.log(`启动浏览器沙箱容器: runId=${runId}`);

    const container = await this.docker.createContainer({
      Image: this.imageName,
      HostConfig: {
        ShmSize: this.shmSize,
        AutoRemove: false,
        PortBindings: {
          '6080/tcp': [{ HostPort: '0' }],
          '9222/tcp': [{ HostPort: '0' }],
        },
      },
    });

    await container.start();

    const info = await container.inspect();
    const vncPort = parseInt(
      info.NetworkSettings.Ports['6080/tcp'][0].HostPort,
      10,
    );
    const cdpPort = parseInt(
      info.NetworkSettings.Ports['9222/tcp'][0].HostPort,
      10,
    );

    await this.waitForCdpReady(cdpPort, 15_000);

    const record: ContainerRecord = {
      containerId: container.id,
      runId,
      taskId,
      vncPort,
      cdpPort,
      startedAt: new Date(),
    };
    this.containers.set(runId, record);

    // Auto-kill after timeout
    setTimeout(() => {
      if (this.containers.has(runId)) {
        this.logger.warn(`容器超时自动销毁: runId=${runId}`);
        void this.stopContainer(runId);
      }
    }, this.containerTimeoutMs).unref();

    this.eventEmitter.emit(TASK_EVENTS.BROWSER_SESSION_STARTED, { runId, taskId });
    this.logger.log(`浏览器沙箱就绪: runId=${runId} vncPort=${vncPort} cdpPort=${cdpPort}`);

    return record;
  }

  private waitForCdpReady(cdpPort: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const attempt = () => {
        const req = http.get(
          `http://localhost:${cdpPort}/json/version`,
          (res) => {
            if (res.statusCode === 200) return resolve();
            res.resume();
            schedule();
          },
        );
        req.on('error', schedule);
        req.setTimeout(1_000, () => {
          req.destroy();
          schedule();
        });
      };
      const schedule = () => {
        if (Date.now() >= deadline) {
          return reject(
            new Error(`vnc_container_timeout: CDP not ready after ${timeoutMs}ms`),
          );
        }
        setTimeout(attempt, 500);
      };
      attempt();
    });
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm test -- --testPathPattern=vnc-container
```

期望：`PASS` — 3 tests passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/browser/vnc-container.service.ts \
        backend/src/browser/vnc-container.service.spec.ts
git commit -m "feat(browser): add VncContainerService for Docker container lifecycle"
```

---

## Task 3: ComputerActionService

**Files:**
- Create: `backend/src/browser/computer-action.service.ts`
- Create: `backend/src/browser/computer-action.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// backend/src/browser/computer-action.service.spec.ts
import { Test } from '@nestjs/testing';
import { ComputerActionService } from './computer-action.service';

describe('ComputerActionService', () => {
  let service: ComputerActionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ComputerActionService],
    }).compile();
    service = module.get(ComputerActionService);
  });

  describe('getPage', () => {
    it('returns undefined when no CDP connection exists for runId', () => {
      expect(service.getPage('unknown-run')).toBeUndefined();
    });
  });

  describe('closeRun', () => {
    it('resolves without error when no connection exists', async () => {
      await expect(service.closeRun('unknown-run')).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm test -- --testPathPattern=computer-action.service
```

期望：`FAIL` — Cannot find module

- [ ] **Step 3: 实现 ComputerActionService**

```typescript
// backend/src/browser/computer-action.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser, type Page } from 'playwright';

interface CdpConnection {
  browser: Browser;
  page: Page;
}

@Injectable()
export class ComputerActionService implements OnModuleDestroy {
  private readonly logger = new Logger(ComputerActionService.name);
  private readonly connections = new Map<string, CdpConnection>();

  /** Returns existing Page for runId, or undefined if not connected */
  getPage(runId: string): Page | undefined {
    return this.connections.get(runId)?.page;
  }

  /** Connect to containerized Chromium via CDP and return the active Page */
  async getOrConnect(cdpPort: number, runId: string): Promise<Page> {
    const existing = this.connections.get(runId);
    if (existing) return existing.page;

    const browser = await chromium.connectOverCDP(
      `http://localhost:${cdpPort}`,
    );

    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());

    this.connections.set(runId, { browser, page });

    browser.on('disconnected', () => {
      this.connections.delete(runId);
      this.logger.warn(`CDP 连接断开: runId=${runId}`);
    });

    this.logger.log(`CDP 连接已建立: runId=${runId} port=${cdpPort}`);
    return page;
  }

  async closeRun(runId: string): Promise<void> {
    const conn = this.connections.get(runId);
    if (!conn) return;
    this.connections.delete(runId);
    await conn.browser.close().catch((err: unknown) => {
      this.logger.warn(`关闭 CDP 连接失败: ${String(err)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    const runIds = Array.from(this.connections.keys());
    await Promise.all(runIds.map((runId) => this.closeRun(runId)));
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm test -- --testPathPattern=computer-action.service
```

期望：`PASS` — 2 tests passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/browser/computer-action.service.ts \
        backend/src/browser/computer-action.service.spec.ts
git commit -m "feat(browser): add ComputerActionService for Playwright CDP connections"
```

---

## Task 4: VncProxyService

**Files:**
- Create: `backend/src/browser/vnc-proxy.service.ts`

- [ ] **Step 1: 创建 VncProxyService**

```typescript
// backend/src/browser/vnc-proxy.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';
import * as http from 'node:http';
import { VncContainerService } from '@/browser/vnc-container.service';

@Injectable()
export class VncProxyService {
  private readonly logger = new Logger(VncProxyService.name);

  constructor(private readonly vncContainer: VncContainerService) {}

  /**
   * 挂到 NestJS HTTP server 的 upgrade 事件。
   * 路由：GET /api/vnc/:runId，Upgrade: websocket
   * 鉴权：runId 必须对应一个已启动的容器。
   */
  registerUpgradeHandler(server: http.Server): void {
    server.on(
      'upgrade',
      (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
        const match = req.url?.match(/^\/api\/vnc\/([^/?]+)/);
        if (!match) return; // 不是 VNC 路由，忽略（让 socket.io 处理）

        const runId = decodeURIComponent(match[1]);
        const record = this.vncContainer.getContainer(runId);

        if (!record) {
          this.logger.warn(`VNC proxy: 未找到容器 runId=${runId}`);
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        const target = net.createConnection(record.vncPort, 'localhost');

        target.on('connect', () => {
          // 发送原始 WebSocket 握手头（HTTP upgrade 的 head buffer）
          target.write(head);
          // 双向透传
          socket.pipe(target);
          target.pipe(socket);
        });

        target.on('error', (err) => {
          this.logger.warn(`VNC proxy target error runId=${runId}: ${err.message}`);
          socket.destroy();
        });

        socket.on('error', () => {
          target.destroy();
        });

        socket.on('close', () => {
          target.destroy();
        });

        target.on('close', () => {
          socket.destroy();
        });
      },
    );

    this.logger.log('VNC WebSocket proxy 已注册 (/api/vnc/:runId)');
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add backend/src/browser/vnc-proxy.service.ts
git commit -m "feat(browser): add VncProxyService for HTTP upgrade WebSocket proxy"
```

---

## Task 5: 更新 BrowserModule + main.ts

**Files:**
- Modify: `backend/src/browser/browser.module.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: 更新 BrowserModule**

将 `backend/src/browser/browser.module.ts` 替换为：

```typescript
import { Module } from '@nestjs/common';
import { BrowserSessionService } from '@/browser/browser-session.service';
import { VncContainerService } from '@/browser/vnc-container.service';
import { ComputerActionService } from '@/browser/computer-action.service';
import { VncProxyService } from '@/browser/vnc-proxy.service';

@Module({
  providers: [
    BrowserSessionService,
    VncContainerService,
    ComputerActionService,
    VncProxyService,
  ],
  exports: [
    BrowserSessionService,
    VncContainerService,
    ComputerActionService,
    VncProxyService,
  ],
})
export class BrowserModule {}
```

- [ ] **Step 2: 注册 VNC upgrade handler 在 main.ts**

在 `backend/src/main.ts` 的 `app.listen(port)` 调用之后，添加如下代码：

```typescript
// 在现有 import 行末尾添加：
import * as http from 'node:http';
import { VncProxyService } from '@/browser/vnc-proxy.service';
```

在 `await app.listen(port);` 之后，`logger.log(...)` 之前添加：

```typescript
  // ─── VNC WebSocket 代理 ─────────────────────────────────
  const vncProxy = app.get(VncProxyService);
  vncProxy.registerUpgradeHandler(app.getHttpServer() as http.Server);
```

- [ ] **Step 3: 构建验证**

```bash
pnpm build
```

期望：`Successfully compiled` 无错误

- [ ] **Step 4: 提交**

```bash
git add backend/src/browser/browser.module.ts backend/src/main.ts
git commit -m "feat(browser): wire VncContainerService, ComputerActionService, VncProxyService into BrowserModule and main.ts"
```

---

## Task 6: 添加 TASK_EVENTS + AgentGateway 转发

**Files:**
- Modify: `backend/src/common/events/task.events.ts`
- Modify: `backend/src/gateway/agent.gateway.ts`

- [ ] **Step 1: 在 TASK_EVENTS 添加两个新事件**

在 `backend/src/common/events/task.events.ts` 的常量对象末尾（`EVALUATOR_DECIDED` 之后）添加：

```typescript
  BROWSER_SESSION_STARTED: 'browser_session.started',
  BROWSER_SESSION_ENDED: 'browser_session.ended',
```

完整文件结果：

```typescript
export const TASK_EVENTS = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  REVISION_CREATED: 'revision.created',
  RUN_STARTED: 'run.started',
  RUN_COMPLETED: 'run.completed',
  RUN_FAILED: 'run.failed',
  RUN_CANCELLED: 'run.cancelled',
  PLAN_GENERATING: 'plan.generating',
  PLAN_CREATED: 'plan.created',
  STEP_STARTED: 'step.started',
  STEP_PROGRESS: 'step.progress',
  STEP_COMPLETED: 'step.completed',
  STEP_FAILED: 'step.failed',
  TOOL_CALLED: 'tool.called',
  TOOL_COMPLETED: 'tool.completed',
  ARTIFACT_CREATED: 'artifact.created',
  RUN_TOKEN_USAGE: 'run.token_usage',
  RUN_AWAITING_APPROVAL: 'run.awaiting_approval',
  EVALUATOR_DECIDED: 'evaluator.decided',
  BROWSER_SESSION_STARTED: 'browser_session.started',
  BROWSER_SESSION_ENDED: 'browser_session.ended',
} as const;

export type TaskEventName = (typeof TASK_EVENTS)[keyof typeof TASK_EVENTS];
```

- [ ] **Step 2: 在 AgentGateway 添加两个 @OnEvent 转发**

在 `backend/src/gateway/agent.gateway.ts` 末尾（最后一个 `@OnEvent` handler 之后，类的闭合括号之前）添加：

```typescript
  @OnEvent(TASK_EVENTS.BROWSER_SESSION_STARTED)
  onBrowserSessionStarted(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.BROWSER_SESSION_STARTED, payload);
  }

  @OnEvent(TASK_EVENTS.BROWSER_SESSION_ENDED)
  onBrowserSessionEnded(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.BROWSER_SESSION_ENDED, payload);
  }
```

注意：`taskRoom()` 用 `payload['taskId']` 路由，`VncContainerService` 已在 Task 2 中将 `taskId` 加入 `ContainerRecord` 并在 emit 时传入，无需额外修改。

- [ ] **Step 3: 构建验证**

```bash
pnpm build
```

期望：无 TypeScript 错误

- [ ] **Step 4: 提交**

```bash
git add backend/src/common/events/task.events.ts \
        backend/src/gateway/agent.gateway.ts \
        backend/src/browser/vnc-container.service.ts \
        backend/src/browser/vnc-container.service.spec.ts
git commit -m "feat: add browser_session.started/ended events to TASK_EVENTS and AgentGateway"
```

---

## Task 7: computer_action Tool

**Files:**
- Create: `backend/src/tool/tools/browser/computer-action.tool.ts`
- Create: `backend/src/tool/tools/browser/computer-action.tool.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// backend/src/tool/tools/browser/computer-action.tool.spec.ts
import { ComputerActionTool } from './computer-action.tool';
import type { VncContainerService } from '@/browser/vnc-container.service';
import type { ComputerActionService } from '@/browser/computer-action.service';

describe('ComputerActionTool', () => {
  let tool: ComputerActionTool;
  let mockVncContainer: jest.Mocked<Pick<VncContainerService, 'ensureRunning'>>;
  let mockComputerAction: jest.Mocked<Pick<ComputerActionService, 'getOrConnect'>>;

  beforeEach(() => {
    mockVncContainer = { ensureRunning: jest.fn() };
    mockComputerAction = { getOrConnect: jest.fn() };
    tool = new ComputerActionTool(
      mockVncContainer as unknown as VncContainerService,
      mockComputerAction as unknown as ComputerActionService,
    );
  });

  it('returns error result when VNC sandbox is disabled', async () => {
    mockVncContainer.ensureRunning.mockRejectedValue(
      new Error('VNC_SANDBOX_ENABLED=false'),
    );

    const result = await tool.execute({
      run_id: '00000000-0000-0000-0000-000000000001',
      task_id: '00000000-0000-0000-0000-000000000002',
      action: 'screenshot',
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('computer_action 执行失败');
  });

  it('fails validation when click action is missing x/y', async () => {
    const result = await tool.execute({
      run_id: '00000000-0000-0000-0000-000000000001',
      task_id: '00000000-0000-0000-0000-000000000002',
      action: 'click',
      // x and y intentionally omitted
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm test -- --testPathPattern=computer-action.tool
```

期望：`FAIL` — Cannot find module

- [ ] **Step 3: 实现 ComputerActionTool**

```typescript
// backend/src/tool/tools/browser/computer-action.tool.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { VncContainerService } from '@/browser/vnc-container.service';
import { ComputerActionService } from '@/browser/computer-action.service';

const schema = z.object({
  task_id: z.string().uuid(),
  run_id: z.string().uuid(),
  action: z.enum(['screenshot', 'click', 'type']).describe(
    'screenshot: 截图；click: 鼠标左键单击坐标；type: 键盘输入文字',
  ),
  x: z.number().int().min(0).max(1280).optional().describe('click 动作的 X 坐标（像素）'),
  y: z.number().int().min(0).max(720).optional().describe('click 动作的 Y 坐标（像素）'),
  text: z.string().max(1000).optional().describe('type 动作要输入的文字'),
});

@Injectable()
export class ComputerActionTool implements Tool {
  readonly name = 'computer_action';
  readonly description =
    '在浏览器沙箱中执行截图、坐标点击或文字输入。截图保存到 workspace 并返回文件路径。每次操作后均自动截图以记录当前状态。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;
  readonly cacheable = false;

  constructor(
    private readonly vncContainer: VncContainerService,
    private readonly computerAction: ComputerActionService,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = schema.parse(input);
      const { task_id: taskId, run_id: runId, action, x, y, text } = parsed;

      // 1. 确保容器已启动
      const container = await this.vncContainer.ensureRunning(runId, taskId);

      // 2. 获取/建立 CDP 连接
      const page = await this.computerAction.getOrConnect(container.cdpPort, runId);

      // 3. 执行动作
      if (action === 'click') {
        if (x == null || y == null) {
          throw new Error('click 操作需要 x 和 y 坐标');
        }
        await page.mouse.click(x, y);
        await page.waitForTimeout(500);
      } else if (action === 'type') {
        if (!text) {
          throw new Error('type 操作需要 text 参数');
        }
        await page.keyboard.type(text);
        await page.waitForTimeout(300);
      }

      // 4. 截图（记录操作结果）
      const screenshotBuffer = await page.screenshot({ type: 'png' });
      const title = await page.title();
      const url = page.url();

      // 5. 保存截图到 workspace
      const filename = `browser-screenshots/${runId}-${Date.now()}.png`;
      const workspacePath = path.join(
        process.env.WORKSPACE_BASE_PATH ?? '/tmp/workspaces',
        taskId,
        filename,
      );
      await fs.mkdir(path.dirname(workspacePath), { recursive: true });
      await fs.writeFile(workspacePath, screenshotBuffer);

      const output = {
        action,
        url,
        title,
        screenshot_path: filename,
        screenshot_size_bytes: screenshotBuffer.byteLength,
      };

      return {
        success: true,
        output: truncateOutput(JSON.stringify(output, null, 2)),
        metadata: output,
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'computer_action 执行失败');
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm test -- --testPathPattern=computer-action.tool
```

期望：`PASS` — 2 tests passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/tool/tools/browser/computer-action.tool.ts \
        backend/src/tool/tools/browser/computer-action.tool.spec.ts
git commit -m "feat(tool): add computer_action tool for VNC browser interaction"
```

---

## Task 8: 注册 ComputerActionTool

**Files:**
- Modify: `backend/src/tool/tool.module.ts`

- [ ] **Step 1: 在 ToolModule 注册 ComputerActionTool**

在 `backend/src/tool/tool.module.ts` 中：

1. 在 import 列表添加：
```typescript
import { ComputerActionTool } from '@/tool/tools/browser/computer-action.tool';
```

2. 在 `@Module({ providers: [...] })` 列表添加 `ComputerActionTool`

3. 在构造函数参数列表添加：
```typescript
private readonly computerAction: ComputerActionTool,
```

4. 在 `onModuleInit()` 中，在 `BROWSER_AUTOMATION_ENABLED` 分支内添加：
```typescript
      this.registry.register(this.computerAction);
```

完整的 `if (readBoolean(...BROWSER_AUTOMATION_ENABLED...))` 块变为：
```typescript
    if (
      readBoolean(this.config.get<string>('BROWSER_AUTOMATION_ENABLED'), false)
    ) {
      this.registry.register(this.browserOpen);
      this.registry.register(this.browserExtract);
      this.registry.register(this.browserScreenshot);
      this.registry.register(this.browserClick);
      this.registry.register(this.browserType);
      this.registry.register(this.browserWaitForSelector);
    }
    if (readBoolean(this.config.get<string>('VNC_SANDBOX_ENABLED'), false)) {
      this.registry.register(this.computerAction);
    }
```

- [ ] **Step 2: 构建验证**

```bash
pnpm build
```

期望：无 TypeScript 错误

- [ ] **Step 3: 运行全量测试**

```bash
pnpm test
```

期望：所有原有测试通过，新增测试通过

- [ ] **Step 4: 提交**

```bash
git add backend/src/tool/tool.module.ts
git commit -m "feat(tool): register ComputerActionTool under VNC_SANDBOX_ENABLED guard"
```

---

## Task 9: 前端事件（task-events.ts + useTaskSocketSync）

**Files:**
- Modify: `frontend/src/core/socket/task-events.ts`
- Modify: `frontend/src/domains/task/hooks/use-task-socket-sync.ts`

- [ ] **Step 1: 在前端 TASK_EVENTS 添加 browser session 事件**

在 `frontend/src/core/socket/task-events.ts` 中，在 `taskSnapshot` 之前添加：

```typescript
  browserSessionStarted: 'browser_session.started',
  browserSessionEnded: 'browser_session.ended',
```

- [ ] **Step 2: 在 useTaskSocketSync 处理 browser session 事件**

在 `frontend/src/domains/task/hooks/use-task-socket-sync.ts` 中做以下修改：

**1. 在 `useState` 初始化区域添加 vncRunId 状态：**
```typescript
const [vncRunId, setVncRunId] = useState<string | null>(null)
```

**2. 添加两个事件处理函数（放在 `handleRunAwaitingApproval` 之后）：**
```typescript
  const handleBrowserSessionStarted = useEffectEvent(
    (payload: BasePayload & { runId?: string }) => {
      if (payload.runId) setVncRunId(payload.runId)
    },
  )

  const handleBrowserSessionEnded = useEffectEvent(
    (payload: BasePayload & { runId?: string }) => {
      setVncRunId((current) => (current === payload.runId ? null : current))
    },
  )
```

**3. 在 `dispatch` 的 `switch` 语句添加两个 case（在 `default: break` 之前）：**
```typescript
        case TASK_EVENTS.browserSessionStarted:
          handleBrowserSessionStarted(payload); break
        case TASK_EVENTS.browserSessionEnded:
          handleBrowserSessionEnded(payload); break
```

**4. 在 `REGULAR_EVENTS` 数组末尾添加：**
```typescript
  TASK_EVENTS.browserSessionStarted,
  TASK_EVENTS.browserSessionEnded,
```

**5. 在 hook 返回值中加入 vncRunId：**
```typescript
  return { liveRunFeed, socketConnected, vncRunId }
```

- [ ] **Step 3: 构建验证**

```bash
cd mini-manus/frontend && pnpm build
```

期望：无 TypeScript 错误

- [ ] **Step 4: 提交**

```bash
git add frontend/src/core/socket/task-events.ts \
        frontend/src/domains/task/hooks/use-task-socket-sync.ts
git commit -m "feat(frontend): add browser_session events to task socket sync"
```

---

## Task 10: VncPanel 组件

**Files:**
- Create: `frontend/src/domains/task/components/VncPanel.tsx`

- [ ] **Step 1: 安装 @novnc/novnc**

```bash
cd mini-manus/frontend
pnpm add @novnc/novnc
pnpm add -D @types/novnc__novnc
```

如果 `@types/novnc__novnc` 不存在，在 `frontend/src/vite-env.d.ts`（或新建 `frontend/src/types/novnc.d.ts`）添加类型声明：

```typescript
declare module '@novnc/novnc/core/rfb' {
  export default class RFB {
    scaleViewport: boolean;
    viewOnly: boolean;
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);
    disconnect(): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  }
}
```

- [ ] **Step 2: 创建 VncPanel 组件**

```tsx
// frontend/src/domains/task/components/VncPanel.tsx
import { useEffect, useRef, useState } from 'react'

interface VncPanelProps {
  runId: string
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export function VncPanel({ runId }: VncPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<import('@novnc/novnc/core/rfb').default | null>(null)
  const [state, setState] = useState<ConnectionState>('connecting')

  useEffect(() => {
    if (!containerRef.current) return

    let rfb: import('@novnc/novnc/core/rfb').default | null = null
    let cancelled = false

    void (async () => {
      try {
        const RFB = (await import('@novnc/novnc/core/rfb')).default
        if (cancelled || !containerRef.current) return

        const wsUrl = `ws://${window.location.hostname}:${window.location.port || '3000'}/api/vnc/${runId}`

        rfb = new RFB(containerRef.current, wsUrl)
        rfb.scaleViewport = true
        rfb.viewOnly = false
        rfbRef.current = rfb

        rfb.addEventListener('connect', () => {
          if (!cancelled) setState('connected')
        })
        rfb.addEventListener('disconnect', () => {
          if (!cancelled) setState('disconnected')
        })
      } catch (err) {
        console.error('[VncPanel] 连接失败:', err)
        if (!cancelled) setState('disconnected')
      }
    })()

    return () => {
      cancelled = true
      rfb?.disconnect()
      rfbRef.current = null
    }
  }, [runId])

  return (
    <div className="vnc-panel">
      <div className="vnc-panel__header">
        <span className="vnc-panel__title">🌐 AI 正在浏览</span>
        <span
          className={`vnc-panel__status vnc-panel__status--${state}`}
        >
          {state === 'connecting' && '连接中…'}
          {state === 'connected' && '已连接'}
          {state === 'disconnected' && '已断开'}
        </span>
      </div>
      <div
        ref={containerRef}
        className="vnc-panel__canvas"
        style={{ width: '100%', aspectRatio: '16 / 9', background: '#000' }}
      />
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/domains/task/components/VncPanel.tsx
git commit -m "feat(frontend): add VncPanel component with noVNC integration"
```

---

## Task 11: 集成 VncPanel 到 task-center

**Files:**
- Modify: `frontend/src/pages/task-center/index.tsx`

- [ ] **Step 1: 在 TaskCenterPage 集成 VncPanel**

在 `frontend/src/pages/task-center/index.tsx` 做以下修改：

**1. 添加 import：**
```typescript
import { VncPanel } from '@/domains/task/components/VncPanel'
```

**2. 从 useTaskSocketSync 解构 vncRunId：**

将：
```typescript
  const { liveRunFeed, socketConnected } = useTaskSocketSync(
    selectedTaskId,
    selectedRunId,
  );
```
改为：
```typescript
  const { liveRunFeed, socketConnected, vncRunId } = useTaskSocketSync(
    selectedTaskId,
    selectedRunId,
  );
```

**3. 在"执行过程 + 计划：并列"区域添加 VncPanel**

将：
```tsx
            {/* 执行过程 + 计划：并列 */}
            <section className="task-center-grid__columns">
              <TimelineSection
                taskId={selectedTaskId ?? ""}
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
                onApprove={approveRun}
                onReject={rejectRun}
              />
              <PlanSection
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
              />
            </section>
```
改为：
```tsx
            {/* 执行过程 + 计划：并列 */}
            <section className="task-center-grid__columns">
              <TimelineSection
                taskId={selectedTaskId ?? ""}
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
                onApprove={approveRun}
                onReject={rejectRun}
              />
              <PlanSection
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
              />
            </section>

            {/* VNC 浏览器实时画面（有浏览器沙箱 session 时显示） */}
            {vncRunId ? (
              <section className="task-center-grid__vnc">
                <VncPanel runId={vncRunId} />
              </section>
            ) : null}
```

- [ ] **Step 2: 构建验证**

```bash
cd mini-manus/frontend && pnpm build
```

期望：无 TypeScript 错误

- [ ] **Step 3: 添加基础样式**

在项目现有的 SCSS 文件中（查找 `task-center-grid` 的样式文件），添加：

```scss
.task-center-grid__vnc {
  grid-column: 1 / -1;
  min-height: 400px;
}

.vnc-panel {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
  background: #000;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--surface-secondary, #f9fafb);
    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  &__title {
    font-size: 14px;
    font-weight: 500;
  }

  &__status {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;

    &--connecting { background: #fef3c7; color: #92400e; }
    &--connected  { background: #d1fae5; color: #065f46; }
    &--disconnected { background: #fee2e2; color: #991b1b; }
  }

  &__canvas {
    display: block;
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/task-center/index.tsx
git commit -m "feat(frontend): integrate VncPanel into task-center Run detail area"
```

---

## Task 12: 端到端验证

- [ ] **Step 1: 配置 .env**

在 `mini-manus/backend/.env`（或 `.env.local`）添加：

```env
VNC_SANDBOX_ENABLED=true
VNC_SANDBOX_IMAGE=mini-manus-browser-sandbox
VNC_SANDBOX_TIMEOUT_MS=600000
BROWSER_AUTOMATION_ENABLED=true
```

- [ ] **Step 2: 启动后端**

```bash
cd mini-manus/backend && pnpm start:dev
```

期望：`VNC WebSocket proxy 已注册 (/api/vnc/:runId)` 出现在日志

- [ ] **Step 3: 启动前端**

```bash
cd mini-manus/frontend && pnpm dev
```

- [ ] **Step 4: 创建测试任务并观察**

在 UI 中创建任务（内容含浏览器操作），观察：
1. 步骤列表中出现 `computer_action` 调用
2. VncPanel 出现并显示"连接中…"→"已连接"
3. 画面显示 Docker 容器里的 Chromium
4. Agent 点击/输入时，画面实时更新

- [ ] **Step 5: 验证容器清理**

任务完成后，运行：

```bash
docker ps | grep mini-manus-browser-sandbox
```

期望：无输出（容器已自动销毁）

- [ ] **Step 6: 最终提交**

```bash
git add -p  # 检查所有变更
git commit -m "feat: browser sandbox cloud computer — VNC pipeline complete"
```

---

## 附：快速手动测试 VNC 代理

```bash
# 1. 启动一个测试容器
docker run --rm -d --shm-size=1g \
  -p 16080:6080 -p 19222:9222 \
  --name sandbox-test mini-manus-browser-sandbox

# 2. 用 websocat 测试 websockify 连通性（需先 brew install websocat）
websocat ws://localhost:16080/

# 3. 测试后端 VNC proxy（容器需先注册到 VncContainerService）
# 通过 API 触发 computer_action，观察后端日志

# 清理
docker stop sandbox-test
```
