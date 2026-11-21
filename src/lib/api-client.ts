/**
 * hydwind-api 客户端。
 *
 * 网站不再自己实现账号、传记、议题等接口，只做两件事：
 * - 页面 SSR 时用这里的函数向后端要数据（带当前请求的 Cookie / Origin）；
 * - `/api/[...path]` 把浏览器请求原样反代给后端。
 *
 * 转发规则统一收在这里，页面与反代路由不各写一份头处理：
 * - Cookie / Origin 取自当前请求，浏览器会话才能透传到后端；
 * - X-Forwarded-For 用 Astro 解析出的 clientAddress，后端的限流按真实 IP 分桶；
 * - X-Forwarded-Host / Proto 用当前请求 URL，后端据此生成正确的对外地址。
 *
 * 不引入依赖：只用原生 fetch / Headers / Response。
 */

/** 本地开发默认端口；生产由 HYDWIND_API_ORIGIN 覆盖。 */
export const DEFAULT_API_ORIGIN = 'http://127.0.0.1:8787';

/** 只允许访问后端 API 路径，避免误把任意绝对 URL 交给 fetch。 */
const API_PATH_PREFIX = '/api/';

/**
 * 请求头里不能原样带过去的东西：Host / Content-Length 由 fetch 按目标地址重算，
 * 其余是逐跳头，代理不该转发。
 */
const REQUEST_HEADER_BLOCKLIST = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * 响应头里不能原样带回去的东西：body 在 fetch 层已经被解码，
 * 再带 content-encoding / content-length 会让浏览器读到错位的内容。
 */
const RESPONSE_HEADER_BLOCKLIST = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface ApiClientContext {
  /** 当前页面的原始请求：Cookie / Origin 从这里转发。 */
  request: Request;
  /** Astro.clientAddress；后端用它做限流与审计。 */
  clientAddress?: string;
}

/** 非 2xx 的响应：带状态码与原始 body，调用方可以按 401 / 404 分流。 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`hydwind-api 返回 ${status}: ${body.slice(0, 200)}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** 后端根地址；末尾斜杠去掉，避免拼出 `//api`。 */
export const apiOrigin = (): string =>
  (process.env.HYDWIND_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN).replace(/\/+$/, '');

/**
 * 构造一次后端请求，但不发出去。
 *
 * 单独导出是为了让测试能直接断言 URL 与请求头，不必真的开服务器；
 * `apiFetch` 只是把结果交给 fetch。
 */
export const apiRequest = (
  path: string,
  init: RequestInit = {},
  context: ApiClientContext
): { url: string; init: RequestInit & { duplex?: 'half' } } => {
  if (!path.startsWith(API_PATH_PREFIX)) {
    throw new Error(`只允许代理 ${API_PATH_PREFIX} 路径，收到：${path}`);
  }

  const url = new URL(path, apiOrigin()).toString();
  const headers = new Headers(init.headers);
  for (const name of REQUEST_HEADER_BLOCKLIST) headers.delete(name);

  const incoming = context.request;

  // 页面 SSR 的 fetch 不是浏览器发起的，Cookie / Origin 必须显式转发；
  // init.headers 已经指定时以调用方为准（反代路由会传完整请求头）。
  const cookie = incoming.headers.get('cookie');
  if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);

  const origin = incoming.headers.get('origin');
  if (origin && !headers.has('origin')) headers.set('origin', origin);

  // 永远用服务端解析出的地址覆盖，不采信客户端自带的 X-Forwarded-For。
  headers.delete('x-forwarded-for');
  if (context.clientAddress) headers.set('x-forwarded-for', context.clientAddress);

  const requestUrl = new URL(incoming.url);
  headers.set('x-forwarded-host', requestUrl.host);
  headers.set('x-forwarded-proto', requestUrl.protocol.replace(/:$/, ''));

  return { url, init: { ...init, headers } };
};

/** 向后端发请求；返回原始 Response，状态码与响应头都不改写。 */
export const apiFetch = (
  path: string,
  init: RequestInit = {},
  context: ApiClientContext
): Promise<Response> => {
  const request = apiRequest(path, init, context);
  return fetch(request.url, request.init);
};

/**
 * 读 JSON：非 2xx 抛 ApiError（带 status / body），成功时返回解析后的 body。
 * 空 body 的 204 之类返回 undefined。
 */
export const apiJson = async <T>(
  path: string,
  init: RequestInit = {},
  context: ApiClientContext
): Promise<T> => {
  const response = await apiFetch(path, init, context);
  const body = await response.text();

  if (!response.ok) throw new ApiError(response.status, body);
  if (!body) return undefined as T;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiError(response.status, body);
  }
};

/** Node 22 的 Headers 支持 getSetCookie；老环境退回单值读取。 */
const setCookiesOf = (headers: Headers): string[] => {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers);

  const single = headers.get('set-cookie');
  return single ? [single] : [];
};

/**
 * 把后端的 Response 包装成反代响应。
 *
 * - 保留状态码、Location、Cache-Control、Content-Type 等业务头；
 * - 逐条复制 Set-Cookie（登录 / 退出都依赖它）；
 * - 去掉逐跳头与已经被 fetch 解码的 content-encoding / content-length；
 * - body 直接透传流，不做二次缓冲。
 *
 * 后端没给 Cache-Control 时补 no-store：反代不替后端缓存任何东西。
 */
export const proxyResponse = (upstream: Response): Response => {
  const headers = new Headers();

  for (const [name, value] of upstream.headers) {
    const key = name.toLowerCase();
    if (key === 'set-cookie') continue;
    if (RESPONSE_HEADER_BLOCKLIST.has(key)) continue;
    headers.append(name, value);
  }

  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  for (const cookie of setCookiesOf(upstream.headers)) {
    headers.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};
