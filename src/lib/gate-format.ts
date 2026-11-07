/**
 * /gate 倒计时文字的纯格式化。
 *
 * 服务端给出绝对到期时间，客户端把「剩余毫秒」交给这里；
 * 已到期或输入非法时返回空串，由页面决定显示什么过期文案。
 */
export const formatRemaining = (remainingMs: number): string => {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '';

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds} 秒`;
};