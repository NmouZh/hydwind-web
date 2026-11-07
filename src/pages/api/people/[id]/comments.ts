import type { APIRoute } from 'astro';
import { findAccount } from '../../../../lib/accounts.ts';
import { isJson, json } from '../../../../lib/api-response.ts';
import { addComment, findBiographyByGameId, listComments } from '../../../../lib/biographies.ts';
import { gameIdForSlug, isSameOrigin, presentComment } from '../../../../lib/comments.ts';
import { readSessionFromRequest } from '../../../../lib/session.ts';

/**
 * GET /api/people/:id/comments —— 公开读取评论，按创建时间正序。
 *
 * slug 与人物页一致：静态人物 entry id 优先，其次账号 username（忽略大小写）。
 */
export const GET: APIRoute = async ({ params }) => {
  const gameId = await gameIdForSlug(params.id ?? '');
  if (!gameId) return json({ error: '没有这个人物' }, 404);

  const comments = await listComments(gameId);
  return json({ comments: await Promise.all(comments.map(presentComment)) });
};

const MAX_BODY_BYTES = 2048;

/** POST /api/people/:id/comments —— 登录玩家发评论，每账号 10 分钟 5 条。 */
export const POST: APIRoute = async ({ params, request }) => {
  const session = readSessionFromRequest(request);
  if (!session) return json({ error: '先登录再发表评论' }, 401);
  const account = await findAccount(session.username);
  if (!account) return json({ error: '账号已不存在，请重新登录' }, 401);
  if (!isSameOrigin(request)) return json({ error: '请求来源不对' }, 403);

  const gameId = await gameIdForSlug(params.id ?? '');
  if (!gameId) return json({ error: '没有这个人物' }, 404);

  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: '请求体太大' }, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return json({ error: '请求体太大' }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: '请求体格式不对' }, 400);
  }

  const result = await addComment(
    gameId,
    { username: account.username },
    (payload as { body?: unknown }).body
  );
  if (!result.ok) {
    if (result.reason === 'rate_limited') {
      return json({ error: result.message }, 429, {
        'retry-after': String(Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000))),
      });
    }
    return json({ error: result.message }, result.reason === 'not_found' ? 404 : 400);
  }
  return json({ comment: await presentComment(result.value) }, 201);
};
