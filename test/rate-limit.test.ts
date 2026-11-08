import assert from 'node:assert/strict';
import { test } from 'node:test';

import { consumeRateLimit } from '../src/lib/rate-limit.ts';

test('桶满时短窗口请求不会清掉长窗口限流', () => {
  const now = 1_000_000;
  const loginKey = 'test:login:long-window';
  for (let index = 0; index < 5; index += 1) {
    assert.equal(consumeRateLimit(loginKey, 5, 10 * 60_000, now).ok, true);
  }
  assert.equal(consumeRateLimit(loginKey, 5, 10 * 60_000, now).ok, false);

  // 用短窗口 key 把进程内表填满；活跃的长窗口桶不能被顺手删掉。
  for (let index = 0; index < 5_100; index += 1) {
    consumeRateLimit(`test:avatar:${index}`, 1, 60_000, now + 1);
  }

  assert.equal(
    consumeRateLimit(loginKey, 5, 10 * 60_000, now + 2).ok,
    false,
    '登录失败额度在 10 分钟内仍然有效'
  );
});