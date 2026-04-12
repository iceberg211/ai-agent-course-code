import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BrowserSessionService } from '@/browser/browser-session.service';
import { WorkspaceService } from '@/workspace/workspace.service';
import { BrowserOpenTool } from '@/tool/tools/browser/browser-open.tool';
import { BrowserExtractTool } from '@/tool/tools/browser/browser-extract.tool';
import { BrowserScreenshotTool } from '@/tool/tools/browser/browser-screenshot.tool';

const taskId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';

describe('browser tools', () => {
  it('browser_open 返回 session 元数据', async () => {
    const open = jest.fn().mockResolvedValue({
      sessionId,
      title: 'Example',
      url: 'https://example.com/',
      status: 200,
    });
    const browserSessions = {
      open,
    } as unknown as BrowserSessionService;
    const tool = new BrowserOpenTool(browserSessions);

    const result = await tool.execute({
      task_id: taskId,
      run_id: runId,
      url: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({
      session_id: sessionId,
      title: 'Example',
      status: 200,
    });
    expect(open).toHaveBeenCalledWith({
      taskId,
      runId,
      url: 'https://example.com',
      timeoutMs: undefined,
    });
  });

  it('browser_extract 输出页面文本', async () => {
    const extract = jest.fn().mockResolvedValue({
      sessionId,
      title: 'Example',
      url: 'https://example.com/',
      text: 'hello page',
      truncated: false,
    });
    const browserSessions = {
      extract,
    } as unknown as BrowserSessionService;
    const tool = new BrowserExtractTool(browserSessions);

    const result = await tool.execute({
      session_id: sessionId,
      selector: 'main',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello page');
    expect(extract).toHaveBeenCalledWith({
      sessionId,
      selector: 'main',
      maxLength: undefined,
      timeoutMs: undefined,
    });
  });

  it('browser_screenshot 将 PNG 写入 workspace', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mini-manus-browser-tool-'),
    );
    const browserSessions = {
      takeScreenshot: jest.fn().mockResolvedValue({
        sessionId,
        title: 'Example',
        url: 'https://example.com/',
        buffer: Buffer.from([1, 2, 3]),
        sizeBytes: 3,
      }),
    } as unknown as BrowserSessionService;
    const workspace = {
      resolveSafePath: jest.fn((id: string, relativePath: string) =>
        path.join(tempDir, id, relativePath),
      ),
    } as unknown as WorkspaceService;
    const tool = new BrowserScreenshotTool(browserSessions, workspace);

    try {
      const result = await tool.execute({
        task_id: taskId,
        session_id: sessionId,
        path: 'screens/main',
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toMatchObject({
        path: 'screens/main.png',
        size_bytes: 3,
      });
      const file = await fs.readFile(
        path.join(tempDir, taskId, 'screens/main.png'),
      );
      expect([...file]).toEqual([1, 2, 3]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
