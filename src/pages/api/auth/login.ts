import type { APIRoute } from 'astro';
import { publicAccount, verifyLogin } from '../../../lib/accounts';
import { consumeRateLimit } from '../../../lib/rate-limit';
import { createSessionCookie } from '../../../lib/session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** POST /api/auth/login  body: { username, password } */
export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const limit = consumeRateLimit(`login:${clientAddress ?? 'unknown'}`, 10, 10 * 60_000);
  if (!limit.ok) return json({ error: '尝试太多次了，过几分钟再来' }, 429);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const username = typeof payload.username === 'string' ? payload.username : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!username || !password) return json({ error: '账号和密码都要填' }, 400);

  const account = await verifyLogin(username, password);
  if (!account) return json({ error: '账号或密码不对' }, 401);

  createSessionCookie(cookies, account.username, account.role);
  return json({ account: publicAccount(account) });
};
