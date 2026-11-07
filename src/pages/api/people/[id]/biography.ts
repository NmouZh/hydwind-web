import type { APIRoute } from 'astro';
import { findAccount } from '../../../../lib/accounts.ts';
import { isJson, json } from '../../../../lib/api-response.ts';
import {
  canEditBiography,
  defaultMainTitle,
  findBiographyByGameId,
  resolvePersonBySlug,
  updateBiography,
  type ResolvedPerson,
  type StaticPersonRef,
} from '../../../../lib/biographies.ts';
import { consumeRateLimit } from '../../../../lib/rate-limit.ts';
import { readSessionFromRequest } from '../../../../lib/session.ts';

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

const MAX_BODY_BYTES = 64 * 1024;
const SAVE_WINDOW_MS = 10 * 60_000;
const SAVE_LIMIT = 12;

/**
 * 静态人物来自 Astro 内容集合。测试环境（node:test）没有 `astro:content`
 * 虚拟模块，动态导入会以 ERR_UNSUPPORTED_ESM_URL_SCHEME 失败；此时退回空列表，
 * 账号 slug 仍能照常解析。生产构建里这个动态导入由 Vite 正常解析。
 */
const loadStaticPeople = async (): Promise<StaticPersonRef[]> => {
  try {
    const { getPublishedPeople } = await import('../../../../lib/content.ts');
    const people = await getPublishedPeople();
    return people.map(({ id, data }) => ({ id, gameId: data.gameId }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME') {
      return [];
    }
    throw error;
  }
};

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

  // 角色以账号文件为准，不信任 cookie 里的旧 role。
  const session = readSessionFromRequest(request);
  const account = session ? await findAccount(session.username) : undefined;
  const canEdit = canEditBiography(
    account ? { username: account.username, role: account.role } : null,
    resolved.gameId
  );

  return json(biographyPayload(resolved, biography, canEdit));
};

export const PUT: APIRoute = async ({ params, request, clientAddress }) => {
  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const session = readSessionFromRequest(request);
  if (!session) return json({ error: '先登录再写传记' }, 401);

  const account = await findAccount(session.username);
  if (!account) return json({ error: '账号已不存在，请重新登录' }, 401);

  const resolved = await resolveSlug(params.id ?? '');
  if (!resolved) return json({ error: '没有这个人物' }, 404);

  // 权限只看「账号 ↔ 目标 gameId」，和传记是否已存在无关：
  // 这样普通登录用户不能抢着创建别人的第一篇。
  if (!canEditBiography({ username: account.username, role: account.role }, resolved.gameId)) {
    return json({ error: '只能编辑自己的传记' }, 403);
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: '请求体太大' }, 413);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: '请求体太大' }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: '请求体格式不对' }, 400);
  }

  const limit = consumeRateLimit(
    `bio:${account.username.toLowerCase()}:${clientAddress ?? '-'}`,
    SAVE_LIMIT,
    SAVE_WINDOW_MS
  );
  if (!limit.ok) {
    return json({ error: '保存太频繁啦，过几分钟再试' }, 429, {
      'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))),
    });
  }

  const { mainTitle, body } = payload as { mainTitle?: unknown; body?: unknown };
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
