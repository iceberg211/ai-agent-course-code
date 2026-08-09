const http = require('node:http');
const { randomUUID } = require('node:crypto');

const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3001';
const USERNAME = process.env.SMOKE_USERNAME || `smoke_${Date.now()}`;
const PASSWORD = process.env.SMOKE_PASSWORD || 'SmokeTest_123456';
const PROVIDED_TOKEN = process.env.SMOKE_TOKEN || '';

const results = [];

function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    token,
    timeoutMs = 30000,
  } = options;

  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const contentType = String(res.headers['content-type'] || '');
          let parsed = data;
          if (contentType.includes('application/json')) {
            try {
              parsed = data ? JSON.parse(data) : null;
            } catch {
              parsed = data;
            }
          }
          resolve({
            status: res.statusCode || 0,
            body: parsed,
            raw: data,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`${method} ${path} timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function step(name, fn, options = {}) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    results.push({
      name,
      ok: true,
      costMs: Date.now() - startedAt,
    });
    console.log(`[PASS] ${name} (${Date.now() - startedAt}ms)`);
    return value;
  } catch (error) {
    results.push({
      name,
      ok: false,
      costMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`[FAIL] ${name} (${Date.now() - startedAt}ms)`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
    if (options.required) {
      throw error;
    }
    return null;
  }
}

function expectStatus(res, name, expected = [200, 201]) {
  if (!expected.includes(res.status)) {
    throw new Error(`${name} returned ${res.status}: ${formatBody(res.body)}`);
  }
  return res.body;
}

function expectId(body, name) {
  if (!body || typeof body.id !== 'string') {
    throw new Error(`${name} did not return id: ${formatBody(body)}`);
  }
  return body.id;
}

function formatBody(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

async function getToken() {
  if (PROVIDED_TOKEN) {
    console.log('[INFO] 使用 SMOKE_TOKEN 跳过注册登录');
    return PROVIDED_TOKEN;
  }

  await step('注册联调用户', async () => {
    const res = await request('/auth/register', {
      method: 'POST',
      body: {
        username: USERNAME,
        password: PASSWORD,
        department: '研发部',
      },
    });
    if (![200, 201, 409, 400].includes(res.status)) {
      throw new Error(`register returned ${res.status}: ${formatBody(res.body)}`);
    }
    return res.body;
  });

  return step(
    '登录并获取 JWT',
    async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: { username: USERNAME, password: PASSWORD },
      });
      const body = expectStatus(res, 'login', [200]);
      if (!body?.accessToken) {
        throw new Error(`login missing accessToken: ${formatBody(body)}`);
      }
      return body.accessToken;
    },
    { required: true },
  );
}

async function main() {
  console.log(`开始核心接口联调：${BASE_URL}`);
  const token = await getToken();
  const suffix = randomUUID().slice(0, 8);
  let kbId = null;
  let personaId = null;

  await step('读取当前用户', async () => {
    return expectStatus(await request('/auth/me', { token }), 'auth/me');
  });

  kbId = await step('创建测试知识库', async () => {
    const body = expectStatus(
      await request('/knowledge-bases', {
        method: 'POST',
        token,
        body: {
          name: `联调知识库-${suffix}`,
          description: '核心接口自动联调创建',
        },
      }),
      'create knowledge base',
    );
    return expectId(body, 'create knowledge base');
  });

  personaId = await step('创建测试 Persona', async () => {
    const body = expectStatus(
      await request('/personas', {
        method: 'POST',
        token,
        body: {
          name: `联调助手-${suffix}`,
          description: '核心接口自动联调创建',
          speakingStyle: '简洁准确',
          expertise: ['企业知识库', 'RAG'],
        },
      }),
      'create persona',
    );
    return expectId(body, 'create persona');
  });

  if (kbId && personaId) {
    await step('挂载知识库到 Persona', async () => {
      return expectStatus(
        await request(`/personas/${personaId}/knowledge-bases`, {
          method: 'POST',
          token,
          body: { knowledgeBaseId: kbId },
        }),
        'attach knowledge base',
      );
    });
  }

  if (kbId) {
    await step('跨知识库搜索并校验 Trace 字段', async () => {
      const body = expectStatus(
        await request('/search', {
          method: 'POST',
          token,
          timeoutMs: 45000,
          body: {
            query: '联调知识库是否可检索？',
            knowledgeBaseIds: [kbId],
            rerank: false,
            threshold: 0.1,
            useGraph: false,
            fileType: 'pdf',
            tags: ['联调'],
            department: '研发部',
            businessCategory: '测试',
            visibility: 'company',
          },
        }),
        'search',
        [200, 201],
      );
      if (!body.stageTrace) {
        throw new Error(`search missing stageTrace: ${formatBody(body)}`);
      }
      if (!Array.isArray(body.degradedChannels)) {
        throw new Error(`search missing degradedChannels: ${formatBody(body)}`);
      }
      return body;
    });
  }

  if (personaId) {
    await step('Persona 分阶段检索', async () => {
      const body = expectStatus(
        await request(`/personas/${personaId}/search/stages`, {
          method: 'POST',
          token,
          timeoutMs: 45000,
          body: {
            query: '联调 Persona 检索是否可用？',
            rerank: false,
            threshold: 0.1,
            useGraph: false,
          },
        }),
        'persona search stages',
        [200, 201],
      );
      if (!body.stageTrace) {
        throw new Error(`persona search missing stageTrace: ${formatBody(body)}`);
      }
      return body;
    });

    await step('Chat 流式接口', async () => {
      const res = await request('/chat', {
        method: 'POST',
        token,
        timeoutMs: 60000,
        body: {
          personaId,
          message: '请用一句话说明当前联调状态。',
        },
      });
      if (![200, 201].includes(res.status)) {
        throw new Error(`chat returned ${res.status}: ${formatBody(res.body)}`);
      }
      if (!res.raw || res.raw.length < 10) {
        throw new Error('chat stream response is empty');
      }
      return res.raw.slice(0, 120);
    });
  }

  await step('读取会话列表', async () => {
    return expectStatus(await request('/conversations?page=1&pageSize=5', { token }), 'conversations');
  });

  await step('读取首页统计', async () => {
    return expectStatus(await request('/dashboard/summary', { token }), 'dashboard summary');
  });

  await step('读取 RAG 健康统计', async () => {
    const body = expectStatus(await request('/dashboard/rag-health', { token }), 'dashboard rag health');
    if (typeof body.noCitationRate !== 'number') {
      throw new Error(`rag health missing noCitationRate: ${formatBody(body)}`);
    }
    if (!body.evalSummary || typeof body.evalSummary.total !== 'number') {
      throw new Error(`rag health missing evalSummary: ${formatBody(body)}`);
    }
    if (!body.taskHealth || typeof body.taskHealth.failed !== 'number') {
      throw new Error(`rag health missing taskHealth: ${formatBody(body)}`);
    }
    return body;
  });

  await step('读取通知列表', async () => {
    return expectStatus(await request('/notifications?page=1&pageSize=10', { token }), 'notifications');
  });

  if (personaId) {
    await step('清理测试 Persona', async () => {
      return expectStatus(
        await request(`/personas/${personaId}`, { method: 'DELETE', token }),
        'delete persona',
      );
    });
  }

  if (kbId) {
    await step('清理测试知识库', async () => {
      return expectStatus(
        await request(`/knowledge-bases/${kbId}`, { method: 'DELETE', token }),
        'delete knowledge base',
      );
    });
  }

  const failed = results.filter((item) => !item.ok);
  console.log('\n联调结果汇总');
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name} ${item.costMs}ms${item.error ? ` - ${item.error}` : ''}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
