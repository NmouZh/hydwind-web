import type { APIRoute } from 'astro';
import { publicAccount } from '../../../lib/accounts.ts';
import { json } from '../../../lib/api-response.ts';
import { readAccountFromRequest } from '../../../lib/auth.ts';

/** GET /api/auth/me → 当前登录账号，未登录或会话已失效返回 401 */
export const GET: APIRoute = async ({ request }) => {
  const account = await readAccountFromRequest(request);
  if (!account) return json({ error: '未登录' }, 401);
  return json({ account: publicAccount(account) });
};
