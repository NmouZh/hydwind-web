#!/usr/bin/env node
/**
 * 生产启动前的环境检查。
 *
 * systemd 在拉起 Node 之前运行：
 *   node --env-file=.env ./scripts/check-env.mjs
 * 任何一个关键项不满足都直接退出，避免网站以“看起来正常但认证不安全”的状态运行。
 */
import { accessSync, chmodSync, constants, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const failures = [];
const warnings = [];

const requireSecret = (name, minLength) => {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    failures.push(`缺少 ${name}`);
    return '';
  }
  if (value.length < minLength) {
    failures.push(`${name} 至少需要 ${minLength} 个字符（当前 ${value.length}）`);
  }
  if (/^(changeme|change-me|secret|password|test)/i.test(value)) {
    failures.push(`${name} 看起来是占位值，请换成随机串`);
  }
  return value;
};

const sessionSecret = requireSecret('SESSION_SECRET', 32);
const adminToken = requireSecret('ISSUE_ADMIN_TOKEN', 32);
const pluginToken = requireSecret('PLUGIN_TOKEN', 32);

if (sessionSecret && adminToken && sessionSecret === adminToken) {
  failures.push('SESSION_SECRET 不能与 ISSUE_ADMIN_TOKEN 相同');
}
if (pluginToken && adminToken && pluginToken === adminToken) {
  failures.push('PLUGIN_TOKEN 不能与 ISSUE_ADMIN_TOKEN 相同');
}
if (pluginToken && sessionSecret && pluginToken === sessionSecret) {
  failures.push('PLUGIN_TOKEN 不能与 SESSION_SECRET 相同');
}

// 数据目录必须可写；顺手把已有文件收紧到 0600，避免沿用旧的 0644。
const dataDir = path.resolve(process.env.HYDWIND_DATA_DIR ?? './data');
try {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  accessSync(dataDir, constants.W_OK | constants.R_OK);
  chmodSync(dataDir, 0o700);
  for (const name of readdirSync(dataDir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dataDir, name);
    if (!statSync(file).isFile()) continue;
    chmodSync(file, 0o600);
  }
} catch (error) {
  failures.push(`数据目录不可用：${dataDir}（${error instanceof Error ? error.message : error}）`);
}

if (!process.env.HOST) {
  warnings.push('未设置 HOST，将监听所有地址；放在反代后面时应设为 127.0.0.1');
}

for (const message of warnings) console.warn(`[env] 警告：${message}`);
if (failures.length > 0) {
  for (const message of failures) console.error(`[env] 错误：${message}`);
  process.exit(1);
}

console.log('[env] 环境检查通过');