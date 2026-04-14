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
  query: z.string().min(1).describe('GitHub 仓库搜索词'),
  max_results: z.number().int().min(1).max(10).default(5).optional(),
});

interface SearchRepoItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
}

@Injectable()
export class GitHubSearchTool implements Tool {
  readonly name = 'github_search';
  readonly description =
    '搜索 GitHub 仓库，返回仓库地址、简介、语言、Star 数和最近更新时间。';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  constructor(private readonly config: ConfigService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { query, max_results } = schema.parse(input);
      const token = this.config.get<string>('GITHUB_TOKEN', '').trim();

      const response = await axios.get<{
        items?: SearchRepoItem[];
      }>('https://api.github.com/search/repositories', {
        params: {
          q: query,
          per_page: max_results ?? 5,
          sort: 'stars',
          order: 'desc',
        },
        timeout: 15000,
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const items = response.data.items ?? [];
      const output = items
        .map(
          (item, index) =>
            `[${index + 1}] ${item.full_name}\nURL: ${item.html_url}\nStars: ${item.stargazers_count}\nLanguage: ${item.language ?? 'unknown'}\nUpdated: ${item.updated_at}\n${item.description ?? 'No description'}`,
        )
        .join('\n\n');

      return {
        success: true,
        output: truncateOutput(output || '无搜索结果'),
        // 结构化数据：Skill 直接用此字段提取 URL/仓库信息，不必正则解析 output
        structuredData: items.map((item) => ({
          fullName: item.full_name,
          url: item.html_url,
          description: item.description,
          stars: item.stargazers_count,
          language: item.language,
          updatedAt: item.updated_at,
        })),
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'GitHub search failed');
    }
  }
}
