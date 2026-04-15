import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';

const schema = z.object({
  owner: z
    .string()
    .min(1)
    .describe('仓库所有者（用户名或组织名），如 "openai"'),
  repo: z.string().min(1).describe('仓库名，如 "gpt-4"'),
  path: z
    .string()
    .min(1)
    .describe('文件路径，相对于仓库根目录，如 "README.md" 或 "src/index.ts"'),
  ref: z
    .string()
    .optional()
    .describe('分支、tag 或 commit SHA，默认为仓库默认分支'),
});

interface GitHubFileResponse {
  type: string;
  encoding: string;
  content: string;
  name: string;
  path: string;
  size: number;
  html_url: string;
}

@Injectable()
export class GitHubGetFileTool implements Tool {
  readonly name = 'github_get_file';
  readonly description =
    '读取 GitHub 仓库中某个文件的内容。适合查看代码实现、README、配置文件等。';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  constructor(private readonly config: ConfigService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { owner, repo, path, ref } = schema.parse(input);
      const token = this.config.get<string>('GITHUB_TOKEN', '').trim();

      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
      const response = await axios.get<GitHubFileResponse>(url, {
        params: ref ? { ref } : undefined,
        timeout: 15000,
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = response.data;

      if (data.type !== 'file') {
        return {
          success: false,
          output: `${path} 是目录，不是文件。请用 github_search 搜索仓库，或直接指定文件路径。`,
          error: 'not_a_file',
          errorCode: 'tool_execution_failed',
        };
      }

      if (data.encoding !== 'base64') {
        return {
          success: false,
          output: `不支持的编码格式：${data.encoding}`,
          error: 'unsupported_encoding',
          errorCode: 'tool_execution_failed',
        };
      }

      // GitHub API returns base64 content with newlines — strip them before decoding
      const content = Buffer.from(
        data.content.replace(/\n/g, ''),
        'base64',
      ).toString('utf-8');

      const header = [
        `# ${data.name}`,
        `仓库：${owner}/${repo}`,
        `路径：${data.path}`,
        `大小：${data.size} bytes`,
        `链接：${data.html_url}`,
        '',
        '```',
        content,
        '```',
      ].join('\n');

      return {
        success: true,
        output: truncateOutput(header),
        structuredData: {
          owner,
          repo,
          path: data.path,
          name: data.name,
          size: data.size,
          url: data.html_url,
          content,
        },
      };
    } catch (err: unknown) {
      // 404 is common (file not found or private repo) — give a clear message
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return {
          success: false,
          output: `文件未找到：请检查 owner/repo/path 是否正确，以及仓库是否为公开仓库。`,
          error: 'file_not_found',
          errorCode: 'tool_execution_failed',
        };
      }
      return classifyToolError(err, 'GitHub get file failed');
    }
  }
}
