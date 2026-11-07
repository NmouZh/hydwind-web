import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { registerAccount } from '../src/lib/accounts.ts';
import {
  addComment,
  canEditBiography,
  defaultMainTitle,
  deleteComment,
  ensureBiographyForAccount,
  findBiographyByGameId,
  listComments,
  listGameBiographies,
  migrateBiographyOwner,
  resolvePersonBySlug,
  updateBiography,
  validateBiographyBody,
  validateCommentBody,
  validateMainTitle,
  COMMENT_RATE_LIMIT,
  MAX_BIO_BODY,
  MAX_BIO_TITLE,
  MAX_COMMENT_BODY,
  MIN_BIO_TITLE,
} from '../src/lib/biographies.ts';
import { useEnv } from './helpers.ts';

/**
 * 传记领域模型与存储。
 *
 * 接缝是导航层的公开函数：创建/读取/更新传记、评论、权限、slug 解析和
 * username 迁移。测试只通过函数观察持久化后的行为，不碰 JSON 内部结构。
 */

const useTempDataDir = async (t: TestContext): Promise<void> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hydwind-b1-'));
  useEnv(t, { HYDWIND_DATA_DIR: dir });
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
};

const char = (length: number): string => '字'.repeat(length);

test('ensureBiographyForAccount 创建默认传记：默认标题、空正文、空评论', async (t) => {
  await useTempDataDir(t);

  const biography = await ensureBiographyForAccount({ username: 'Alice' });

  assert.equal(biography.gameId, 'Alice');
  assert.equal(biography.mainTitle, 'Alice的人物传记');
  assert.equal(biography.body, '');
  assert.deepEqual(biography.comments, []);
  assert.ok(!Number.isNaN(Date.parse(biography.createdAt)));
  assert.ok(!Number.isNaN(Date.parse(biography.updatedAt)));
});

test('ensureBiographyForAccount 幂等，且账号名比较忽略大小写', async (t) => {
  await useTempDataDir(t);

  const first = await ensureBiographyForAccount({ username: 'Alice' });
  const second = await ensureBiographyForAccount({ username: 'alice' });
  const third = await ensureBiographyForAccount({ username: 'ALICE' });

  assert.equal(second.createdAt, first.createdAt);
  assert.equal(third.createdAt, first.createdAt);
  // 保留第一次写入时的原始大小写，不把已有键改来改去
  assert.equal(second.gameId, 'Alice');

  const all = await listGameBiographies();
  assert.equal(all.length, 1);
});

test('canEditBiography 权限矩阵：管理员任意、本人忽略大小写、其他人一律拒绝', async (t) => {
  await useTempDataDir(t);

  const owner = { username: 'Alice', role: 'player' };
  const other = { username: 'Bob', role: 'player' };
  const admin = { username: 'Root', role: 'admin' };

  assert.equal(canEditBiography(owner, 'Alice'), true);
  assert.equal(canEditBiography(owner, 'alice'), true);
  assert.equal(canEditBiography(owner, 'ALICE'), true);
  assert.equal(canEditBiography(other, 'Alice'), false);
  assert.equal(canEditBiography(admin, 'Anyone'), true);
  assert.equal(canEditBiography(null, 'Alice'), false);
});

test('canEditBiography 不再放行「传记尚不存在」时的任意登录用户', async (t) => {
  await useTempDataDir(t);

  // 没有调用 ensureBiographyForAccount，Alice 的传记确实不存在
  assert.equal(await findBiographyByGameId('Alice'), null);
  assert.equal(canEditBiography({ username: 'Bob', role: 'player' }, 'Alice'), false);
  // 本人仍然可以创建第一篇
  assert.equal(canEditBiography({ username: 'alice', role: 'player' }, 'Alice'), true);
});

test('主标题校验：2–40 字，空串回退默认标题', () => {
  assert.equal(defaultMainTitle('Alice'), 'Alice的人物传记');

  assert.deepEqual(validateMainTitle('人物', 'Alice'), { ok: true, value: '人物' });
  assert.deepEqual(validateMainTitle(char(MAX_BIO_TITLE), 'Alice'), {
    ok: true,
    value: char(MAX_BIO_TITLE),
  });

  for (const input of ['', '   ', undefined, null]) {
    assert.deepEqual(validateMainTitle(input, 'Alice'), {
      ok: true,
      value: 'Alice的人物传记',
    });
  }

  assert.equal(validateMainTitle(char(MIN_BIO_TITLE - 1), 'Alice').ok, false);
  assert.equal(validateMainTitle(char(MAX_BIO_TITLE + 1), 'Alice').ok, false);
  assert.equal(validateMainTitle(42, 'Alice').ok, false);
  // 去掉首尾空白后再算长度
  assert.deepEqual(validateMainTitle('  人物  ', 'Alice'), { ok: true, value: '人物' });
});

