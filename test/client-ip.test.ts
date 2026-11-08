import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clientIpKey } from '../src/lib/client-ip.ts';

test('IPv4 原样保留', () => {
  assert.equal(clientIpKey('203.0.113.7'), '203.0.113.7');
});

test('IPv4-mapped IPv6 折叠回 IPv4（点分与十六进制两种写法）', () => {
  assert.equal(clientIpKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(clientIpKey('::ffff:c000:201'), '192.0.2.1');
});

test('IPv6 按 /64 归并，同一前缀轮换不再获得新桶', () => {
  assert.equal(clientIpKey('2001:db8:1:2::1'), '2001:0db8:0001:0002::/64');
  assert.equal(clientIpKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:0db8:0001:0002::/64');
  assert.equal(clientIpKey('2001:db8:1:2::abcd'), clientIpKey('2001:db8:1:2::1'));
  assert.equal(clientIpKey('2001:DB8:1:2::1'), clientIpKey('2001:db8:1:2::1'));
});

test('缺失地址归到 unknown，不抛异常', () => {
  assert.equal(clientIpKey(undefined), 'unknown');
  assert.equal(clientIpKey(''), 'unknown');
});
