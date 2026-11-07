/**
 * API 响应的共享辅助。
 *
 * 所有接口统一返回 JSON、禁止缓存；集中在一处后，路由里不用再各抄一份
 * `new Response(JSON.stringify(...))`。headers 可覆盖默认值（比如位置跳转）。
 */
export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

/** 路由只接受 `application/json`（允许带 charset 或其它参数）。 */
export const isJson = (request: Request): boolean =>
  (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');