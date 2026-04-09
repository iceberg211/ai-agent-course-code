import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import type { Response } from 'express';

/**
 * 全局异常过滤器
 *
 * - HttpException       → 直接使用其 status + message
 * - TypeORM EntityNotFoundError → 404
 * - 其他未知错误         → 500，并打印完整堆栈
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    // WebSocket / gRPC 上下文没有 HTTP response，跳过由各自的层处理
    if (host.getType() !== 'http') return;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; url: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string }).message ?? exception.message);
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = '资源不存在';
    } else if (exception instanceof QueryFailedError) {
      const dbMessage = String(exception.message ?? '');
      status = HttpStatus.BAD_REQUEST;
      message = /invalid input syntax for type uuid/i.test(dbMessage)
        ? '请求参数格式错误（UUID）'
        : '请求参数错误';
      this.logger.warn(`${request.method} ${request.url} → ${dbMessage}`);
    } else if (exception instanceof Error) {
      this.logger.error(
        `${request.method} ${request.url} → ${exception.message}`,
        exception.stack,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
