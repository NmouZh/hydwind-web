import { json } from './api-response.ts';
import { timingSafeEqualString } from './timing-safe.ts';

/**
 * 插件接口鉴权。
 *
 * 插件（HydwindGate）用独立的 PLUGIN_TOKEN 调用登录校验等接口，权限只覆盖
 * 插件接口本身。它和站务令牌 ISSUE_ADMIN_TOKEN、admin 会话是三条互不相通的
 * 通道：站务令牌不能冒充插件，插件令牌也不能拿去改议题或读待审队列。
 */

const pluginToken = (): string => process.env.PLUGIN_TOKEN ?? '';

const readBearer = (request: Request): string => {
  const header = request.headers.get('authorization') ?? '';
  // 只有 Authorization: Bearer 这一种传法，x-hydwind-token 留给站务令牌
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

/** 请求是否带有效的插件令牌；未配置 PLUGIN_TOKEN 时一律拒绝。 */
export const isPluginRequest = (request: Request): boolean => {
  const expected = pluginToken();
  if (!expected) return false;

  const provided = readBearer(request);
  return provided.length > 0 && timingSafeEqualString(provided, expected);
};

/** 插件接口统一守卫：返回 Response 表示拒绝，返回 null 表示放行。 */
export const requirePlugin = (request: Request): Response | null =>
  isPluginRequest(request) ? null : json({ ok: false, reason: 'unauthorized' }, 401);
