import { defineMiddleware } from 'astro:middleware';

/**
 * 统一安全响应头与动态页缓存策略。
 *
 * 静态文件（`/_astro`、字体、图片）由 @astrojs/node 的静态处理器直接输出，
 * 不经过这里；生产环境还需要反代层给静态资源补同样的头（见 deploy/Caddyfile）。
 */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  // meta CSP 不支持 frame-ancestors，用响应头补上；与页面里的 CSP meta 取交集。
  'content-security-policy': "frame-ancestors 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

const forwardedProto = (request: Request): string =>
  (request.headers.get('x-forwarded-proto') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const headers = response.headers;

  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }

    // 只有确实通过 HTTPS 访问时才发 HSTS；明文部署发这个头没有意义。
    const protocol = forwardedProto(context.request) || context.url.protocol.replace(':', '');
    if (protocol === 'https' && !headers.has('strict-transport-security')) {
      headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }

    if (!headers.has('cache-control')) {
      const pathname = context.url.pathname;
      if (pathname === '/people' || pathname === '/people/') {
        // 列表页不依赖 cookie，短缓存可以让预取和连续导航复用。
        headers.set('cache-control', 'public, max-age=15, stale-while-revalidate=60');
      } else if (pathname.startsWith('/people/')) {
        // 详情页带着编辑 / 删除按钮和 viewer 身份，绝不能进共享缓存。
        headers.set('cache-control', 'private, no-store');
        headers.set('vary', 'cookie');
      } else if (pathname.startsWith('/gate')) {
        headers.set('cache-control', 'no-store');
      } else if (pathname.startsWith('/api/')) {
        headers.set('cache-control', 'no-store');
      }
    }
  } catch {
    // 某些 Response 的 headers 是只读的（例如底层 fetch Response）；不因为加头失败而影响响应。
  }

  return response;
});