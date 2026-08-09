import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<{
      method: string;
      url: string;
      originalUrl?: string;
      ip?: string;
    }>();
    const response = httpContext.getResponse<{ statusCode: number }>();
    const startAt = Date.now();
    const reqPath = request.originalUrl ?? request.url;

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - startAt;
          this.logger.log(
            `${request.method} ${reqPath} ${response.statusCode} - ${ms}ms - ${request.ip ?? '-'}`,
          );
        },
        error: (err) => {
          const ms = Date.now() - startAt;
          const status = err instanceof HttpException ? err.getStatus() : 500;
          this.logger.error(
            `${request.method} ${reqPath} ${status} - ${ms}ms - ${err?.message ?? err}`,
          );
        },
      }),
    );
  }
}
