import type { APIRoute } from 'astro';
import { getIssue, isIssueStatus, updateIssueStatus } from '../../../lib/issues';
import { isStaffRequest } from '../../../lib/auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const requireStaff = async (request: Request): Promise<Response | null> =>
  (await isStaffRequest(request)) ? null : json({ error: '需要站务权限' }, 401);

const parseId = (raw: string | undefined): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** GET /api/issues/:id */
export const GET: APIRoute = async ({ params, request }) => {
  const id = parseId(params.id);
  if (id === null) return json({ error: '议题编号不合法' }, 400);

  const issue = await getIssue(id);
  // 待审议题对外不可见，避免未审核内容被直接访问
  if (!issue || (issue.status === 'pending' && !(await isStaffRequest(request)))) {
    return json({ error: '议题不存在' }, 404);
  }
  return json({ issue });
};

/** PATCH /api/issues/:id { status } —— 站务改状态（通过 / 驳回 / 完成） */
export const PATCH: APIRoute = async ({ params, request }) => {
  const denied = await requireStaff(request);
  if (denied) return denied;

  const id = parseId(params.id);
  if (id === null) return json({ error: '议题编号不合法' }, 400);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const status = (payload as { status?: unknown })?.status;
  if (!isIssueStatus(status)) {
    return json({ error: '状态必须是 pending / open / rejected / done' }, 422);
  }

  const issue = await updateIssueStatus(id, status);
  if (!issue) return json({ error: '议题不存在' }, 404);
  return json({ issue });
};