test('正文校验：0–4000 字，空正文合法，超长报错', () => {
  assert.deepEqual(validateBiographyBody(''), { ok: true, value: '' });
  assert.deepEqual(validateBiographyBody(char(MAX_BIO_BODY)), {
    ok: true,
    value: char(MAX_BIO_BODY),
  });
  assert.equal(validateBiographyBody(char(MAX_BIO_BODY + 1)).ok, false);
  assert.equal(validateBiographyBody(undefined).ok, false);
  assert.equal(validateBiographyBody(123).ok, false);
});

test('正文校验保留首尾空行，只在判断空正文和长度时 trim', async (t) => {
  await useTempDataDir(t);

  const body = '\n\n第一段\n\n第二段\n\n';
  const validated = validateBiographyBody(body);
  assert.equal(validated.ok, true);
  if (validated.ok) assert.equal(validated.value, body);

  // 纯空白仍然按「空正文」处理，但存进去的值不被 trim 改写。
  const blank = '\n\n  \n';
  assert.deepEqual(validateBiographyBody(blank), { ok: true, value: blank });

  // 长度上限按去掉首尾空白后的内容算，正文本身原样保存。
  const padded = `\n\n${char(MAX_BIO_BODY)}\n\n`;
  const stored = await updateBiography('Alice', { mainTitle: '爱丽丝', body: padded });
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  assert.equal(stored.value.body, padded);

  const read = await findBiographyByGameId('Alice');
  assert.equal(read?.body, padded);
});

test('评论校验：1–500 字，空白不合法', () => {
  assert.deepEqual(validateCommentBody('好'), { ok: true, value: '好' });
  assert.deepEqual(validateCommentBody(char(MAX_COMMENT_BODY)), {
    ok: true,
    value: char(MAX_COMMENT_BODY),
  });
  for (const input of ['', '   ', undefined, null]) {
    assert.equal(validateCommentBody(input).ok, false);
  }
  assert.equal(validateCommentBody(char(MAX_COMMENT_BODY + 1)).ok, false);
});

test('updateBiography 保存标题和正文，主标题空串回退默认值', async (t) => {
  await useTempDataDir(t);
  const created = await ensureBiographyForAccount({ username: 'Alice' });

  const updated = await updateBiography('alice', { mainTitle: '爱丽丝', body: '你好' });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;

  assert.equal(updated.value.gameId, 'Alice');
  assert.equal(updated.value.mainTitle, '爱丽丝');
  assert.equal(updated.value.body, '你好');
  assert.equal(updated.value.createdAt, created.createdAt);

  const cleared = await updateBiography('Alice', { mainTitle: '  ', body: '' });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.value.mainTitle, 'Alice的人物传记');
  assert.equal(cleared.value.body, '');
});

test('updateBiography 拒绝过短标题和超长正文', async (t) => {
  await useTempDataDir(t);
  await ensureBiographyForAccount({ username: 'Alice' });

  const badTitle = await updateBiography('Alice', { mainTitle: '一', body: '' });
  assert.equal(badTitle.ok, false);

  const badBody = await updateBiography('Alice', {
    mainTitle: '爱丽丝',
    body: char(MAX_BIO_BODY + 1),
  });
  assert.equal(badBody.ok, false);

  // 失败的校验不会写入半成品
  const stored = await findBiographyByGameId('Alice');
  assert.equal(stored?.mainTitle, 'Alice的人物传记');
  assert.equal(stored?.body, '');
});

test('addComment 记录作者信息，listComments 按创建顺序返回', async (t) => {
  await useTempDataDir(t);
  await ensureBiographyForAccount({ username: 'Host' });

  const first = await addComment('Host', { username: 'Bob' }, '第一条');
  const second = await addComment('host', { username: 'Carol' }, '第二条');

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.authorUsername, 'Bob');
  assert.equal(first.value.authorGameId, 'Bob');
  assert.equal(second.value.authorUsername, 'Carol');
  // 作者游戏 ID 直接取账号 username，不再接受额外的兼容字段。
  assert.equal(second.value.authorGameId, 'Carol');
  assert.notEqual(first.value.id, second.value.id);

  const comments = await listComments('HOST');
  assert.deepEqual(
    comments.map((comment) => comment.body),
    ['第一条', '第二条']
  );
});

test('评论限流：每账号 10 分钟最多 5 条，第 6 条返回 rate_limited', async (t) => {
  await useTempDataDir(t);
  await ensureBiographyForAccount({ username: 'Host' });

  for (let index = 0; index < COMMENT_RATE_LIMIT; index += 1) {
    const added = await addComment('Host', { username: 'FastChatter' }, `第 ${index} 条`);
    assert.equal(added.ok, true, `第 ${index + 1} 条应成功`);
  }

  const limited = await addComment('Host', { username: 'FastChatter' }, '超限');
  assert.equal(limited.ok, false);
  if (limited.ok) return;
  assert.equal(limited.reason, 'rate_limited');
  assert.ok((limited.retryAfterMs ?? 0) > 0);
  assert.equal((await listComments('Host')).length, COMMENT_RATE_LIMIT);
});

