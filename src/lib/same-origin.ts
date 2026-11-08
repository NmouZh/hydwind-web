/**
 * 浏览器写请求的同源判定。
 *
 * 两道闸：
 * 1. `Sec-Fetch-Site` 由浏览器强制写入，脚本改不了；只要不是 same-origin /
 *    none（地址栏直接发起），就拒绝。`same-site` 也拒绝，避免任意子域借
 *    父域 cookie 跨站写。
 * 2. `Origin` 存在时必须和 `request.url` 的 host 完全一致。插件 / curl 不带
 *    Origin，交给令牌或登录态去管；浏览器发起的 POST/PUT/DELETE 一定带 Origin。
 *
 * 反代必须把真实 Host 透传给 Astro（见 astro.config.mjs 的 allowedDomains），
 * 否则 request.url 会回落成 localhost，正常的同源请求也会被误杀。
 */
export const isSameOriginRequest = (request: Request): boolean => {
  const fetchSite = (request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
};