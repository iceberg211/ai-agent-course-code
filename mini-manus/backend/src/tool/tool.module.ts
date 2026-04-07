import { Module } from '@nestjs/common';
import { ToolRegistry } from '@/tool/tool.registry';
import { WebSearchTool } from '@/tool/tools/web-search.tool';
import { BrowseUrlTool } from '@/tool/tools/browse-url.tool';
import { ReadFileTool } from '@/tool/tools/read-file.tool';
import { WriteFileTool } from '@/tool/tools/write-file.tool';
import { ListDirectoryTool } from '@/tool/tools/list-directory.tool';
import { ThinkTool } from '@/tool/tools/think.tool';
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
  ) {}

  onModuleInit() {
    this.registry.register(this.webSearch);
    this.registry.register(this.browseUrl);
    this.registry.register(this.readFile);
    this.registry.register(this.writeFile);
    this.registry.register(this.listDirectory);
    this.registry.register(new ThinkTool());
  }
}
