import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatRemaining, gateView, safeNextPath } from '../src/lib/gate.ts';

/**
 * /gate 页面的两个纯逻辑接缝：
 * - 登录后的返回路径必须只允许站内路径，防止 `?next=` 被拿去做开放重定向；
 * - 倒计时文字由剩余毫秒推导，页面只负责把它写进 DOM。
 */

test('safeNextPath 接受站内绝对路径并保留查询与锚点', () => {
  assert.equal(safeNextPath('/gate/'), '/gate/');
  assert.equal(safeNextPath('  /gate/?from=issue#top  '), '/gate/?from=issue#top');
  assert.equal(safeNextPath('/account/'), '/account/');
});

test('safeNextPath 拒绝站外、协议相对和脚本地址', () => {
  for (const input of [
    'https://evil.example/gate/',
    'http://evil.example',
    '//evil.example/gate/',
    '/\\evil.example/gate/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'gate/',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(safeNextPath(input), '', `应拒绝：${String(input)}`);
  }
});

test('safeNextPath 拒绝包含控制字符的路径，并支持自定义回退值', () => {
  assert.equal(safeNextPath('/ga\u0000te/'), '');
  assert.equal(safeNextPath('/ga\nte/'), '');
  assert.equal(safeNextPath('https://evil.example/', '/account/'), '/account/');
});

test('formatRemaining 输出分:秒倒计时', () => {
  assert.equal(formatRemaining(5 * 60 * 1000), '5:00');
  assert.equal(formatRemaining(61_000), '1:01');
  assert.equal(formatRemaining(2 * 60 * 1000 + 9_000), '2:09');
});

test('formatRemaining 不足一分钟时按秒显示', () => {
  assert.equal(formatRemaining(1_000), '1 秒');
  assert.equal(formatRemaining(999), '1 秒');
  assert.equal(formatRemaining(10), '1 秒');
});

test('formatRemaining 在到期后返回空字符串', () => {
  assert.equal(formatRemaining(0), '');
  assert.equal(formatRemaining(-1), '');
});

/**
 * /gate 主内容三条路径必须分清，尤其不能把「已登录但生成失败」误判成访客：
 * - 未登录 → 登录 / QQ 群注册指引
 * - 已登录且拿到码 → 展示码
 * - 已登录但生成失败 → 可重试错误提示
 */
test('gateView 未登录时给登录与注册指引', () => {
  assert.equal(gateView({ signedIn: false, hasCodes: false }), 'guest');
  assert.equal(gateView({ signedIn: false, hasCodes: true }), 'guest');
});

test('gateView 已登录且生成成功时展示登录码', () => {
  assert.equal(gateView({ signedIn: true, hasCodes: true }), 'codes');
});

test('gateView 已登录但生成失败时显示错误而不是访客指引', () => {
  assert.equal(gateView({ signedIn: true, hasCodes: false }), 'error');
});