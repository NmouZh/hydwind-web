#!/usr/bin/env node
/**
 * 冒烟：API 契约 + 浏览器界面。
 *
 * API 部分启动 dist/server/entry.mjs（真实 standalone 服务），用临时
 * HYDWIND_DATA_DIR 和测试密钥走一遍注册 / 登录 / 生成码 / 插件校验，
 * 覆盖 /api/health 200 与 /api/plugin/login/verify 的 200 / 401 / 409。
 * 浏览器部分在真实 Chromium 里验证布局、主题、复制与导航；Chromium
 * 不可用时只跳过浏览器检查，不影响 API 冒烟结果。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'dist');
/** @astrojs/node standalone 把静态产物放在 dist/client；老静态构建则直接落在 dist 根。 */
const dist = existsSync(path.join(buildDir, 'index.html'))
  ? buildDir
  : path.join(buildDir, 'client');

const ADDRESS = 'zzbgp2.coreyun.net:35282';
const QQ = '1129694648';
const JOIN_GUIDE_ID = 'join';

const passes = [];
const failures = [];

const check = (condition, message) => {
  if (condition) passes.push(message);
  else failures.push(message);
};

let browserSkipReason = null;

const skipBrowser = (reason) => {
  browserSkipReason = reason;
  console.log(`跳过浏览器冒烟：${reason}`);
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const startStaticServer = async () => {
  const server = createServer(async (request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filePath = path.join(dist, urlPath);

    try {
      if (!filePath.startsWith(dist)) throw new Error('outside dist');
      const info = await stat(filePath).catch(() => null);
      if (info?.isDirectory() || (!info && !path.extname(filePath))) {
        filePath = path.join(filePath, 'index.html');
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const findExecutable = () => {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    path.join(
      os.homedir(),
      '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'
    ),
    path.join(
      os.homedir(),
      '.cache/ms-playwright/chromium-1248/chrome-linux/chrome'
    ),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
};

const waitForStatus = async (page, expected) => {
  try {
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-server-status-text]')?.textContent?.trim() ===
        text,
      expected,
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
};

const hasNoHorizontalOverflow = async (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
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

const waitForHttp = async (url, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待 ${url} 超时：${String(lastError)}`);
};

/**
 * API 冒烟：真实启动 standalone server，所有状态都通过 HTTP 验证。
 * 不依赖 Chromium，CI 里一定能跑；账号与登录码写在临时数据目录，测完删除。
 */
const apiSmoke = async () => {
  const entry = path.join(buildDir, 'server', 'entry.mjs');
  if (!existsSync(entry)) {
    failures.push('/api 冒烟：找不到 dist/server/entry.mjs（先 npm run build）');
    return;
  }

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'hydwind-smoke-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const pluginToken = 'smoke-plugin-token';
  const adminToken = 'smoke-admin-token';
  const username = 'SmokePlayer';
  const uuid = '123e4567-e89b-12d3-a456-426614174000';

  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      HYDWIND_DATA_DIR: dataDir,
      PLUGIN_TOKEN: pluginToken,
      ISSUE_ADMIN_TOKEN: adminToken,
      SESSION_SECRET: 'smoke-session-secret-0123456789',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const verify = async (token, body) => {
    const headers = { 'content-type': 'application/json' };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${origin}/api/plugin/login/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const fetchCodes = async (cookie) => {
    const response = await fetch(`${origin}/gate`, { headers: { cookie } });
    const html = await response.text();
    const code = html.match(/data-gate-code[^>]*>\s*([^<]+?)\s*<\/p>/s)?.[1]?.trim();
    const fallback = html.match(/data-gate-fallback[^>]*>\s*([^<]+?)\s*<\/code>/s)?.[1]?.trim();
    return { status: response.status, html, code, fallback };
  };

  try {
    const health = await waitForHttp(`${origin}/api/health`);
    const healthBody = await health.json();
    check(health.status === 200 && healthBody.ok === true, '/api/health 返回 200 且 ok:true');

    // 未登录访问 /gate：应看到登录 / 注册指引，而不是错误或码
    const guest = await fetch(`${origin}/gate`);
    const guestHtml = await guest.text();
    check(guest.status === 200, '/gate 未登录可访问');
    check(guestHtml.includes('登录网站账号'), '/gate 未登录显示登录指引');
    check(!guestHtml.includes('登录码暂时生成不出来'), '/gate 未登录不显示生成失败');

    // 用站务令牌创建测试账号（正式流程由群内机器人调用）
    const registered = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username, platformId: 'qq-smoke', nickname: '冒烟账号' }),
    });
    const registeredBody = await registered.json();
    check(
      registered.status === 200 && registeredBody.username === username,
      '/api/auth/register 创建临时测试账号'
    );
    const password = registeredBody.password;
    check(typeof password === 'string' && password.length >= 6, '注册返回可用密码');

    const loggedIn = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const setCookies = loggedIn.headers.getSetCookie?.() ?? [];
    const cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    check(loggedIn.status === 200 && cookie.length > 0, '/api/auth/login 返回会话 cookie');

    const first = await fetchCodes(cookie);
    check(
      first.status === 200 && Boolean(first.code) && Boolean(first.fallback),
      '/gate 登录后生成颜文字码与备用码'
    );

    const unauthorized = await verify(null, {
      code: first.code ?? 'unused',
      gameId: username,
      uuid,
    });
    check(unauthorized.status === 401, '/api/plugin/login/verify 无令牌返回 401');

    const verified = await verify(pluginToken, {
      code: first.fallback,
      gameId: username,
      uuid,
    });
    check(
      verified.status === 200 && verified.body?.account?.username === username,
      '/api/plugin/login/verify 有效码返回 200 与账号'
    );

    const reused = await verify(pluginToken, {
      code: first.code,
      gameId: username,
      uuid,
    });
    check(
      reused.status === 409 && reused.body?.reason === 'used',
      '/api/plugin/login/verify 同一个码的另一个别名返回 409 used'
    );

    const second = await fetchCodes(cookie);
    const mismatch = await verify(pluginToken, {
      code: second.code ?? 'unused',
      gameId: 'SomeoneElse',
      uuid,
    });
    check(
      mismatch.status === 409 &&
        mismatch.body?.reason === 'game_id_mismatch' &&
        mismatch.body?.expectedGameId === username,
      '/api/plugin/login/verify 游戏 ID 不符返回 409 game_id_mismatch 与 expectedGameId'
    );

    const invalid = await verify(pluginToken, {
      code: 'definitely-not-a-code',
      gameId: username,
      uuid,
    });
    check(
      invalid.status === 409 && invalid.body?.reason === 'invalid_code',
      '/api/plugin/login/verify 未知码返回 409 invalid_code'
    );
  } catch (error) {
    failures.push(`/api 冒烟执行失败：${String(error).split('\n')[0]}`);
    if (stderr.trim()) console.error(stderr.trim().split('\n').slice(-10).join('\n'));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await rm(dataDir, { recursive: true, force: true });
  }
};

const browserSmoke = async () => {
  if (!existsSync(dist)) {
    console.error('dist/ 不存在，请先运行 bun run build');
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    skipBrowser('未安装 playwright-core');
    return;
  }

  const executablePath = findExecutable();
  if (!executablePath) {
    skipBrowser('找不到本地 Chromium headless shell-1248');
    return;
  }

  const server = await startStaticServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
  } catch (error) {
    server.close();
    skipBrowser(`Chromium 无法启动（${String(error).split('\n')[0]}）`);
    return;
  }

  try {
    let statusMode = 'offline';
    const fulfillStatus = (route) => {
      if (statusMode === 'online') return route.fulfill({ json: { online: true } });
      if (statusMode === 'offline') return route.fulfill({ json: { online: false } });
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":"upstream unavailable"}',
      });
    };

    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await desktop.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin,
    });
    await desktop.route('**/api.mcsrvstat.us/**', fulfillStatus);
    await desktop.route('**/api.mcstatus.io/**', fulfillStatus);

    const page = await desktop.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    check(await waitForStatus(page, '离线'), '桌面首页显示离线状态');
    check(await hasNoHorizontalOverflow(page), '桌面首页 1280 视口无横向溢出');

    const initialTheme = await page.evaluate(
      () => document.documentElement.dataset.theme
    );
    const nextTheme = initialTheme === 'dark' ? 'light' : 'dark';
    await page.click('[data-theme-toggle]');
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      nextTheme,
      { timeout: 5000 }
    );
    check(
      (await page.evaluate(() => document.documentElement.dataset.theme)) === nextTheme,
      `深浅色切换生效（${initialTheme} → ${nextTheme}）`
    );

    await page.locator(`[data-copy="${ADDRESS}"]`).first().click();
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-snackbar-text]')?.textContent?.trim() === text,
      `已复制 ${ADDRESS}`,
      { timeout: 5000 }
    );
    check(
      (await page.evaluate(() => navigator.clipboard.readText())) === ADDRESS,
      `复制地址包含完整端口（${ADDRESS}）`
    );

    await page.locator(`[data-copy="${QQ}"]`).first().click();
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-snackbar-text]')?.textContent?.trim() === text,
      `已复制 ${QQ}`,
      { timeout: 5000 }
    );
    check(
      (await page.evaluate(() => navigator.clipboard.readText())) === QQ,
      `复制 QQ 群号（${QQ}）`
    );

    await page.click('header nav[aria-label="主导航"] a[href="/people/"]');
    await page.waitForURL('**/people/', { timeout: 5000 });
    check(
      (await page.locator('h1').first().innerText()).includes('真实存在'),
      '顶部导航进入人物页'
    );

    // 人物详情是 SSR：没有构建期 HTML，必须由 standalone server 现场渲染。
    await page.goto(`${origin}/people/nz-173/`, { waitUntil: 'networkidle' });
    const personText = await page.locator('body').innerText();
    check(personText.includes('Nz_173的人物传记'), 'SSR 人物页显示默认主标题');
    check(personText.includes('游戏 ID'), 'SSR 人物页显示游戏 ID');
    check(personText.includes('尚未填写'), 'SSR 人物页显示空状态');
    check(personText.includes('聊两句'), 'SSR 人物页显示评论区');

    await page.click('header nav[aria-label="主导航"] a[href="/guides/"]');
    await page.waitForURL('**/guides/', { timeout: 5000 });
    check(
      (await page.locator('h1').first().innerText()).includes('Wiki'),
      '顶部导航进入指南页'
    );

    const assertStatus = async (mode, expected) => {
      statusMode = mode;
      await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
      const reached = await waitForStatus(page, expected);
      const actual = await page
        .locator('[data-server-status-text]')
        .innerText()
        .catch(() => '');
      check(reached && actual.trim() === expected, `状态模拟 ${mode} 显示“${expected}”`);
      if (mode === 'error') {
        check(!actual.includes('在线'), '查询失败不显示在线');
      }
    };

    await assertStatus('online', '在线');
    await assertStatus('offline', '离线');
    await assertStatus('error', '查询失败');

    const desktopPaths = [
      '/',
      '/people/',
      '/people/nz-173/',
      '/guides/',
      `/guides/${JOIN_GUIDE_ID}/`,
      '/account/',
    ];
    for (const relativePath of desktopPaths) {
      await page.goto(`${origin}${relativePath}`, { waitUntil: 'networkidle' });
      check(
        await hasNoHorizontalOverflow(page),
        `桌面 1280 视口无横向溢出：${relativePath}`
      );
    }

    await page.goto(`${origin}/guides/${JOIN_GUIDE_ID}/`, {
      waitUntil: 'networkidle',
    });
    const joinText = await page.locator('body').innerText();
    check(joinText.includes('世界可能重置'), '进服指南页面自带测试期重置提示');
    check(joinText.includes('添加服务器'), '进服指南页面自带进服步骤');

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobile.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin,
    });
    await mobile.route('**/api.mcsrvstat.us/**', fulfillStatus);
    await mobile.route('**/api.mcstatus.io/**', fulfillStatus);

    statusMode = 'offline';
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${origin}/`, { waitUntil: 'networkidle' });
    check(await waitForStatus(mobilePage, '离线'), '移动首页显示离线状态');
    check(
      await hasNoHorizontalOverflow(mobilePage),
      '移动首页 390 视口无横向溢出'
    );
    check(
      await mobilePage.locator('nav[aria-label="底部导航"]').isVisible(),
      '移动视口显示底部导航'
    );

    await mobilePage.click(
      'nav[aria-label="底部导航"] a[href="/people/"]'
    );
    await mobilePage.waitForURL('**/people/', { timeout: 5000 });
    check(
      (await mobilePage.locator('h1').first().innerText()).includes('真实存在'),
      '底部导航进入人物页'
    );

    await mobilePage.click(
      'nav[aria-label="底部导航"] a[href="/guides/"]'
    );
    await mobilePage.waitForURL('**/guides/', { timeout: 5000 });
    check(
      (await mobilePage.locator('h1').first().innerText()).includes('Wiki'),
      '底部导航进入指南页'
    );

    const mobilePaths = [
      '/',
      '/people/',
      '/people/nz-173/',
      '/guides/',
      `/guides/${JOIN_GUIDE_ID}/`,
      '/account/',
    ];
    for (const relativePath of mobilePaths) {
      await mobilePage.goto(`${origin}${relativePath}`, {
        waitUntil: 'networkidle',
      });
      check(
        await hasNoHorizontalOverflow(mobilePage),
        `移动 390 视口无横向溢出：${relativePath}`
      );
    }

    await desktop.close();
    await mobile.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
};

const main = async () => {
  await apiSmoke();
  await browserSmoke();

  if (failures.length > 0) {
    console.error('\n冒烟失败：');
    for (const message of failures) console.error(`  ✗ ${message}`);
    console.error(`\n通过 ${passes.length} 项，失败 ${failures.length} 项。`);
    process.exit(1);
  }

  const suffix = browserSkipReason ? `（浏览器部分跳过：${browserSkipReason}）` : '';
  console.log(`冒烟通过：${passes.length} 项全部满足。${suffix}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
