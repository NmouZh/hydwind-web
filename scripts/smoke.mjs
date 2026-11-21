#!/usr/bin/env node
/**
 * 冒烟：可选的「网站反代 → hydwind-api」联通检查。
 *
 * 网站已经把后端拆到 hydwind-api：本地或 CI 没启动后端时，冒烟不失败，
 * 只明确输出「跳过」并说明如何打开。后端可达时启动真实 standalone 站点，
 * 经网站自己的 /api/health 反代访问后端，确认代理链路、状态码和 JSON 都正常。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'server', 'entry.mjs');
const apiOrigin = (process.env.HYDWIND_API_ORIGIN?.trim() || 'http://127.0.0.1:8787').replace(
  /\/+$/,
  ''
);

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const probe = async (url, timeoutMs = 2000) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { response };
  } catch (error) {
    return { error };
  }
};

const waitForHttp = async (url, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const result = await probe(url, 2000);
    if (result.response?.ok) return result.response;
    lastError = result.error ?? new Error(`HTTP ${result.response?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待 ${url} 超时：${String(lastError)}`);
};

const skip = (reason) => {
  console.log(`跳过冒烟：${reason}`);
  console.log(
    `启动 hydwind-api 后再运行：cd ../hydwind-api && node --env-file=.env src/server.ts`
  );
};

const startWeb = async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      HYDWIND_API_ORIGIN: apiOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const close = async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  return { origin, close, stderr: () => stderr };
};

const main = async () => {
  // 后端不可达是正常状态（CI / 只改前端时），跳到后端专属测试即可。
  const backend = await probe(`${apiOrigin}/api/health`);
  if (!backend.response) {
    skip(`hydwind-api 不可达（${apiOrigin}）`);
    return 0;
  }
  if (!backend.response.ok) {
    skip(`hydwind-api 健康检查返回 ${backend.response.status}（${apiOrigin}）`);
    return 0;
  }

  if (!existsSync(entry)) {
    console.error('找不到 dist/server/entry.mjs（先 npm run build）');
    return 1;
  }

  let web;
  try {
    web = await startWeb();
  } catch (error) {
    console.error(`网站 standalone server 启动失败：${String(error).split('\n')[0]}`);
    return 1;
  }

  try {
    const response = await waitForHttp(`${web.origin}/api/health`);
    const body = await response.json();
    const proxied =
      response.status === 200 &&
      body?.ok === true &&
      (response.headers.get('content-type') ?? '').includes('application/json');

    if (!proxied) {
      console.error(
        `反代 /api/health 不符合预期：status=${response.status} body=${JSON.stringify(body)}`
      );
      const stderr = web.stderr();
      if (stderr.trim()) console.error(stderr.trim().split('\n').slice(-10).join('\n'));
      return 1;
    }

    console.log(`冒烟通过：${web.origin}/api/health → ${apiOrigin}/api/health，200 且 ok:true。`);
    return 0;
  } catch (error) {
    console.error(`冒烟失败：${String(error).split('\n')[0]}`);
    return 1;
  } finally {
    await web.close();
  }
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
