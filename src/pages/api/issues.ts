import type { APIRoute } from 'astro';
import { createIssue, listIssues, validateNewIssue } from '../../lib/issues';
import { isStaffRequest } from '../../lib/auth';
import { json } from '../../lib/api-response.ts';
import { consumeRateLimit } from '../../lib/rate-limit';

/** GET /api/issues —— 匿名只看公开议题，站务额外拿到 pending。 */
export const GET: APIRoute = async ({ request }) => {
  const staff = await isStaffRequest(request);
  const issues = await listIssues({ includePending: staff });

  return new Response(
    JSON.stringify({
      issues: issues.map(({ id, title, author, category, status, createdAt, updatedAt, replies }) => ({
        id,
        title,
        author,
        category,
        status,
        createdAt,
        updatedAt,
        replyCount: replies.length,
      })),
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
};

/** POST /api/issues → 提交新议题，进入 pending 待审队列 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const limit = consumeRateLimit(`issue:${clientAddress ?? 'unknown'}`, 5, 10 * 60_000);
  if (!limit.ok) {
    return json({ error: '提交太频繁啦，休息几分钟再试' }, 429);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const parsed = validateNewIssue(payload as never);
  if (!parsed.ok) return json({ error: parsed.message }, 422);

  const issue = await createIssue(parsed.value);
  return json(
    {
      issue: {
        id: issue.id,
        title: issue.title,
        status: issue.status,
        createdAt: issue.createdAt,
      },
      message: '提交成功，通过审核后会公开在议题列表里',
    },
    201
  );
};
