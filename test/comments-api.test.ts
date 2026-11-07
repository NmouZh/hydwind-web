import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { registerAccount, setAccountRole } from '../src/lib/accounts.ts';
import { ensureBiographyForAccount } from '../src/lib/biographies.ts';
import { createSessionCookie, SESSION_COOKIE } from '../src/lib/session.ts';
import { GET, POST } from '../src/pages/api/people/[id]/comments.ts';
import { DELETE } from '../src/pages/api/people/[id]/comments/[cid].ts';
import { useEnv } from './helpers.ts';

/** The public seam is the comments HTTP contract, exercised via Astro handlers. */
const setup = async (t: TestContext): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hydwind-comments-'));
  useEnv(t, { HYDWIND_DATA_DIR: dir, SESSION_SECRET: 'comments-api-test-secret' });
  t.after(async () => rm(dir, { recursive: true, force: true }));
};

const account = async (username: string, nickname = '', role: 'player' | 'admin' = 'player') => {
  const result = await registerAccount({
    username,
    nickname,
    role,
    platformId: `qq-${username}`,
  });
  assert.equal(result.ok, true);
};

const cookie = (username: string, role: 'player' | 'admin' = 'player'): string => {
  let value = '';
  const cookies = {
    set: (name: string, token: string) => {
      if (name === SESSION_COOKIE) value = token;
    },
  } as unknown as Parameters<typeof createSessionCookie>[0];
  createSessionCookie(cookies, username, role, false);
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
};

interface Result {
  status: number;
  body: Record<string, any>;
  headers: Headers;
}

const call = async (
  method: 'GET' | 'POST' | 'DELETE',
  slug: string,
  options: { actor?: string; role?: 'player' | 'admin'; payload?: unknown; raw?: string; cid?: string; origin?: string } = {}
): Promise<Result> => {
  const url = `http://localhost/api/people/${slug}/comments${options.cid ? `/${options.cid}` : ''}`;
  const headers: Record<string, string> = {};
  if (options.actor) headers.cookie = cookie(options.actor, options.role);
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (options.origin) headers.origin = options.origin;
  const request = new Request(url, {
    method,
    headers,
    body: method === 'POST' ? options.raw ?? JSON.stringify(options.payload) : undefined,
  });
  const handler = method === 'GET' ? GET : method === 'POST' ? POST : DELETE;
  const response = await handler({
    params: { id: slug, cid: options.cid },
    request,
    clientAddress: '127.0.0.1',
  } as unknown as Parameters<typeof handler>[0]);
  return { status: response.status, body: await response.json(), headers: response.headers };
};

test('游客可按时间正序读取静态人物与账号 slug 的评论；昵称实时回查，缺账号回退游戏 ID', async (t) => {
  await setup(t);
  await account('Nz_173');
  await account('Bob', '小波');
  await account('Carol');
  await ensureBiographyForAccount({ username: 'Nz_173' });

  const first = await call('POST', 'nz-173', { actor: 'Bob', payload: { body: '第一条' } });
  const second = await call('POST', 'nz_173', { actor: 'Carol', payload: { body: '第二条' } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const result = await call('GET', 'nz-173');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.comments, [
    { id: first.body.comment.id, authorGameId: 'Bob', authorDisplay: '小波', body: '第一条', createdAt: first.body.comment.createdAt },
    { id: second.body.comment.id, authorGameId: 'Carol', authorDisplay: 'Carol', body: '第二条', createdAt: second.body.comment.createdAt },
  ]);
  assert.ok(Date.parse(first.body.comment.createdAt) <= Date.parse(second.body.comment.createdAt));
});

test('POST 未登录为 401；空白、非字符串、超 500 字和坏 JSON 为 400，且不占额度', async (t) => {
  await setup(t);
  await account('Host');
  await account('Writer');
  await ensureBiographyForAccount({ username: 'Host' });
  assert.equal((await call('POST', 'host', { payload: { body: '匿名留言' } })).status, 401);
  for (const payload of [{ body: '' }, { body: '  ' }, { body: 12 }, { body: '字'.repeat(501) }]) {
    assert.equal((await call('POST', 'host', { actor: 'Writer', payload })).status, 400);
  }
  assert.equal((await call('POST', 'host', { actor: 'Writer', raw: '{' })).status, 400);
  const valid = await call('POST', 'host', { actor: 'Writer', payload: { body: ' 好 ' } });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.comment.body, '好');
  assert.equal((await call('GET', 'host')).body.comments.length, 1);
});

