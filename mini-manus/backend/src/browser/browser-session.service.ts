import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { assertSafeHttpUrl } from '@/tool/utils/url-safety';

function readBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readNumber(value: string | number | undefined, defaultValue: number) {
  const parsed = Number(value ?? defaultValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface BrowserSession {
  id: string;
  taskId: string;
  runId?: string;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface BrowserOpenOptions {
  taskId: string;
  runId?: string;
  url: string;
  timeoutMs?: number;
}

export interface BrowserOpenResult {
  sessionId: string;
  title: string;
  url: string;
  status: number | null;
}

// ─── B2：交互工具接口 ──────────────────────────────────────────────────────────

export interface BrowserClickOptions {
  sessionId: string;
  selector: string;
  timeoutMs?: number;
}

export interface BrowserClickResult {
  sessionId: string;
  title: string;
  url: string;
  clicked: boolean;
}

export interface BrowserTypeOptions {
  sessionId: string;
  selector: string;
  text: string;
  clearFirst?: boolean;  // 先清空再输入，默认 false
  timeoutMs?: number;
}

export interface BrowserTypeResult {
  sessionId: string;
  title: string;
  url: string;
}

export interface BrowserWaitForSelectorOptions {
  sessionId: string;
  selector: string;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeoutMs?: number;
}

export interface BrowserWaitForSelectorResult {
  sessionId: string;
  title: string;
  url: string;
  found: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface BrowserExtractOptions {
  sessionId: string;
  selector?: string;
  maxLength?: number;
  timeoutMs?: number;
}

export interface BrowserExtractResult {
  sessionId: string;
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}

export interface BrowserScreenshotOptions {
  sessionId: string;
  fullPage?: boolean;
  timeoutMs?: number;
}

export interface BrowserScreenshotResult {
  sessionId: string;
  title: string;
  url: string;
  buffer: Buffer;
  sizeBytes: number;
}

@Injectable()
export class BrowserSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserSessionService.name);
  private readonly enabled: boolean;
  private readonly headless: boolean;
  private readonly maxSessionsPerRun: number;
  private readonly defaultTimeoutMs: number;
  private readonly actionTimeoutMs: number;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, BrowserSession>();
  private browser: Browser | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = readBoolean(
      config.get<string>('BROWSER_AUTOMATION_ENABLED'),
      false,
    );
    this.headless = readBoolean(config.get<string>('BROWSER_HEADLESS'), true);
    this.maxSessionsPerRun = clampNumber(
      readNumber(
        config.get<string | number>('BROWSER_MAX_SESSIONS_PER_RUN'),
        2,
      ),
      1,
      10,
    );
    this.defaultTimeoutMs = clampNumber(
      readNumber(
        config.get<string | number>('BROWSER_DEFAULT_TIMEOUT_MS'),
        15_000,
      ),
      1_000,
      60_000,
    );
    this.actionTimeoutMs = clampNumber(
      readNumber(
        config.get<string | number>('BROWSER_ACTION_TIMEOUT_MS'),
        10_000,
      ),
      1_000,
      60_000,
    );
    this.sessionTtlMs = clampNumber(
      readNumber(
        config.get<string | number>('BROWSER_SESSION_TTL_MS'),
        10 * 60_000,
      ),
      60_000,
      60 * 60_000,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) return;

    this.cleanupTimer = setInterval(
      () => {
        void this.evictExpiredSessions();
      },
      Math.min(this.sessionTtlMs, 60_000),
    );
    this.cleanupTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.closeAll();
  }

  async open(options: BrowserOpenOptions): Promise<BrowserOpenResult> {
    this.ensureEnabled();
    assertSafeHttpUrl(options.url);
    await this.evictExpiredSessions();
    await this.enforceSessionLimit(options.taskId, options.runId);

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; MiniManus/1.0)',
      viewport: { width: 1440, height: 1000 },
      ignoreHTTPSErrors: false,
    });
    await this.applyRequestPolicy(context);

    const page = await context.newPage();
    const timeoutMs = this.normalizeTimeout(
      options.timeoutMs ?? this.defaultTimeoutMs,
    );
    page.setDefaultTimeout(this.actionTimeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    try {
      const response = await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page
        .waitForLoadState('networkidle', {
          timeout: Math.min(this.actionTimeoutMs, 3_000),
        })
        .catch(() => undefined);

      const sessionId = randomUUID();
      const title = await page.title();
      const session: BrowserSession = {
        id: sessionId,
        taskId: options.taskId,
        runId: options.runId,
        context,
        page,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      };
      this.sessions.set(sessionId, session);

      return {
        sessionId,
        title,
        url: page.url(),
        status: response?.status() ?? null,
      };
    } catch (err) {
      await context.close().catch(() => undefined);
      throw err;
    }
  }

  async extract(options: BrowserExtractOptions): Promise<BrowserExtractResult> {
    this.ensureEnabled();
    const session = await this.getSession(options.sessionId);
    const maxLength = clampNumber(options.maxLength ?? 12_000, 1, 50_000);
    const timeoutMs = this.normalizeTimeout(
      options.timeoutMs ?? this.actionTimeoutMs,
    );

    const rawText = options.selector
      ? ((await session.page
          .locator(options.selector)
          .first()
          .textContent({ timeout: timeoutMs })) ?? '')
      : await session.page.evaluate(() => document.body?.innerText ?? '');

    const normalizedText = rawText.replace(/\s+/g, ' ').trim();
    const truncated = normalizedText.length > maxLength;
    session.lastUsedAt = new Date();

    return {
      sessionId: session.id,
      title: await session.page.title(),
      url: session.page.url(),
      text: truncated ? normalizedText.slice(0, maxLength) : normalizedText,
      truncated,
    };
  }

  async takeScreenshot(
    options: BrowserScreenshotOptions,
  ): Promise<BrowserScreenshotResult> {
    this.ensureEnabled();
    const session = await this.getSession(options.sessionId);
    const timeoutMs = this.normalizeTimeout(
      options.timeoutMs ?? this.actionTimeoutMs,
    );
    const buffer = await session.page.screenshot({
      fullPage: options.fullPage ?? true,
      type: 'png',
      timeout: timeoutMs,
    });
    session.lastUsedAt = new Date();

    return {
      sessionId: session.id,
      title: await session.page.title(),
      url: session.page.url(),
      buffer,
      sizeBytes: buffer.byteLength,
    };
  }

  // ─── B2：交互方法 ──────────────────────────────────────────────────────────

  async click(options: BrowserClickOptions): Promise<BrowserClickResult> {
    this.ensureEnabled();
    const session = await this.getSession(options.sessionId);
    const timeout = this.normalizeTimeout(options.timeoutMs ?? this.actionTimeoutMs);

    await session.page.locator(options.selector).first().click({ timeout });
    session.lastUsedAt = new Date();

    return {
      sessionId: session.id,
      title: await session.page.title(),
      url: session.page.url(),
      clicked: true,
    };
  }

  async type(options: BrowserTypeOptions): Promise<BrowserTypeResult> {
    this.ensureEnabled();
    const session = await this.getSession(options.sessionId);
    const timeout = this.normalizeTimeout(options.timeoutMs ?? this.actionTimeoutMs);
    const locator = session.page.locator(options.selector).first();

    if (options.clearFirst) {
      await locator.clear({ timeout });
    }
    await locator.type(options.text, { timeout });
    session.lastUsedAt = new Date();

    return {
      sessionId: session.id,
      title: await session.page.title(),
      url: session.page.url(),
    };
  }

  async waitForSelector(
    options: BrowserWaitForSelectorOptions,
  ): Promise<BrowserWaitForSelectorResult> {
    this.ensureEnabled();
    const session = await this.getSession(options.sessionId);
    const timeout = this.normalizeTimeout(options.timeoutMs ?? this.actionTimeoutMs);

    try {
      await session.page.waitForSelector(options.selector, {
        state: options.state ?? 'visible',
        timeout,
      });
      session.lastUsedAt = new Date();
      return {
        sessionId: session.id,
        title: await session.page.title(),
        url: session.page.url(),
        found: true,
      };
    } catch {
      return {
        sessionId: session.id,
        title: await session.page.title(),
        url: session.page.url(),
        found: false,
      };
    }
  }

  async closeRun(runId: string): Promise<number> {
    const sessionIds = Array.from(this.sessions.values())
      .filter((session) => session.runId === runId)
      .map((session) => session.id);
    await Promise.all(
      sessionIds.map((sessionId) => this.closeSession(sessionId)),
    );
    return sessionIds.length;
  }

  async closeTask(taskId: string): Promise<number> {
    const sessionIds = Array.from(this.sessions.values())
      .filter((session) => session.taskId === taskId)
      .map((session) => session.id);
    await Promise.all(
      sessionIds.map((sessionId) => this.closeSession(sessionId)),
    );
    return sessionIds.length;
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.keys()).map((sessionId) =>
        this.closeSession(sessionId),
      ),
    );
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  private async getSession(sessionId: string): Promise<BrowserSession> {
    await this.evictExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`浏览器会话不存在或已过期：${sessionId}`);
    }
    session.lastUsedAt = new Date();
    return session;
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    await session.context.close().catch((err: unknown) => {
      this.logger.warn(`关闭浏览器会话失败：${String(err)}`);
    });
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;

    this.browser = await chromium.launch({
      headless: this.headless,
      executablePath: chromium.executablePath(),
    });
    this.browser.on('disconnected', () => {
      this.sessions.clear();
      this.browser = null;
    });
    return this.browser;
  }

  private async applyRequestPolicy(context: BrowserContext): Promise<void> {
    await context.route('**/*', async (route: import('playwright').Route) => {
      const requestUrl = route.request().url();
      if (this.isAllowedBrowserRequestUrl(requestUrl)) {
        await route.continue();
        return;
      }

      this.logger.warn(`浏览器请求已拦截：${requestUrl}`);
      await route.abort('blockedbyclient');
    });
  }

  private isAllowedBrowserRequestUrl(url: string): boolean {
    if (
      url === 'about:blank' ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      return true;
    }

    try {
      assertSafeHttpUrl(url);
      return true;
    } catch {
      return false;
    }
  }

  private async enforceSessionLimit(
    taskId: string,
    runId?: string,
  ): Promise<void> {
    const sessions = Array.from(this.sessions.values())
      .filter((session) =>
        runId ? session.runId === runId : session.taskId === taskId,
      )
      .sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime());

    while (sessions.length >= this.maxSessionsPerRun) {
      const oldest = sessions.shift();
      if (!oldest) break;
      await this.closeSession(oldest.id);
    }
  }

  private async evictExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expiredIds = Array.from(this.sessions.values())
      .filter(
        (session) => now - session.lastUsedAt.getTime() > this.sessionTtlMs,
      )
      .map((session) => session.id);
    await Promise.all(
      expiredIds.map((sessionId) => this.closeSession(sessionId)),
    );
  }

  private normalizeTimeout(timeoutMs: number): number {
    return clampNumber(timeoutMs, 1_000, 60_000);
  }

  private ensureEnabled(): void {
    if (!this.enabled) {
      throw new Error(
        '浏览器自动化未启用，请设置 BROWSER_AUTOMATION_ENABLED=true',
      );
    }
  }
}
