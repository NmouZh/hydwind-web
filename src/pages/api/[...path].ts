import type { APIRoute } from 'astro';
import { apiFetch, proxyResponse } from '../../lib/api-client';

/**
 * `/api/*` 反代：网站不再实现后端接口，全部转发给 hydwind-api。
 *
 * 这一层只做传输：
 * - 方法、查询串、请求体原样透传；
 * - Host / Content-Length 由 api-client 删掉，补 X-Forwarded-*；
 * - 后端的状态码、Location、Cache-Control、Content-Type 与 Set-Cookie 原样带回；
 * - body 以流的形式返回，不整包读进内存。
 *
 * 页面 SSR 直接调 `apiFetch`，浏览器请求则都经过这里，两条路径共用同一份头规则。
 */
export const prerender = false;

export const ALL: APIRoute = async (context) => {
  const path = context.params.path ?? '';
  const target = `/api/${path}${context.url.search}`;
  const method = context.request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  try {
    const upstream = await apiFetch(
      target,
      {
        method,
        headers: context.request.headers,
        body: hasBody ? context.request.body : undefined,
        // 头像接口用 302 回默认头像；反代不能替浏览器跟随，否则地址就变了。
        redirect: 'manual',
        ...(hasBody ? { duplex: 'half' as const } : {}),
      },
      { request: context.request, clientAddress: context.clientAddress }
    );

    return proxyResponse(upstream);
  } catch (error) {
    // 后端没起来时给一个明确的 502，而不是让页面栈直接抛 500。
    console.error(`[api-proxy] ${method} ${target} 失败`, error);
    return new Response(JSON.stringify({ error: '后端暂时不可达' }), {
      status: 502,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
};
