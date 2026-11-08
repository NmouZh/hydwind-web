import type { APIRoute } from 'astro';
import { readAccountFromRequest } from '../../../../../lib/auth.ts';
import { json } from '../../../../../lib/api-response.ts';
import { deleteComment } from '../../../../../lib/biographies.ts';
import { gameIdForSlug, isSameOrigin } from '../../../../../lib/comments.ts';

/** DELETE /api/people/:id/comments/:cid —— 评论作者本人或管理员。 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const account = await readAccountFromRequest(request);
  if (!account) return json({ error: '先登录再删除评论' }, 401);
  if (!isSameOrigin(request)) return json({ error: '请求来源不对' }, 403);

  const gameId = await gameIdForSlug(params.id ?? '');
  if (!gameId || !params.cid) return json({ error: '没有找到这条评论' }, 404);

  const result = await deleteComment(gameId, params.cid, account);
  if (!result.ok) {
    return json({ error: result.message }, result.reason === 'forbidden' ? 403 : 404);
  }
  return json({ deleted: true });
};
