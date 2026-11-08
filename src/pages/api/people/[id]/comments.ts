import type { APIRoute } from 'astro';
import { readAccountFromRequest } from '../../../../lib/auth.ts';
import { isJson, json, readJsonObject } from '../../../../lib/api-response.ts';
import {
  addComment,
  ensureBiographyForAccount,
  listComments,
} from '../../../../lib/biographies.ts';
import { gameIdForSlug, isSameOrigin, presentComment } from '../../../../lib/comments.ts';

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

const MAX_BODY_BYTES = 4 * 1024;

/** POST /api/people/:id/comments —— 登录玩家发评论，每账号 10 分钟 5 条。 */
export const POST: APIRoute = async ({ params, request }) => {
  const account = await readAccountFromRequest(request);
  if (!account) return json({ error: '先登录再发表评论' }, 401);
  if (!isSameOrigin(request)) return json({ error: '请求来源不对' }, 403);

  const gameId = await gameIdForSlug(params.id ?? '');
  if (!gameId) return json({ error: '没有这个人物' }, 404);

  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const parsed = await readJsonObject(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  // 静态人物或账号可能还没有运行期传记记录（传记按账号存，静态人物资料
  // 在内容集合里）。评论嵌在传记记录里，所以先 ensure 一份空传记再追加。
  await ensureBiographyForAccount({ username: gameId });

  const result = await addComment(
    gameId,
    { username: account.username },
    parsed.value.body
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
