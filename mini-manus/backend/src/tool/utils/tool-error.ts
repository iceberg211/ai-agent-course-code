import axios from 'axios';
import { ZodError } from 'zod';
import { ToolErrorCode, ToolResult } from '@/tool/interfaces/tool.interface';

export function toolFailure(
  errorCode: ToolErrorCode,
  message: string,
  metadata?: Record<string, unknown>,
): ToolResult {
  return {
    success: false,
    output: '',
    error: message,
    errorCode,
    metadata,
    cached: false,
  };
}

export function classifyToolError(
  err: unknown,
  fallbackMessage: string,
): ToolResult {
  if (err instanceof ZodError) {
    return toolFailure(
      'tool_input_invalid',
      `${fallbackMessage}: ${err.issues.map((issue) => issue.message).join('; ')}`,
    );
  }

  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED') {
      return toolFailure('timeout', `${fallbackMessage}: 请求超时`);
    }
    const detail =
      typeof err.response?.data === 'string'
        ? err.response.data
        : err.message;
    return toolFailure('network', `${fallbackMessage}: ${detail}`);
  }

  if (err instanceof Error) {
    if (/timeout|超时/i.test(err.message)) {
      return toolFailure('timeout', `${fallbackMessage}: ${err.message}`);
    }
    if (/abort|cancel/i.test(err.message)) {
      return toolFailure('cancelled', `${fallbackMessage}: ${err.message}`);
    }
    return toolFailure('tool_execution_failed', `${fallbackMessage}: ${err.message}`);
  }

  return toolFailure('unknown', `${fallbackMessage}: ${String(err)}`);
}
