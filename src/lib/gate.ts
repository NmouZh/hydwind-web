/**
 * /gate 页面的纯逻辑入口。
 *
 * 具体实现拆在 gate-redirect.ts（返回路径校验）和 gate-format.ts（倒计时文案）；
 * 这里保留统一导出，并放页面主内容的分支判断，方便 node:test 直接测。
 */
export { safeNextPath } from './gate-redirect.ts';
export { formatRemaining } from './gate-format.ts';

/**
 * 页面主内容的三条路径：
 * - 未登录 → 登录入口 + QQ 群注册指引（guest）
 * - 已登录且成功生成 → 展示登录码（codes）
 * - 已登录但生成失败 → 可重试的错误提示，不能把已登录用户当访客再引导登录（error）
 */
export type GateView = 'codes' | 'error' | 'guest';

export interface GateViewInput {
  signedIn: boolean;
  hasCodes: boolean;
}

export const gateView = ({ signedIn, hasCodes }: GateViewInput): GateView => {
  if (!signedIn) return 'guest';
  return hasCodes ? 'codes' : 'error';
};