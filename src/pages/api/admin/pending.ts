import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-response.ts';
import { listIssues } from '../../../lib/issues';
import { requireAdmin } from '../../../lib/auth';

/**
 * GET /api/admin/pending —— 给 AstrBot 插件轮询用。
 * 只返回待审队列，插件拿到后发到群里等「通过 / 驳回」。
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const issues = await listIssues({ includePending: true });
  const pending = issues.filter((issue) => issue.status === 'pending');

  return json({ pending });
};
