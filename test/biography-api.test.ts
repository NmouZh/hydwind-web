import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { registerAccount } from '../src/lib/accounts.ts';
import { createSessionCookie, SESSION_COOKIE } from '../src/lib/session.ts';
import { useEnv } from './helpers.ts';
import { GET, PUT } from '../src/pages/api/people/[id]/biography.ts';

/**
 * GET/PUT /api/people/[id]/biography 的 HTTP 契约。
 *
 * 直接调用 Astro 路由处理函数，和浏览器 / 其它调用方走同一套 slug 解析、
 * 会话校验、账号回查与参数校验；只断言响应和持久化后可观察到的结果。
 */

const SECRET = 'test-session-secret-0123456789';

const useTempDataDir = async (t: TestContext): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hydwind-b3-'));
  useEnv(t, { HYDWIND_DATA_DIR: dir, SESSION_SECRET: SECRET });
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
};

const createAccount = async (
  username: string,
  options: { nickname?: string; role?: 'admin' | 'player' } = {}
): Promise<void> => {
  const result = await registerAccount({
    username,
    platformId: `qq-${username}`,
    nickname: options.nickname,
    role: options.role,
  });
  assert.equal(result.ok, true, `测试账号创建失败：${username}`);
};

/** 生成与登录接口一致的签名 cookie；路由会按 username 回查账号，不信任 cookie 里的 role。 */
const sessionCookie = (username: string): string => {
  let token = '';
  const cookies = {
    set: (name: string, value: string) => {
      if (name === SESSION_COOKIE) token = value;
    },
  } as unknown as Parameters<typeof createSessionCookie>[0];
  createSessionCookie(cookies, username, 'player');
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
};

interface CallOptions {
  cookie?: string;
  body?: unknown;
  raw?: string;
  /** 传 null 表示不带 content-type */
  contentType?: string | null;
  /** 浏览器写操作会带 Origin；不传模拟 curl 这类同源豁免调用。 */
  origin?: string;
}

interface CallResult {
  status: number;
  body: Record<string, unknown>;
}

const call = async (
  method: 'GET' | 'PUT',
  slug: string,
  options: CallOptions = {}
): Promise<CallResult> => {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  if (options.contentType !== null) headers['content-type'] = options.contentType ?? 'application/json';

  const requestBody =
    method === 'GET'
      ? undefined
      : options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

  const request = new Request(
    `http://localhost/api/people/${encodeURIComponent(slug)}/biography`,
    { method, headers, body: requestBody }
  );
  const handler = method === 'GET' ? GET : PUT;
  const response = await handler({
    request,
    params: { id: slug },
    clientAddress: '127.0.0.1',
  } as unknown as Parameters<typeof PUT>[0]);

  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const char = (length: number): string => '字'.repeat(length);

test('GET：公开可读；账号还没有记录时返回默认空传记', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');

  const result = await call('GET', 'alice');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    gameId: 'Alice',
    mainTitle: 'Alice的人物传记',
    body: '',
    canEdit: false,
    updatedAt: null,
  });
});

test('GET：本人 canEdit 为 true，其他登录用户与游客为 false', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  await createAccount('Bob');

  const anonymous = await call('GET', 'alice');
  assert.equal(anonymous.body.canEdit, false);

  const owner = await call('GET', 'ALICE', { cookie: sessionCookie('Alice') });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.gameId, 'Alice');
  assert.equal(owner.body.canEdit, true);

  const other = await call('GET', 'alice', { cookie: sessionCookie('Bob') });
  assert.equal(other.status, 200);
  assert.equal(other.body.canEdit, false);
});

test('GET：管理员对任意合法人物 canEdit 为 true', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  await createAccount('Root', { role: 'admin' });

  const result = await call('GET', 'alice', { cookie: sessionCookie('Root') });

  assert.equal(result.status, 200);
  assert.equal(result.body.canEdit, true);
});

test('GET：未知 slug 返回 404', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');

  const result = await call('GET', 'nobody');

  assert.equal(result.status, 404);
  assert.equal(typeof result.body.error, 'string');
});

test('PUT：未登录返回 401，不写任何记录', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');

  const result = await call('PUT', 'alice', { body: { mainTitle: '爱丽丝', body: '你好' } });

  assert.equal(result.status, 401);

  const after = await call('GET', 'alice');
  assert.equal(after.body.updatedAt, null);
});

