import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-response.ts';
import { clearSessionCookie } from '../../../lib/session';

/** POST /api/auth/logout */
export const POST: APIRoute = async ({ cookies }) => {
  clearSessionCookie(cookies);
  return json({ ok: true });
};
