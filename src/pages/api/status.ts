import type { APIRoute } from 'astro';
import { getSite } from '../../lib/content.ts';
import { fetchServerStatus } from '../../lib/server-status.ts';

/** GET /api/status → 当前服务器在线状态（带 60s 服务端缓存） */
export const GET: APIRoute = async () => {
  const site = await getSite();
  const status = await fetchServerStatus(site.address);

  return new Response(
    JSON.stringify({
      ...status,
      // 前端只需要一个短字段，避免把完整地址结构重复两边
      host: site.host,
      port: site.port,
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30, s-maxage=60',
      },
    }
  );
};
