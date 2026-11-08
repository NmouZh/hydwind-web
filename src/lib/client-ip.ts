/**
 * 限流用的客户端 IP 归一化。
 *
 * - IPv4 原样返回；
 * - IPv4-mapped IPv6（`::ffff:1.2.3.4`）折叠回 IPv4；
 * - IPv6 按 /64 归并：同一个用户通常能自由轮换 /64 内的地址，
 *   不归并的话 IP 限流等于不存在。
 */
const normalizeIp = (address: string): string => {
  const value = address.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) return mapped[1];
  if (!value.includes(':')) return value;

  const [head, tail] = value.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...tailGroups,
  ].map((group) => group.padStart(4, '0'));
  return `${groups.slice(0, 4).join(':')}::/64`;
};

export const clientIpKey = (address: string | undefined): string =>
  address ? normalizeIp(address) || 'unknown' : 'unknown';