test('deleteComment 只允许作者本人和管理员', async (t) => {
  await useTempDataDir(t);
  await ensureBiographyForAccount({ username: 'Host' });

  const added = await addComment('Host', { username: 'Bob' }, '说错话了');
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const denied = await deleteComment('Host', added.value.id, {
    username: 'Carol',
    role: 'player',
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, 'forbidden');

  const byAuthor = await deleteComment('Host', added.value.id, {
    username: 'bob',
    role: 'player',
  });
  assert.equal(byAuthor.ok, true);
  assert.equal((await listComments('Host')).length, 0);

  const second = await addComment('Host', { username: 'Bob' }, '再试一次');
  if (!second.ok) assert.fail('第二条评论应创建成功');
  const byAdmin = await deleteComment('Host', second.value.id, {
    username: 'Root',
    role: 'admin',
  });
  assert.equal(byAdmin.ok, true);
});

test('resolvePersonBySlug 先匹配静态人物 entry id，再匹配账号 username', async (t) => {
  await useTempDataDir(t);

  const staticFirst = {
    staticPeople: [{ id: 'alice', gameId: 'AliceStatic' }],
    findAccount: async (username: string) =>
      username.toLowerCase() === 'alice' ? { username: 'Alice' } : undefined,
  };

  const matchedStatic = await resolvePersonBySlug('alice', staticFirst);
  assert.deepEqual(matchedStatic, {
    slug: 'alice',
    gameId: 'AliceStatic',
    source: 'static',
    personId: 'alice',
  });

  const accounts = new Map([['bob', { username: 'Bob' }]]);
  const accountOnly = {
    staticPeople: [{ id: 'nz-173', gameId: 'Nz_173' }],
    findAccount: async (username: string) => accounts.get(username.toLowerCase()),
  };

  assert.deepEqual(await resolvePersonBySlug('BOB', accountOnly), {
    slug: 'bob',
    gameId: 'Bob',
    source: 'account',
  });

  // 静态 id 匹配不到、账号也没有时返回 null
  assert.equal(await resolvePersonBySlug('nobody', accountOnly), null);
  assert.equal(await resolvePersonBySlug('', accountOnly), null);
});

test('migrateBiographyOwner 重命名传记键并同步评论作者信息', async (t) => {
  await useTempDataDir(t);

  await ensureBiographyForAccount({ username: 'OldPilot' });
  await ensureBiographyForAccount({ username: 'Host' });
  const comment = await addComment('Host', { username: 'OldPilot' }, '旧账号的留言');
  assert.equal(comment.ok, true);

  const result = await migrateBiographyOwner('OldPilot', 'NewPilot');
  assert.equal(result.migrated, true);
  assert.equal(result.commentsUpdated, 1);

  assert.equal(await findBiographyByGameId('OldPilot'), null);
  const moved = await findBiographyByGameId('newpilot');
  assert.equal(moved?.gameId, 'NewPilot');

  const [updatedComment] = await listComments('Host');
  assert.equal(updatedComment.authorUsername, 'NewPilot');
  assert.equal(updatedComment.authorGameId, 'NewPilot');
});

test('migrateBiographyOwner 同步默认主标题，自定义标题保持不动', async (t) => {
  await useTempDataDir(t);

  // 旧主标题就是旧默认标题 → 跟着账号名改成新默认标题。
  await ensureBiographyForAccount({ username: 'OldPilot' });
  const defaultMigrated = await migrateBiographyOwner('OldPilot', 'NewPilot');
  assert.equal(defaultMigrated.migrated, true);
  const movedDefault = await findBiographyByGameId('NewPilot');
  assert.equal(movedDefault?.mainTitle, 'NewPilot的人物传记');

  // 自定义标题属于作者内容，不跟着改。
  await ensureBiographyForAccount({ username: 'Custom' });
  const custom = await updateBiography('Custom', {
    mainTitle: '我自己起的标题',
    body: '正文',
  });
  assert.equal(custom.ok, true);
  const customMigrated = await migrateBiographyOwner('Custom', 'Renamed');
  assert.equal(customMigrated.migrated, true);
  const movedCustom = await findBiographyByGameId('Renamed');
  assert.equal(movedCustom?.mainTitle, '我自己起的标题');
});

test('registerAccount 改用户名时迁移传记键', async (t) => {
  await useTempDataDir(t);

  const first = await registerAccount({ username: 'OldPilot', platformId: 'qq-10001' });
  assert.equal(first.ok, true);
  await ensureBiographyForAccount({ username: 'OldPilot' });

  // 同一个平台身份重新注册，账号名换成新游戏 ID
  const renamed = await registerAccount({ username: 'NewPilot', platformId: 'qq-10001' });
  assert.equal(renamed.ok, true);

  assert.equal(await findBiographyByGameId('OldPilot'), null);
  assert.equal((await findBiographyByGameId('NewPilot'))?.gameId, 'NewPilot');
});