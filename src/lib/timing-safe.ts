import { timingSafeEqual } from 'node:crypto';

/**
 * 常量时间字符串比较。
 *
 * 长度不同直接返回 false 是安全的：长度本身不是秘密，而 timingSafeEqual
 * 要求两个 Buffer 等长。所有令牌、会话签名、密码哈希比较都走这里，避免
 * 各处重复实现时漏掉等长检查或误用 `===`。
 */
export const timingSafeEqualString = (provided: string, expected: string): boolean => {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};