import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const request = ctx.getRequest<{
      method: string;
      url: string;
      originalUrl?: string;
    }>();

    const isHttpException = exception instanceof HttpException;
    const errorMessage =
      exception instanceof Error ? exception.message : String(exception ?? '');
    const isTransientDbError =
      /Connection terminated unexpectedly|ECONNRESET|too many clients|terminating connection/i.test(
        errorMessage,
      );
    const status = isTransientDbError
      ? HttpStatus.SERVICE_UNAVAILABLE
      : isHttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = isHttpException
      ? exception.getResponse()
      : isTransientDbError
        ? '数据库连接暂不可用，请稍后重试'
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';

    this.logger.error(
      `${request.method} ${request.originalUrl ?? request.url} -> ${status} ${
        exception instanceof Error
          ? (exception.stack ?? exception.message)
          : JSON.stringify(exception)
      }`,
    );

    response.status(status).json({
      statusCode: status,
      message: rawMessage,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
