import { assertSafeHttpUrl } from '@/tool/utils/url-safety';

describe('assertSafeHttpUrl', () => {
  it('允许公网 http/https URL', () => {
    expect(() => assertSafeHttpUrl('https://example.com/a')).not.toThrow();
    expect(() => assertSafeHttpUrl('http://example.com/a')).not.toThrow();
  });

  it('拒绝非 http/https 协议', () => {
    expect(() => assertSafeHttpUrl('file:///etc/passwd')).toThrow(
      '只允许 http/https URL',
    );
  });

  it('拒绝本地和内网地址', () => {
    expect(() => assertSafeHttpUrl('http://localhost:3000')).toThrow();
    expect(() => assertSafeHttpUrl('http://127.0.0.1:3000')).toThrow();
    expect(() => assertSafeHttpUrl('http://10.0.0.1')).toThrow();
    expect(() => assertSafeHttpUrl('http://172.16.0.1')).toThrow();
    expect(() => assertSafeHttpUrl('http://192.168.1.1')).toThrow();
    expect(() => assertSafeHttpUrl('http://[::1]/')).toThrow();
  });
});
