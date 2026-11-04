/**
 * 站务令牌校验。
 *
 * 站点本身没有账号系统，议题审核走「群内指令 → 插件 → 管理接口」这条链路。
 * 插件用环境变量 ISSUE_ADMIN_TOKEN 里的共享密钥调用写接口。
 */
import { findAccount } from './accounts';
import { readSessionFromRequest } from './session';

const ADMIN_TOKEN = () => process.env.ISSUE_ADMIN_TOKEN ?? '';

export const isAdmin = (request: Request): boolean => {
  const token = ADMIN_TOKEN();
  if (!token) return false;

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const custom = request.headers.get('x-hydwind-token') ?? '';

  return bearer === token || custom === token;
};

/**
 * 站务判定：令牌，或「当前会话对应的账号仍然是 admin」。
 *
 * 只信 cookie 里的 role 会让降权拖到 30 天后才生效；这里每次回查账号，
 * 降权 / 角色调整立刻生效。账号文件是本地 JSON，成本可以忽略。
 */
export const isStaffRequest = async (request: Request): Promise<boolean> => {
  if (isAdmin(request)) return true;

  const session = readSessionFromRequest(request);
  if (!session) return false;

  const account = await findAccount(session.username);
  return account?.role === 'admin';
};

/** 写接口统一守卫：返回 Response 表示拒绝，返回 null 表示放行。 */
export const requireAdmin = (request: Request): Response | null =>
  isAdmin(request)
    ? null
    : new Response(JSON.stringify({ error: '需要站务令牌' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
