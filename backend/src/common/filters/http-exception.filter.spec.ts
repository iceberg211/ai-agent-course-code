import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';

describe('HttpExceptionFilter', () => {
  function createHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'GET',
          url: '/test',
          originalUrl: '/test',
        }),
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json };
  }

  it('普通 Error 不会把内部 message 返回给客户端', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new Error('数据库连接串 secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: '服务器内部错误，请稍后重试',
      }),
    );
  });

  it('HttpException 仍返回自身稳定响应', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new BadRequestException('参数错误'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: expect.objectContaining({
          message: '参数错误',
        }),
      }),
    );
  });
});
