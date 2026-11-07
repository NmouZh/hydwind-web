import type { APIRoute } from 'astro';

/**
 * GET /api/health —— 给 systemd / 插件探活用，不需要鉴权。
 * 只报进程是否活着和运行了多久，不泄露任何配置或数据。
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: true, uptime: Math.floor(process.uptime()) }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
