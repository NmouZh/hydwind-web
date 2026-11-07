import test from 'node:test';
import assert from 'node:assert/strict';
import { isPluginRequest, requirePlugin } from '../src/lib/plugin-auth.ts';

const PLUGIN_TOKEN = 'plugin-secret-value';
const ADMIN_TOKEN = 'admin-secret-value';

const pluginRequest = (token?: string): Request =>
  new Request('http://localhost/api/plugin/login/verify', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

/** 改环境变量并在测试结束后恢复，避免用例互相污染。 */
const useEnv = (t: test.TestContext, values: Record<string, string | undefined>): void => {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
};

test('PLUGIN_TOKEN 正确时放行', (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });

  assert.equal(isPluginRequest(pluginRequest(PLUGIN_TOKEN)), true);
});

test('未配置 PLUGIN_TOKEN 时拒绝，即使 ISSUE_ADMIN_TOKEN 存在', (t) => {
  useEnv(t, { PLUGIN_TOKEN: undefined, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });

  assert.equal(isPluginRequest(pluginRequest(ADMIN_TOKEN)), false);
  assert.equal(isPluginRequest(pluginRequest('')), false);
});

test('不接受 ISSUE_ADMIN_TOKEN，两类令牌互不通用', (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });

  assert.equal(isPluginRequest(pluginRequest(ADMIN_TOKEN)), false);
});

test('不接受 x-hydwind-token 头（这是站务令牌的通道）', (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });

  const request = new Request('http://localhost/api/plugin/login/verify', {
    headers: { 'x-hydwind-token': PLUGIN_TOKEN },
  });

  assert.equal(isPluginRequest(request), false);
});

test('Bearer 前缀大小写不敏感，令牌本身严格匹配', (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });

  const lower = new Request('http://localhost/api/plugin/login/verify', {
    headers: { authorization: `bearer ${PLUGIN_TOKEN}` },
  });

  assert.equal(isPluginRequest(lower), true);
  assert.equal(isPluginRequest(pluginRequest(`${PLUGIN_TOKEN}x`)), false);
  assert.equal(isPluginRequest(pluginRequest()), false);
});

test('requirePlugin 拒绝时返回 401 且带 ok:false', async (t) => {
  useEnv(t, { PLUGIN_TOKEN, ISSUE_ADMIN_TOKEN: ADMIN_TOKEN });

  assert.equal(requirePlugin(pluginRequest(PLUGIN_TOKEN)), null);

  const denied = requirePlugin(pluginRequest(ADMIN_TOKEN));
  assert.notEqual(denied, null);
  assert.equal(denied?.status, 401);
  assert.deepEqual(await denied?.json(), { ok: false, reason: 'unauthorized' });
});
