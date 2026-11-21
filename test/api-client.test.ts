import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';

import {
  ApiError,
  apiFetch,
  apiJson,
  apiOrigin,
  apiRequest,
  proxyResponse,
} from '../src/lib/api-client.ts';

/**
 * hydwind-api 客户端的两个接缝：
 * - `apiRequest` 只构造 URL 与请求头（转发 Cookie / Origin / X-Forwarded-*，
 *   去掉 Host / Content-Length），可以用纯断言覆盖；
 * - `apiFetch` / `proxyResponse` 与真实 HTTP 交互一次，确认 302、Set-Cookie、
 *   流式 body 与 JSON 错误都能原样穿过反代。
 */

const ORIGIN_ENV = 'HYDWIND_API_ORIGIN';

const withOrigin = async <T>(origin: string, run: () => Promise<T> | T): Promise<T> => {
  const saved = process.env[ORIGIN_ENV];
  process.env[ORIGIN_ENV] = origin;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env[ORIGIN_ENV];
    else process.env[ORIGIN_ENV] = saved;
  }
};

/** 模拟浏览器发到网站 /gate 的请求：带会话 cookie 与同源 Origin。 */
const browserRequest = (url = 'https://hydwind.example/gate/') =>
  new Request(url, {
    headers: {
      cookie: 'hydwind_session=abc',
      origin: 'https://hydwind.example',
    },
  });

test('apiOrigin 默认指向本地 hydwind-api', () => {
  const saved = process.env[ORIGIN_ENV];
  delete process.env[ORIGIN_ENV];
  try {
    assert.equal(apiOrigin(), 'http://127.0.0.1:8787');
  } finally {
    if (saved !== undefined) process.env[ORIGIN_ENV] = saved;
  }
});

test('apiOrigin 读 HYDWIND_API_ORIGIN 并去掉末尾斜杠', async () => {
  await withOrigin('https://api.example/', () => {
    assert.equal(apiOrigin(), 'https://api.example');
  });
});

test('apiRequest 拼出后端地址并保留查询串', async () => {
  await withOrigin('https://api.example', () => {
    const { url } = apiRequest(
      '/api/people?q=%E7%8E%A9%E5%AE%B6',
      {},
      { request: browserRequest() }
    );
    assert.equal(url, 'https://api.example/api/people?q=%E7%8E%A9%E5%AE%B6');
  });
});

test('apiRequest 拒绝非 /api 路径，避免把任意 URL 交给 fetch', () => {
  assert.throws(
    () => apiRequest('https://evil.example/api/x', {}, { request: browserRequest() }),
    /只允许代理/
  );
});

test('apiRequest 转发 Cookie / Origin / X-Forwarded-*，丢掉 Host 与 Content-Length', async () => {
  const request = new Request('https://hydwind.example/gate/', {
    headers: {
      host: 'evil.example',
      'content-length': '42',
      cookie: 'hydwind_session=abc',
      origin: 'https://hydwind.example',
      'x-forwarded-for': '6.6.6.6',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'http',
    },
  });

  await withOrigin('https://api.example', () => {
    const { init } = apiRequest('/api/gate/codes', {}, {
      request,
      clientAddress: '203.0.113.7',
    });
    const headers = new Headers(init.headers);

    assert.equal(headers.get('host'), null);
    assert.equal(headers.get('content-length'), null);
    assert.equal(headers.get('cookie'), 'hydwind_session=abc');
    assert.equal(headers.get('origin'), 'https://hydwind.example');
    // 客户端自带的 X-Forwarded-* 一律被覆盖，只信服务端解析出的值。
    assert.equal(headers.get('x-forwarded-for'), '203.0.113.7');
    assert.equal(headers.get('x-forwarded-host'), 'hydwind.example');
    assert.equal(headers.get('x-forwarded-proto'), 'https');
  });
});

test('没有 clientAddress 时不伪造 X-Forwarded-For', async () => {
  const request = new Request('https://hydwind.example/people/', {
    headers: { 'x-forwarded-for': '6.6.6.6' },
  });

  await withOrigin('https://api.example', () => {
    const { init } = apiRequest('/api/people', {}, { request });
    assert.equal(new Headers(init.headers).get('x-forwarded-for'), null);
  });
});

test('apiRequest 透传方法与请求体，流式 body 标记 duplex', async () => {
  const request = new Request('https://hydwind.example/api/people/Bob/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://hydwind.example' },
    body: JSON.stringify({ body: '你好' }),
  });

  await withOrigin('https://api.example', () => {
    const { init } = apiRequest(
      '/api/people/Bob/comments',
      {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        duplex: 'half',
      },
      { request }
    );

    assert.equal(init.method, 'POST');
    assert.equal(init.duplex, 'half');
    assert.ok(init.body instanceof ReadableStream);
  });
});

