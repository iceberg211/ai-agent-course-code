import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolRegistry } from '@/tool/tool.registry';
import { WebSearchTool } from '@/tool/tools/web-search.tool';
import { BrowseUrlTool } from '@/tool/tools/browse-url.tool';
import { ReadFileTool } from '@/tool/tools/read-file.tool';
import { WriteFileTool } from '@/tool/tools/write-file.tool';
import { ListDirectoryTool } from '@/tool/tools/list-directory.tool';
import { ThinkTool } from '@/tool/tools/think.tool';
import { DownloadFileTool } from '@/tool/tools/download-file.tool';
import { ExtractPdfTextTool } from '@/tool/tools/extract-pdf-text.tool';
import { FetchUrlAsMarkdownTool } from '@/tool/tools/fetch-url-as-markdown.tool';
import { ExportPdfTool } from '@/tool/tools/export-pdf.tool';
import { GitHubSearchTool } from '@/tool/tools/github-search.tool';
import { BrowserOpenTool } from '@/tool/tools/browser/browser-open.tool';
import { BrowserExtractTool } from '@/tool/tools/browser/browser-extract.tool';
import { BrowserScreenshotTool } from '@/tool/tools/browser/browser-screenshot.tool';
import { BrowserClickTool } from '@/tool/tools/browser/browser-click.tool';
import { BrowserTypeTool } from '@/tool/tools/browser/browser-type.tool';
import { BrowserWaitForSelectorTool } from '@/tool/tools/browser/browser-wait-for-selector.tool';
import { SandboxRunNodeTool } from '@/tool/tools/sandbox/sandbox-run-node.tool';
import { SandboxRunPythonTool } from '@/tool/tools/sandbox/sandbox-run-python.tool';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { BrowserModule } from '@/browser/browser.module';
import { SandboxModule } from '@/sandbox/sandbox.module';

function readBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

@Module({
  imports: [WorkspaceModule, BrowserModule, SandboxModule],
  providers: [
    ToolRegistry,
    WebSearchTool,
    BrowseUrlTool,
    ReadFileTool,
    WriteFileTool,
    ListDirectoryTool,
    DownloadFileTool,
    ExtractPdfTextTool,
    FetchUrlAsMarkdownTool,
    ExportPdfTool,
    GitHubSearchTool,
    BrowserOpenTool,
    BrowserExtractTool,
    BrowserScreenshotTool,
    BrowserClickTool,
    BrowserTypeTool,
    BrowserWaitForSelectorTool,
    SandboxRunNodeTool,
    SandboxRunPythonTool,
    {
      provide: 'THINK_TOOL',
      useClass: ThinkTool,
    },
  ],
  exports: [ToolRegistry],
})
export class ToolModule {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: ToolRegistry,
    private readonly webSearch: WebSearchTool,
    private readonly browseUrl: BrowseUrlTool,
    private readonly readFile: ReadFileTool,
    private readonly writeFile: WriteFileTool,
    private readonly listDirectory: ListDirectoryTool,
    private readonly downloadFile: DownloadFileTool,
    private readonly extractPdfText: ExtractPdfTextTool,
    private readonly fetchUrlAsMarkdown: FetchUrlAsMarkdownTool,
    private readonly exportPdf: ExportPdfTool,
    private readonly githubSearch: GitHubSearchTool,
    private readonly browserOpen: BrowserOpenTool,
    private readonly browserExtract: BrowserExtractTool,
    private readonly browserScreenshot: BrowserScreenshotTool,
    private readonly browserClick: BrowserClickTool,
    private readonly browserType: BrowserTypeTool,
    private readonly browserWaitForSelector: BrowserWaitForSelectorTool,
    private readonly sandboxRunNode: SandboxRunNodeTool,
    private readonly sandboxRunPython: SandboxRunPythonTool,
  ) {}

  onModuleInit() {
    this.registry.register(this.webSearch);
    this.registry.register(this.browseUrl);
    this.registry.register(this.readFile);
    this.registry.register(this.writeFile);
    this.registry.register(this.listDirectory);
    this.registry.register(this.downloadFile);
    this.registry.register(this.extractPdfText);
    this.registry.register(this.fetchUrlAsMarkdown);
    this.registry.register(this.exportPdf);
    this.registry.register(this.githubSearch);
    if (
      readBoolean(this.config.get<string>('BROWSER_AUTOMATION_ENABLED'), false)
    ) {
      this.registry.register(this.browserOpen);
      this.registry.register(this.browserExtract);
      this.registry.register(this.browserScreenshot);
      // B2：交互工具（BROWSER_AUTOMATION_ENABLED=true 时才注册）
      this.registry.register(this.browserClick);
      this.registry.register(this.browserType);
      this.registry.register(this.browserWaitForSelector);
    }
    // 沙箱工具：仅在 SANDBOX_ENABLED=true 时注册（避免 Planner 在未配置时选用）
    if (readBoolean(this.config.get<string>('SANDBOX_ENABLED'), false)) {
      this.registry.register(this.sandboxRunNode);
      this.registry.register(this.sandboxRunPython);
    }
    this.registry.register(new ThinkTool());
  }
}
