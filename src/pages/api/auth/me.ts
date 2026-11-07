import type { APIRoute } from 'astro';
import { findAccount, publicAccount } from '../../../lib/accounts';
import { json } from '../../../lib/api-response.ts';
import { readSessionFromRequest } from '../../../lib/session';

/** GET /api/auth/me → 当前登录账号，未登录返回 401 */
export const GET: APIRoute = async ({ request }) => {
  const session = readSessionFromRequest(request);
  if (!session) return json({ error: '未登录' }, 401);

  const account = await findAccount(session.username);
  if (!account) return json({ error: '账号已不存在' }, 401);
  return json({ account: publicAccount(account) });
};
