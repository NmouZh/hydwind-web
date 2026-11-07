import type { APIRoute } from 'astro';
import { addIssueReply, getIssue } from '../../../../lib/issues';
import { isStaffRequest } from '../../../../lib/auth';
import { json } from '../../../../lib/api-response.ts';

/** POST /api/issues/:id/replies —— 站务回复，插件在群里发的进展也走这里 */
export const POST: APIRoute = async ({ params, request }) => {
  if (!(await isStaffRequest(request))) {
    return json({ error: '需要站务权限' }, 401);
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: '议题编号不合法' }, 400);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const body = String((payload as { body?: unknown })?.body ?? '').trim();
  const author = String((payload as { author?: unknown })?.author ?? '氢风站务').trim().slice(0, 32);
  if (body.length < 1 || body.length > 1000) {
    return json({ error: '回复内容需要在 1–1000 字之间' }, 422);
  }

  const issue = await addIssueReply(id, { author: author || '氢风站务', body, staff: true });
  if (!issue) return json({ error: '议题不存在' }, 404);
  return json({ issue }, 201);
};

export const GET: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: '议题编号不合法' }, 400);

  const issue = await getIssue(id);
  if (!issue) return json({ error: '议题不存在' }, 404);
  // 待审议题对外不可见：正文 404，回复也必须 404，不能因为“有回复”反而公开
  if (issue.status === 'pending' && !(await isStaffRequest(request))) {
    return json({ error: '议题不存在' }, 404);
  }
  return json({ replies: issue.replies });
};
