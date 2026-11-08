/**
 * 限流用的客户端 IP 归一化。
 *
 * - IPv4 原样返回；
 * - IPv4-mapped IPv6（`::ffff:1.2.3.4` 或 `::ffff:c000:201`）折叠回 IPv4；
 * - IPv6 统一小写并按 /64 归并：同一用户通常能自由轮换 /64 内的地址，
 *   不归并的话 IP 限流等于不存在。
 */
const normalizeIp = (address: string): string => {
  const value = address
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .toLowerCase();

  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mappedDotted) return mappedDotted[1];

  // ::ffff:c000:201 形式的 IPv4-mapped IPv6 也要折叠，否则所有这类地址
  // 都会落进 ::/64 同一个限流桶。
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }

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