test('未知 slug 的 GET/POST/DELETE 为 404；传记尚未创建的已注册账号仍可读取空评论', async (t) => {
  await setup(t);
  await account('Writer');
  await account('Pending');
  assert.deepEqual((await call('GET', 'pending')).body.comments, []);
  assert.equal((await call('GET', 'nobody')).status, 404);
  assert.equal((await call('POST', 'nobody', { actor: 'Writer', payload: { body: 'hi' } })).status, 404);
  assert.equal((await call('DELETE', 'nobody', { actor: 'Writer', cid: 'missing' })).status, 404);
});

test('静态人物还没有运行期传记时，POST 先建空传记再添加评论而不是 404', async (t) => {
  await setup(t);
  await account('Writer');

  // nz-173 是内容集合里的静态人物；此时 data/biographies.json 里没有它。
  assert.deepEqual((await call('GET', 'nz-173')).body.comments, []);

  const posted = await call('POST', 'nz-173', {
    actor: 'Writer',
    payload: { body: '给服主留言' },
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.comment.body, '给服主留言');

  const listed = await call('GET', 'nz-173');
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.comments.map((comment: { body: string }) => comment.body),
    ['给服主留言']
  );

  // 已注册但还没有传记记录的账号同样先 ensure 再评论。
  await account('Pending');
  assert.equal(
    (await call('POST', 'pending', { actor: 'Writer', payload: { body: '先建再评' } })).status,
    201
  );
  assert.equal((await call('GET', 'pending')).body.comments.length, 1);
});

test('每账号跨人物 10 分钟最多 5 条，第 6 条 429 且 GET 不含失败的评论', async (t) => {
  await setup(t);
  await account('HostA');
  await account('HostB');
  await account('Chatter');
  await ensureBiographyForAccount({ username: 'HostA' });
  await ensureBiographyForAccount({ username: 'HostB' });
  for (let n = 0; n < 5; n += 1) {
    assert.equal((await call('POST', n % 2 ? 'hostb' : 'hosta', { actor: 'Chatter', payload: { body: `第${n + 1}条` } })).status, 201);
  }
  const limited = await call('POST', 'hostb', { actor: 'Chatter', payload: { body: '第六条' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await call('GET', 'hostb')).body.comments.length, 2);
});

test('DELETE 作者可删，非作者 403，管理员可删；以账号中的实时角色而非 cookie 为准', async (t) => {
  await setup(t);
  await account('Host');
  await account('Author');
  await account('Other');
  await account('Mod', '', 'admin');
  await ensureBiographyForAccount({ username: 'Host' });
  const first = await call('POST', 'host', { actor: 'Author', payload: { body: '我要撤回' } });
  assert.equal(first.status, 201);
  const cid = first.body.comment.id;
  assert.equal((await call('DELETE', 'host', { cid })).status, 401);
  assert.equal((await call('DELETE', 'host', { actor: 'Other', cid })).status, 403);
  assert.equal((await call('DELETE', 'host', { actor: 'Other', role: 'admin', cid })).status, 403);
  assert.equal((await call('DELETE', 'host', { actor: 'Author', cid })).status, 200);
  assert.deepEqual((await call('GET', 'host')).body.comments, []);
  assert.equal((await call('DELETE', 'host', { actor: 'Author', cid })).status, 404);

  const second = await call('POST', 'host', { actor: 'Author', payload: { body: '管理员删' } });
  assert.equal(second.status, 201);
  assert.equal((await call('DELETE', 'host', { actor: 'Mod', role: 'player', cid: second.body.comment.id })).status, 200);
  assert.deepEqual((await call('GET', 'host')).body.comments, []);
  const third = await call('POST', 'host', { actor: 'Author', payload: { body: '降权之后不能删' } });
  assert.equal(third.status, 201);
  assert.equal(await setAccountRole('Mod', 'player'), true);
  assert.equal((await call('DELETE', 'host', { actor: 'Mod', role: 'admin', cid: third.body.comment.id })).status, 403);
});

test('跨站 Origin 的写操作均 403，不能使用登录 cookie 跨站发帖或删除', async (t) => {
  await setup(t);
  await account('Host');
  await account('Author');
  await ensureBiographyForAccount({ username: 'Host' });
  assert.equal((await call('POST', 'host', { actor: 'Author', payload: { body: '跨站' }, origin: 'https://other.example' })).status, 403);
  const posted = await call('POST', 'host', { actor: 'Author', payload: { body: '本人评论' } });
  assert.equal(posted.status, 201);
  assert.equal((await call('DELETE', 'host', { actor: 'Author', cid: posted.body.comment.id, origin: 'https://other.example' })).status, 403);
  assert.equal((await call('GET', 'host')).body.comments.length, 1);
});