test('PUT：本人可以创建第一篇，并读回保存后的内容', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');

  const saved = await call('PUT', 'alice', {
    cookie: sessionCookie('Alice'),
    body: { mainTitle: '爱丽丝', body: '你好，世界' },
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.body.gameId, 'Alice');
  assert.equal(saved.body.mainTitle, '爱丽丝');
  assert.equal(saved.body.body, '你好，世界');
  assert.equal(typeof saved.body.updatedAt, 'string');

  const read = await call('GET', 'alice');
  assert.equal(read.status, 200);
  assert.deepEqual(
    {
      gameId: read.body.gameId,
      mainTitle: read.body.mainTitle,
      body: read.body.body,
      updatedAt: read.body.updatedAt,
    },
    {
      gameId: 'Alice',
      mainTitle: '爱丽丝',
      body: '你好，世界',
      updatedAt: saved.body.updatedAt,
    }
  );
});

test('PUT：其他登录用户不能创建别人的第一篇（修复旧权限洞）', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  await createAccount('Bob');

  // Alice 的传记尚不存在，Bob 是普通玩家，必须被拒绝而不是建出一篇
  const denied = await call('PUT', 'alice', {
    cookie: sessionCookie('Bob'),
    body: { mainTitle: '抢注', body: '不是我的传记' },
  });

  assert.equal(denied.status, 403);

  const after = await call('GET', 'alice');
  assert.equal(after.body.mainTitle, 'Alice的人物传记');
  assert.equal(after.body.body, '');
  assert.equal(after.body.updatedAt, null);
});

test('PUT：管理员可以编辑他人传记', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  await createAccount('Root', { role: 'admin' });

  const result = await call('PUT', 'alice', {
    cookie: sessionCookie('Root'),
    body: { mainTitle: '管理员改的标题', body: '整理过的正文' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.mainTitle, '管理员改的标题');
  assert.equal(result.body.body, '整理过的正文');
});

test('PUT：标题 2–40 字、正文 0–4000 字；空标题回退默认标题', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  const cookie = sessionCookie('Alice');

  const tooShort = await call('PUT', 'alice', {
    cookie,
    body: { mainTitle: '一', body: '' },
  });
  assert.equal(tooShort.status, 400);

  const tooLong = await call('PUT', 'alice', {
    cookie,
    body: { mainTitle: char(41), body: '' },
  });
  assert.equal(tooLong.status, 400);

  const bodyTooLong = await call('PUT', 'alice', {
    cookie,
    body: { mainTitle: '爱丽丝', body: char(4001) },
  });
  assert.equal(bodyTooLong.status, 400);

  const cleared = await call('PUT', 'alice', {
    cookie,
    body: { mainTitle: '   ', body: '' },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.mainTitle, 'Alice的人物传记');
  assert.equal(cleared.body.body, '');

  // 边界值可以保存
  const maxTitle = await call('PUT', 'alice', {
    cookie,
    body: { mainTitle: char(40), body: char(4000) },
  });
  assert.equal(maxTitle.status, 200);
});

test('PUT：非 JSON、坏 JSON、非对象请求体分别返回 415 / 400', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  const cookie = sessionCookie('Alice');

  const wrongType = await call('PUT', 'alice', {
    cookie,
    contentType: 'text/plain',
    raw: JSON.stringify({ mainTitle: '爱丽丝', body: '' }),
  });
  assert.equal(wrongType.status, 415);

  const malformed = await call('PUT', 'alice', { cookie, raw: '{not json' });
  assert.equal(malformed.status, 400);

  const notObject = await call('PUT', 'alice', { cookie, raw: '"hello"' });
  assert.equal(notObject.status, 400);
});

test('PUT：已登录但 slug 不存在返回 404', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');

  const result = await call('PUT', 'nobody', {
    cookie: sessionCookie('Alice'),
    body: { mainTitle: '爱丽丝', body: '' },
  });

  assert.equal(result.status, 404);
});

test('PUT：跨站 Origin 返回 403，不能借登录 cookie 改传记', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  const cookie = sessionCookie('Alice');

  const crossed = await call('PUT', 'alice', {
    cookie,
    origin: 'https://evil.example',
    body: { mainTitle: '跨站写入', body: '不应成功' },
  });
  assert.equal(crossed.status, 403);

  const after = await call('GET', 'alice');
  assert.equal(after.body.updatedAt, null);
  assert.equal(after.body.body, '');

  // 同源 Origin 与没有 Origin 的调用（curl / 服务端）照常放行。
  const sameOrigin = await call('PUT', 'alice', {
    cookie,
    origin: 'http://localhost',
    body: { mainTitle: '同源写入', body: '可以成功' },
  });
  assert.equal(sameOrigin.status, 200);
});

test('PUT：正文首尾的空行原样保留，只在判断空正文和长度时 trim', async (t) => {
  await useTempDataDir(t);
  await createAccount('Alice');
  const cookie = sessionCookie('Alice');
  const body = '\n\n第一段\n\n第二段\n\n';

  const saved = await call('PUT', 'alice', {
    cookie,
    body: { mainTitle: '爱丽丝', body },
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.body.body, body);

  const read = await call('GET', 'alice');
  assert.equal(read.body.body, body);
});