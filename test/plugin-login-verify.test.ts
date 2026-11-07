import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { registerAccount } from '../src/lib/accounts.ts';
import { findBiographyByGameId, listGameBiographies, updateBiography } from '../src/lib/biographies.ts';
import { generateLoginCodes } from '../src/lib/login-codes.ts';
import { useEnv } from './helpers.ts';
import { POST } from '../src/pages/api/plugin/login/verify.ts';

/**
 * /api/plugin/login/verify 的契约测试。
 *
 * 直接调用 Astro 路由处理函数，等价于插件发来的 HTTP 请求：走同一套鉴权、
 * 参数校验、登录码校验和账号回查，不需要构建产物，也不会依赖浏览器。
 * 登录码模块的 defaultStore 在测试进程内共享，所以生成码后立刻用同一进程的
 * 路由函数校验，和线上「/gate 生成 → 插件校验」的链路一致。
 */

const PLUGIN_TOKEN = 'plugin-secret-value';
const ADMIN_TOKEN = 'admin-secret-value';
const UUID = '123e4567-e89b-12d3-a456-426614174000';

const ENDPOINT = 'http://localhost/api/plugin/login/verify';

/** 账号存储指到临时目录，避免碰仓库里的 data/。 */
const useTempDataDir = async (t: TestContext): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hydwind-w4-'));
  useEnv(t, { HYDWIND_DATA_DIR: dir });
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
};

interface CallOptions {
  /** 传 null 表示完全不带 Authorization 头 */
  token?: string | null;
  cookie?: string;
  body?: unknown;
  raw?: string;
  /** 传 null 表示不带 content-type */
  contentType?: string | null;
}

interface CallResult {
  status: number;
  body: Record<string, unknown>;
}

