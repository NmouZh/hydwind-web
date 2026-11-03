/**
 * 站务令牌校验。
 *
 * 站点本身没有账号系统，议题审核走「群内指令 → 插件 → 管理接口」这条链路。
 * 插件用环境变量 ISSUE_ADMIN_TOKEN 里的共享密钥调用写接口。
 */
const ADMIN_TOKEN = () => process.env.ISSUE_ADMIN_TOKEN ?? '';

export const isAdmin = (request: Request): boolean => {
  const token = ADMIN_TOKEN();
  if (!token) return false;

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const custom = request.headers.get('x-hydwind-token') ?? '';

  return bearer === token || custom === token;
};

/** 写接口统一守卫：返回 Response 表示拒绝，返回 null 表示放行。 */
export const requireAdmin = (request: Request): Response | null =>
  isAdmin(request)
    ? null
    : new Response(JSON.stringify({ error: '需要站务令牌' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
