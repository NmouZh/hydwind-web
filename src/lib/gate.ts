/**
 * /gate 页面的纯逻辑。
 *
 * 这里不碰 Astro、不碰 DOM，方便用 node:test 直接测；
 * 页面与 /account/ 的客户端脚本只负责把结果写进界面。
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

/**
 * 把剩余毫秒格式化成倒计时文字：`5:00`、`1:01`、`9 秒`。
 * 已到期或输入非法时返回空串，由页面决定显示什么过期文案。
 */
export const formatRemaining = (remainingMs: number): string => {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '';

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds} 秒`;
};