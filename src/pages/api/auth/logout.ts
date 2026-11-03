import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/session';

/** POST /api/auth/logout */
export const POST: APIRoute = async ({ cookies }) => {
  clearSessionCookie(cookies);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