let server: http.Server;
let upstream = '';
let seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string } | null =
  null;

before(async () => {
  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      seen = { method: request.method, url: request.url, headers: request.headers, body };
      const pathname = new URL(request.url ?? '/', 'http://upstream').pathname;

      if (pathname === '/api/redirect') {
        response.writeHead(302, {
          location: '/api/target',
          'cache-control': 'public, max-age=60',
          'content-type': 'text/plain',
          'set-cookie': ['first=1; Path=/; HttpOnly', 'second=2; Path=/'],
        });
        response.end('redirecting');
        return;
      }

      if (pathname === '/api/missing') {
        response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: '没有这个人物' }));
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          ok: true,
          method: request.method,
          url: request.url,
          headers: request.headers,
          body,
        })
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server 没有端口');
  upstream = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('apiFetch 把请求送到后端并保留 302 / Set-Cookie / 缓存头', async () => {
  await withOrigin(upstream, async () => {
    const response = await apiFetch(
      '/api/redirect',
      { redirect: 'manual' },
      { request: browserRequest(), clientAddress: '198.51.100.9' }
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/api/target');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
    assert.deepEqual(response.headers.getSetCookie(), [
      'first=1; Path=/; HttpOnly',
      'second=2; Path=/',
    ]);

    assert.equal(seen?.headers['cookie'], 'hydwind_session=abc');
    assert.equal(seen?.headers['origin'], 'https://hydwind.example');
    assert.equal(seen?.headers['x-forwarded-for'], '198.51.100.9');
    assert.equal(seen?.headers['x-forwarded-host'], 'hydwind.example');
    assert.equal(seen?.headers['x-forwarded-proto'], 'https');
    // fetch 自己会按目标地址设置 Host，不能是浏览器的 Host。
    assert.match(String(seen?.headers['host']), /^127\.0\.0\.1:\d+$/);

    await response.body?.cancel();
  });
});

test('apiFetch 透传 POST body', async () => {
  const request = new Request('https://hydwind.example/api/people/Bob/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://hydwind.example' },
    body: JSON.stringify({ body: '你好' }),
  });

  await withOrigin(upstream, async () => {
    const response = await apiFetch(
      '/api/people/Bob/comments',
      {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        duplex: 'half',
      },
      { request }
    );

    const payload = (await response.json()) as { method: string; body: string };
    assert.equal(payload.method, 'POST');
    assert.equal(payload.body, '{"body":"你好"}');
  });
});

test('apiJson 成功时解析 JSON，非 2xx 抛带 status / body 的 ApiError', async () => {
  await withOrigin(upstream, async () => {
    const context = { request: browserRequest(), clientAddress: '127.0.0.1' };

    const payload = await apiJson<{ ok: boolean }>('/api/health', {}, context);
    assert.equal(payload.ok, true);

    await assert.rejects(
      () => apiJson('/api/missing', {}, context),
      (error) =>
        error instanceof ApiError &&
        error.status === 404 &&
        error.body.includes('没有这个人物')
    );
  });
});

test('proxyResponse 逐条保留 Set-Cookie，去掉传输头并补 no-store', () => {
  const upstreamResponse = new Response('body', {
    status: 302,
    headers: [
      ['location', '/api/target'],
      ['cache-control', 'public, max-age=60'],
      ['content-type', 'text/plain'],
      ['content-encoding', 'gzip'],
      ['content-length', '4'],
      ['set-cookie', 'first=1; Path=/; HttpOnly'],
      ['set-cookie', 'second=2; Path=/'],
    ],
  });

  const proxied = proxyResponse(upstreamResponse);

  assert.equal(proxied.status, 302);
  assert.equal(proxied.headers.get('location'), '/api/target');
  assert.equal(proxied.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(proxied.headers.get('content-type'), 'text/plain');
  assert.equal(proxied.headers.get('content-encoding'), null);
  assert.equal(proxied.headers.get('content-length'), null);
  assert.deepEqual(proxied.headers.getSetCookie(), [
    'first=1; Path=/; HttpOnly',
    'second=2; Path=/',
  ]);

  const uncached = proxyResponse(
    new Response('{}', { headers: { 'content-type': 'application/json' } })
  );
  assert.equal(uncached.headers.get('cache-control'), 'no-store');
});
