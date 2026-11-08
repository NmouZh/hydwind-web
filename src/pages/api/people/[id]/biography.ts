import type { APIRoute } from 'astro';
import { findAccount } from '../../../../lib/accounts.ts';
import { readAccountFromRequest } from '../../../../lib/auth.ts';
import { isJson, json, readJsonObject } from '../../../../lib/api-response.ts';
import {
  canEditBiography,
  defaultMainTitle,
  findBiographyByGameId,
  resolvePersonBySlug,
  updateBiography,
  type ResolvedPerson,
} from '../../../../lib/biographies.ts';
import { isSameOrigin } from '../../../../lib/comments.ts';
import { clientIpKey } from '../../../../lib/client-ip.ts';
import { consumeRateLimit } from '../../../../lib/rate-limit.ts';
import { loadStaticPeople } from '../../../../lib/static-people.ts';

/**
 * GET/PUT /api/people/[id]/biography
 *
 * `[id]` 是 slug：静态人物 entry id 优先（`/people/nz-173/` 保持不变），
 * 其次匹配账号 username（忽略大小写）。传记按账号 gameId 存，一个玩家一篇。
 *
 * GET 公开：返回 gameId / mainTitle / body / canEdit / updatedAt。合法人物或
 * 账号还没写传记时返回默认空传记而不是 404，页面可以直接显示空状态。
 * PUT 仅本人或管理员；校验标题 2–40、正文 0–4000，所有错误都在这里分层。
 */

// 正文上限 4000 字，按 4 字节/字 + JSON 转义留空间。
const MAX_BODY_BYTES = 32 * 1024;
const SAVE_WINDOW_MS = 10 * 60_000;
const SAVE_LIMIT = 12;

/**
 * 静态人物列表统一从 `lib/static-people.ts` 读取。它在 node:test 里直接解析
 * `src/content/people` 的 frontmatter，和生产构建看到的是同一份人物。
 */
const resolveSlug = async (slug: string): Promise<ResolvedPerson | null> =>
  resolvePersonBySlug(slug, {
    staticPeople: await loadStaticPeople(),
    findAccount,
  });

const biographyPayload = (
  resolved: ResolvedPerson,
  biography: Awaited<ReturnType<typeof findBiographyByGameId>>,
  canEdit: boolean
) => ({
  gameId: resolved.gameId,
  mainTitle: biography?.mainTitle ?? defaultMainTitle(resolved.gameId),
  body: biography?.body ?? '',
  canEdit,
  updatedAt: biography?.updatedAt ?? null,
});

export const GET: APIRoute = async ({ params, request }) => {
  const resolved = await resolveSlug(params.id ?? '');
  if (!resolved) return json({ error: '没有这个人物' }, 404);

  const biography = await findBiographyByGameId(resolved.gameId);

  // 角色以账号文件为准，不信任 cookie 里的旧 role；会话代际也必须一致。
  const account = await readAccountFromRequest(request);
  const canEdit = canEditBiography(
    account ? { username: account.username, role: account.role } : null,
    resolved.gameId
  );

  return json(biographyPayload(resolved, biography, canEdit));
};

export const PUT: APIRoute = async ({ params, request, clientAddress }) => {
  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const account = await readAccountFromRequest(request);
  if (!account) return json({ error: '先登录再写传记' }, 401);

  // 与评论写接口一致：带 Origin 的浏览器请求必须同源，防止借登录态跨站写。
  if (!isSameOrigin(request)) return json({ error: '请求来源不对' }, 403);

  const resolved = await resolveSlug(params.id ?? '');
  if (!resolved) return json({ error: '没有这个人物' }, 404);

  // 权限只看「账号 ↔ 目标 gameId」，和传记是否已存在无关：
  // 这样普通登录用户不能抢着创建别人的第一篇。
  if (!canEditBiography({ username: account.username, role: account.role }, resolved.gameId)) {
    return json({ error: '只能编辑自己的传记' }, 403);
  }

  const parsed = await readJsonObject(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const limit = consumeRateLimit(
    `bio:${account.username.toLowerCase()}:${clientIpKey(clientAddress)}`,
    SAVE_LIMIT,
    SAVE_WINDOW_MS
  );
  if (!limit.ok) {
    return json({ error: '保存太频繁啦，过几分钟再试' }, 429, {
      'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))),
    });
  }

  const { mainTitle, body } = parsed.value;
  const saved = await updateBiography(resolved.gameId, { mainTitle, body });
  if (!saved.ok) return json({ error: saved.message }, 400);

  return json({
    gameId: saved.value.gameId,
    mainTitle: saved.value.mainTitle,
    body: saved.value.body,
    canEdit: true,
    updatedAt: saved.value.updatedAt,
    message: '传记保存好了',
  });
};
