import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-response.ts';
import { isSameOriginRequest } from '../../../lib/same-origin.ts';
import { clearSessionCookie } from '../../../lib/session';

/** POST /api/auth/logout */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOriginRequest(request)) return json({ error: '请求来源不对' }, 403);
  clearSessionCookie(cookies);
  return json({ ok: true });
};
