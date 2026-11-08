import type { APIRoute } from 'astro';
import { createIssue, listIssues, validateNewIssue } from '../../lib/issues.ts';
import { isStaffRequest } from '../../lib/auth.ts';
import { isJson, json, readJsonObject } from '../../lib/api-response.ts';
import { clientIpKey } from '../../lib/client-ip.ts';
import { consumeRateLimit } from '../../lib/rate-limit.ts';

// 标题 80 + 描述 2000 字；按 4 字节/字和 JSON 开销留足空间。
const MAX_BODY_BYTES = 16 * 1024;

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
  if (!isJson(request)) return json({ error: '请求体必须是 JSON' }, 415);

  const limit = consumeRateLimit(`issue:${clientIpKey(clientAddress)}`, 5, 10 * 60_000);
  if (!limit.ok) {
    return json({ error: '提交太频繁啦，休息几分钟再试' }, 429, {
      'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))),
    });
  }

  const parsed = await readJsonObject(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const validated = validateNewIssue(parsed.value as never);
  if (!validated.ok) return json({ error: validated.message }, 422);

  const issue = await createIssue(validated.value);
  if (!issue) {
    return json({ error: '议题区暂时满了，等站务清理后再试' }, 503);
  }
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
