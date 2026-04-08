import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';

/**
 * 请求日志拦截器
 *
 * 每个 HTTP 请求打印：方法、路径、状态码、耗时
 * 格式：GET  /api/tasks  200  12ms
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const ms = Date.now() - start;
          this.logger.log(
            `${method.padEnd(6)} ${url.padEnd(40)} ${res.statusCode}  ${ms}ms`,
          );
        },
        error: () => {
          const ms = Date.now() - start;
          this.logger.warn(
            `${method.padEnd(6)} ${url.padEnd(40)} ERR  ${ms}ms`,
          );
        },
      }),
    );
  }
}
