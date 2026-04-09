import { Module } from '@nestjs/common';
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
import { WorkspaceModule } from '@/workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
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
    {
      provide: 'THINK_TOOL',
      useClass: ThinkTool,
    },
  ],
  exports: [ToolRegistry],
})
export class ToolModule {
  constructor(
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
    this.registry.register(new ThinkTool());
  }
}
