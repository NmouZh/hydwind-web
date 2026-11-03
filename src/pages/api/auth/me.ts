import type { APIRoute } from 'astro';
import { findAccount, publicAccount } from '../../../lib/accounts';
import { readSessionFromRequest } from '../../../lib/session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** GET /api/auth/me → 当前登录账号，未登录返回 401 */
export const GET: APIRoute = async ({ request }) => {
  const session = readSessionFromRequest(request);
  if (!session) return json({ error: '未登录' }, 401);

  const account = await findAccount(session.username);
  if (!account) return json({ error: '账号已不存在' }, 401);
  return json({ account: publicAccount(account) });
};
