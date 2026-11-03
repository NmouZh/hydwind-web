#!/usr/bin/env node
/**
 * 浏览器冒烟。
 *
 * 在真实 Chromium（本地缓存的 headless shell）里验证：桌面/移动视口无横向溢出、
 * 深浅色切换、复制地址与 QQ 群、顶部/底部导航，以及在线、离线、查询失败三态。
 * 浏览器不可用时明确输出“跳过”并以 0 退出，避免把环境缺失当成站点失败。
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
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

const skip = (reason) => {
  console.log(`跳过浏览器冒烟：${reason}`);
  process.exit(0);
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

const main = async () => {
  if (!existsSync(dist)) {
    console.error('dist/ 不存在，请先运行 bun run build');
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    skip('未安装 playwright-core');
  }

  const executablePath = findExecutable();
  if (!executablePath) {
    skip('找不到本地 Chromium headless shell-1248');
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
    skip(`Chromium 无法启动（${String(error).split('\n')[0]}）`);
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

    await page.click('header nav[aria-label="主导航"] a[href="/guides/"]');
    await page.waitForURL('**/guides/', { timeout: 5000 });
    check(
      (await page.locator('h1').first().innerText()).includes('第一次进服'),
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
      (await mobilePage.locator('h1').first().innerText()).includes('第一次进服'),
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

  if (failures.length > 0) {
    console.error('\n浏览器冒烟失败：');
    for (const message of failures) console.error(`  ✗ ${message}`);
    console.error(`\n通过 ${passes.length} 项，失败 ${failures.length} 项。`);
    process.exit(1);
  }

  console.log(`浏览器冒烟通过：${passes.length} 项全部满足。`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
