import type { TestContext } from 'node:test';

/**
 * 测试公用工具。
 *
 * 环境变量在模块内被读取（比如 PLUGIN_TOKEN、登录码候选池），用例必须能
 * 临时覆盖再恢复；这里只做这一件事，避免每个测试文件各抄一份。
 */
export const useEnv = (t: TestContext, values: Record<string, string | undefined>): void => {
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