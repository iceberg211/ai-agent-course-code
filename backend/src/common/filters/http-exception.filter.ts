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
    const exceptionLike = exception as { name?: string; code?: string };
    const isMulterError = exceptionLike?.name === 'MulterError';
    const isTransientDbError =
      /Connection terminated unexpectedly|ECONNRESET|too many clients|terminating connection/i.test(
        errorMessage,
      );
    const status = this.resolveStatus(
      isHttpException,
      isTransientDbError,
      isMulterError,
      exceptionLike.code,
      exception,
    );

    const rawMessage = this.resolveResponseMessage(
      exception,
      isHttpException,
      isTransientDbError,
      isMulterError,
      exceptionLike.code,
    );

    const logMessage = `${request.method} ${
      request.originalUrl ?? request.url
    } -> ${status} ${
      exception instanceof Error ? exception.message : JSON.stringify(exception)
    }`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl ?? request.url} -> ${status} ${
          exception instanceof Error
            ? (exception.stack ?? exception.message)
            : JSON.stringify(exception)
        }`,
      );
    } else {
      this.logger.warn(logMessage);
    }

    response.status(status).json({
      statusCode: status,
      message: rawMessage,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private resolveStatus(
    isHttpException: boolean,
    isTransientDbError: boolean,
    isMulterError: boolean,
    multerCode: string | undefined,
    exception: unknown,
  ): number {
    if (isTransientDbError) {
      return HttpStatus.SERVICE_UNAVAILABLE;
    }
    if (isMulterError && multerCode === 'LIMIT_FILE_SIZE') {
      return HttpStatus.PAYLOAD_TOO_LARGE;
    }
    if (isMulterError) {
      return HttpStatus.BAD_REQUEST;
    }
    if (isHttpException) {
      return (exception as HttpException).getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveResponseMessage(
    exception: unknown,
    isHttpException: boolean,
    isTransientDbError: boolean,
    isMulterError: boolean,
    multerCode: string | undefined,
  ): unknown {
    if (isHttpException) {
      return (exception as HttpException).getResponse();
    }
    if (isTransientDbError) {
      return '数据库连接暂不可用，请稍后重试';
    }
    if (isMulterError && multerCode === 'LIMIT_FILE_SIZE') {
      return '上传文件过大';
    }
    if (isMulterError) {
      return '上传文件不符合要求';
    }
    return '服务器内部错误，请稍后重试';
  }
}
