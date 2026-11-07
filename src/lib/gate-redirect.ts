/**
 * 登录后返回路径的校验。
 *
 * 这里不碰 Astro、不碰 DOM，方便用 node:test 直接测；
 * /account/ 的客户端脚本只负责把结果写进 location。
 */

// 路径里出现的控制字符（NUL、换行等）一律拒绝。
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]');

/**
 * 校验登录后要跳回的站内路径。
 *
 * `?next=` 只允许以单个 `/` 开头的同源路径：拒绝 `//host`、`/\host`、
 * `javascript:` 和带控制字符的输入，避免登录页变成开放重定向。
 * 非法输入返回 `fallback`（默认空串，表示维持原来的登录后行为）。
 */
export const safeNextPath = (input: unknown, fallback = ''): string => {
  if (typeof input !== 'string') return fallback;

  const value = input.trim();
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (CONTROL_CHARS.test(value)) return fallback;

  try {
    const url = new URL(value, 'http://hydwind.invalid');
    if (url.origin !== 'http://hydwind.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};