const call = async (options: CallOptions = {}): Promise<CallResult> => {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? PLUGIN_TOKEN}`;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.contentType !== null) headers['content-type'] = options.contentType ?? 'application/json';

  const body =
    options.raw ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));

  const request = new Request(ENDPOINT, { method: 'POST', headers, body });
  const response = await POST({ request } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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

test('200：有效插件令牌 + 未使用的码返回账号用户名、昵称与角色', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('AliceW4', { nickname: '爱丽丝', role: 'admin' });
  const { code } = generateLoginCodes({ username: 'AliceW4' });

  // gameId 大小写不敏感；响应里的 username 用账号存储里的原始大小写
  const result = await call({ body: { code, gameId: 'alicew4', uuid: UUID } });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    account: { username: 'AliceW4', nickname: '爱丽丝', role: 'admin' },
  });

  const biography = await findBiographyByGameId('alicew4');
  assert.ok(biography, '首次成功验证应为账号创建传记');
  assert.equal(biography.gameId, 'AliceW4');
  assert.equal(biography.mainTitle, 'AliceW4的人物传记');
  assert.equal(biography.body, '');
  assert.deepEqual(biography.comments, []);
});

test('200：昵称为空时返回账号名，不缺字段', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('BobW4');
  const { fallback } = generateLoginCodes({ username: 'BobW4' });

  const result = await call({ body: { code: fallback, gameId: 'BobW4', uuid: UUID } });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    account: { username: 'BobW4', nickname: 'BobW4', role: 'player' },
  });
});

test('200：同一账号使用新的登录码再次验证时不重复创建或覆盖传记', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('ReturningW4');
  const firstCode = generateLoginCodes({ username: 'ReturningW4' }).code;
  const first = await call({ body: { code: firstCode, gameId: 'ReturningW4', uuid: UUID } });
  assert.equal(first.status, 200);

  const edited = await updateBiography('ReturningW4', {
    mainTitle: '回访玩家的传记',
    body: '已经写好的内容',
  });
  assert.equal(edited.ok, true);

  const nextCode = generateLoginCodes({ username: 'ReturningW4' }).code;
  const second = await call({ body: { code: nextCode, gameId: 'returningw4', uuid: UUID } });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);

  const biographies = await listGameBiographies();
  assert.equal(biographies.length, 1);
  assert.equal(biographies[0].gameId, 'ReturningW4');
  assert.equal(biographies[0].mainTitle, '回访玩家的传记');
  assert.equal(biographies[0].body, '已经写好的内容');
});

test('200：传记写入失败只记录错误，不阻断插件登录验证', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('StorageW4');
  const dir = process.env.HYDWIND_DATA_DIR!;
  // 故意让 biographies.json 成为目录：读取与写入都会失败，而 accounts.json 仍可用。
  // 不依赖 chmod（root 运行 CI/容器时仍可能写入）或内部模块 mock。
  await mkdir(path.join(dir, 'biographies.json'));
  const { code } = generateLoginCodes({ username: 'StorageW4' });

  const errors: unknown[][] = [];
  const previousError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  t.after(() => { console.error = previousError; });
  try {
    const result = await call({ body: { code, gameId: 'StorageW4', uuid: UUID } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      account: { username: 'StorageW4', nickname: 'StorageW4', role: 'player' },
    });
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /biography creation failed/);
  } finally {
    console.error = previousError;
  }
});

test('401：不带令牌、错误令牌、站务令牌都拒绝', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  for (const token of [null, 'wrong-token', ADMIN_TOKEN]) {
    const result = await call({
      token,
      body: { code: 'irrelevant', gameId: 'AliceW4', uuid: UUID },
    });
    assert.equal(result.status, 401, `令牌 ${String(token)} 应被拒绝`);
    assert.deepEqual(result.body, { ok: false, reason: 'unauthorized' });
  }
});

test('401：只带浏览器会话 cookie 不能调用插件接口', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  const result = await call({
    token: null,
    cookie: 'hydwind_session=forged-session-value',
    body: { code: 'irrelevant', gameId: 'AliceW4', uuid: UUID },
  });

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { ok: false, reason: 'unauthorized' });
});

test('401：未配置 PLUGIN_TOKEN 时一律拒绝', async (t) => {
  useEnv(t, { PLUGIN_TOKEN: undefined, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  const result = await call({ token: ADMIN_TOKEN, body: { code: 'x', gameId: 'x', uuid: UUID } });

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { ok: false, reason: 'unauthorized' });
});

test('409：未知码返回 invalid_code', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('InvalidW4');
  const result = await call({
    body: { code: 'definitely-not-a-login-code', gameId: 'InvalidW4', uuid: UUID },
  });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, reason: 'invalid_code' });
});

test('409：过期码返回 expired', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('ExpiredW4');
  // 把生成时间推到 10 分钟前，校验时按真实时间一定过期
  const { code } = generateLoginCodes(
    { username: 'ExpiredW4' },
    { now: () => Date.now() - 10 * 60_000 }
  );

  const result = await call({ body: { code, gameId: 'ExpiredW4', uuid: UUID } });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, reason: 'expired' });
});

test('409：同一码第二次使用返回 used', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('UsedW4');
  const { code, fallback } = generateLoginCodes({ username: 'UsedW4' });

  const first = await call({ body: { code, gameId: 'UsedW4', uuid: UUID } });
  assert.equal(first.status, 200);

  // 颜文字码和 ASCII 备用码绑定同一记录，任一用过后另一个也作废
  const second = await call({ body: { code: fallback, gameId: 'UsedW4', uuid: UUID } });
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { ok: false, reason: 'used' });
});

test('409：游戏 ID 与码绑定的 ID 不符返回 game_id_mismatch', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('MismatchW4');
  const { code } = generateLoginCodes({ username: 'MismatchW4' });

  const result = await call({ body: { code, gameId: 'SomeoneElse', uuid: UUID } });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    ok: false,
    reason: 'game_id_mismatch',
    expectedGameId: 'MismatchW4',
  });
});

test('409：码本身有效但 gameId 与账号 username 不一致，也返回 game_id_mismatch', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  // 账号名是 AccountW4，码却被绑定到另一个游戏 ID；校验码会成功，
  // 但路由层还要确认 gameId 等于账号 username（忽略大小写）
  await createAccount('AccountW4');
  const { code } = generateLoginCodes({ username: 'AccountW4', gameId: 'OtherGame' });

  const result = await call({ body: { code, gameId: 'othergame', uuid: UUID } });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    ok: false,
    reason: 'game_id_mismatch',
    expectedGameId: 'AccountW4',
  });
});

test('409：码有效但账号存储里没有这个账号，按 invalid_code 处理', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  const { code } = generateLoginCodes({ username: 'GhostW4' });

  const result = await call({ body: { code, gameId: 'GhostW4', uuid: UUID } });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, reason: 'invalid_code' });
});

test('409：账号不存在时不烧码，注册后同一个码仍可验证', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  const username = 'LateW4';
  const { code } = generateLoginCodes({ username });

  const before = await call({ body: { code, gameId: username, uuid: UUID } });
  assert.equal(before.status, 409);
  assert.deepEqual(before.body, { ok: false, reason: 'invalid_code' });

  // 账号存在性检查失败发生在 markUsed 之前，码必须保持未使用
  await createAccount(username);
  const after = await call({ body: { code, gameId: username, uuid: UUID } });
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, {
    ok: true,
    account: { username, nickname: username, role: 'player' },
  });
});

test('429：同一游戏 ID 连续失败后返回 rate_limited、retryAfterMs 与 attemptsRemaining', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  await createAccount('RateW4');

  // 模块内默认上限是 5 次 / 5 分钟，前 5 次是 invalid_code，第 6 次才限流
  for (let index = 0; index < 5; index += 1) {
    const failed = await call({
      body: { code: `wrong-code-${index}`, gameId: 'RateW4', uuid: UUID },
    });
    assert.equal(failed.status, 409);
    assert.deepEqual(failed.body, { ok: false, reason: 'invalid_code' });
  }

  const limited = await call({ body: { code: 'wrong-code-6', gameId: 'RateW4', uuid: UUID } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.ok, false);
  assert.equal(limited.body.reason, 'rate_limited');
  assert.equal(typeof limited.body.retryAfterMs, 'number');
  assert.ok((limited.body.retryAfterMs as number) > 0);
  assert.equal(limited.body.attemptsRemaining, 0);
});

test('400/413/415：请求体大小、格式与字段类型都有明确拒绝', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });
  await useTempDataDir(t);

  const nonJson = await call({
    contentType: 'text/plain',
    raw: JSON.stringify({ code: 'x', gameId: 'x', uuid: UUID }),
  });
  assert.equal(nonJson.status, 415);

  const malformed = await call({ raw: '{not json' });
  assert.equal(malformed.status, 400);

  const oversized = await call({ raw: 'x'.repeat(2048) });
  assert.equal(oversized.status, 413);

  for (const body of [
    { code: 123, gameId: 'AliceW4', uuid: UUID },
    { code: 'x', gameId: 42, uuid: UUID },
    { code: 'x', gameId: 'AliceW4', uuid: 'not-a-uuid' },
    { code: 'x', gameId: 'AliceW4' },
  ]) {
    const result = await call({ body });
    assert.equal(result.status, 400, `字段类型错误应返回 400：${JSON.stringify(body)}`);
  }
});