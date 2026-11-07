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
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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

const findExecutable = () => {
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_PATH];

  // playwright-core install 的版本目录名带 build 号，不写死 1248；
  // CI 与本地缓存里出现哪个版本都能找到。
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const name of readdirSync(cache).sort().reverse()) {
      if (name.startsWith('chromium_headless_shell-')) {
        candidates.push(
          path.join(cache, name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          path.join(cache, name, 'chrome-linux', 'chrome-headless-shell')
        );
      }
      if (name.startsWith('chromium-')) {
        candidates.push(
          path.join(cache, name, 'chrome-linux', 'chrome'),
          path.join(cache, name, 'chrome-linux64', 'chrome')
        );
      }
    }
  }

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

/** 等某个元素内包含（或不再包含）指定文字；超时返回 false，由调用方记一条失败。 */
const waitForText = async (page, selector, text, present = true) => {
  try {
    await page.waitForFunction(
      ({ selector: target, text: expected, present: shouldContain }) => {
        const content = document.querySelector(target)?.textContent ?? '';
        return content.includes(expected) === shouldContain;
      },
      { selector, text, present },
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
};

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
 * 启动真实 standalone server，使用临时数据目录，返回 origin 和关闭函数。
 * SSR 页面（/people/）和 API 都必须走这个服务，静态文件服务已经不够用了。
 */
const startStandaloneServer = async (env = {}) => {
  const entry = path.join(buildDir, 'server', 'entry.mjs');
  if (!existsSync(entry)) {
    throw new Error('找不到 dist/server/entry.mjs（先 npm run build）');
  }

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'hydwind-smoke-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      HYDWIND_DATA_DIR: dataDir,
      ...env,
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
    await rm(dataDir, { recursive: true, force: true });
  };

  try {
    await waitForHttp(`${origin}/api/health`);
  } catch (error) {
    await close();
    throw error;
  }

  return { origin, close, stderr: () => stderr };
};

/**
 * API 冒烟：真实启动 standalone server，所有状态都通过 HTTP 验证。
 * 不依赖 Chromium，CI 里一定能跑；账号与登录码写在临时数据目录，测完删除。
 */
const apiSmoke = async () => {
  const pluginToken = 'smoke-plugin-token';
  const adminToken = 'smoke-admin-token';
  const username = 'SmokePlayer';
  const uuid = '123e4567-e89b-12d3-a456-426614174000';

  let server;
  try {
    server = await startStandaloneServer({
      PLUGIN_TOKEN: pluginToken,
      ISSUE_ADMIN_TOKEN: adminToken,
      SESSION_SECRET: 'smoke-session-secret-0123456789',
    });
  } catch (error) {
    failures.push(`/api 冒烟：${String(error).split('\n')[0]}`);
    return;
  }
  const { origin } = server;

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

  /** 带 cookie / Origin 的 JSON 请求，返回状态码、解析后的 body 和响应头。 */
  const requestJson = async (
    pathname,
    { method = 'GET', cookie, body, requestOrigin, headers = {} } = {}
  ) => {
    const requestHeaders = { ...headers };
    if (cookie) requestHeaders.cookie = cookie;
    if (requestOrigin) requestHeaders.origin = requestOrigin;
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, body: payload, headers: response.headers };
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

    // —— 传记：插件校验成功后自动创建，本人可编辑，公开可读 ——
    const autoBiography = await requestJson(`/api/people/${username}/biography`);
    check(
      autoBiography.status === 200 &&
        autoBiography.body?.gameId === username &&
        autoBiography.body?.mainTitle === `${username}的人物传记` &&
        autoBiography.body?.body === '',
      '/api/plugin/login/verify 成功后自动创建默认传记'
    );

    const publicBiography = await requestJson('/api/people/nz-173/biography');
    check(
      publicBiography.status === 200 && publicBiography.body?.gameId === 'Nz_173',
      'GET /api/people/:id/biography 公开返回传记'
    );

    const missingBiography = await requestJson('/api/people/no-such-player/biography');
    check(
      missingBiography.status === 404,
      'GET /api/people/:id/biography 未知 slug 返回 404'
    );

    const anonymousPut = await requestJson(`/api/people/${username}/biography`, {
      method: 'PUT',
      body: { mainTitle: '匿名写入', body: '不应成功' },
    });
    check(anonymousPut.status === 401, 'PUT 传记未登录返回 401');

    const foreignPut = await requestJson('/api/people/nz-173/biography', {
      method: 'PUT',
      cookie,
      body: { mainTitle: '越权写入', body: '不应成功' },
    });
    check(foreignPut.status === 403, 'PUT 别人的传记返回 403');

    const unknownPut = await requestJson('/api/people/no-such-player/biography', {
      method: 'PUT',
      cookie,
      body: { mainTitle: '不存在的玩家', body: '不应成功' },
    });
    check(unknownPut.status === 404, 'PUT 未知人物返回 404');

    const savedTitle = '冒烟玩家的人物传记';
    const savedBiography = await requestJson(`/api/people/${username}/biography`, {
      method: 'PUT',
      cookie,
      body: { mainTitle: savedTitle, body: '## 冒烟正文\n\n自动创建后可以编辑。' },
    });
    check(
      savedBiography.status === 200 &&
        savedBiography.body?.mainTitle === savedTitle &&
        savedBiography.body?.body?.includes('冒烟正文'),
      'PUT 自己的传记返回 200 并保存标题与正文'
    );

    // 保存限流：10 分钟 12 次；上一步已用 1 次，再发 12 次应 11 次成功、第 13 次 429。
    const extraSaveStatuses = [];
    for (let index = 0; index < 12; index += 1) {
      const result = await requestJson(`/api/people/${username}/biography`, {
        method: 'PUT',
        cookie,
        body: { mainTitle: savedTitle, body: '限流测试正文' },
      });
      extraSaveStatuses.push(result.status);
    }
    check(
      extraSaveStatuses.slice(0, 11).every((status) => status === 200) &&
        extraSaveStatuses[11] === 429,
      'PUT 传记 10 分钟 12 次后返回 429'
    );

    // —— 评论：公开读取，登录发表，作者或管理员删除 ——
    // 评论嵌在传记记录里，必须发到已自动建传的账号，而不是只有静态资料的人物。
    const commentsPath = `/api/people/${username}/comments`;
    const publicComments = await requestJson(commentsPath);
    check(
      publicComments.status === 200 && Array.isArray(publicComments.body?.comments),
      'GET 评论公开返回 200 与评论数组'
    );

    const missingComments = await requestJson('/api/people/no-such-player/comments');
    check(missingComments.status === 404, 'GET 评论未知 slug 返回 404');

    const anonymousComment = await requestJson(commentsPath, {
      method: 'POST',
      body: { body: '匿名评论' },
    });
    check(anonymousComment.status === 401, 'POST 评论未登录返回 401');

    const foreignOriginComment = await requestJson(commentsPath, {
      method: 'POST',
      cookie,
      requestOrigin: 'https://evil.example',
      body: { body: '跨站评论' },
    });
    check(foreignOriginComment.status === 403, 'POST 评论跨站来源返回 403');

    const unknownComment = await requestJson('/api/people/no-such-player/comments', {
      method: 'POST',
      cookie,
      requestOrigin: origin,
      body: { body: '不存在的玩家' },
    });
    check(unknownComment.status === 404, 'POST 评论未知人物返回 404');

    const ownedComment = await requestJson(commentsPath, {
      method: 'POST',
      cookie,
      requestOrigin: origin,
      body: { body: '冒烟玩家自己的评论' },
    });
    check(
      ownedComment.status === 201 && Boolean(ownedComment.body?.comment?.id),
      'POST 评论返回 201 与评论 id'
    );

    // 第二个账号：验证 403 删除别人的评论，以及作者删除自己的评论。
    const otherUsername = 'SmokeOther';
    const otherRegisterResponse = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: otherUsername,
        platformId: 'qq-smoke-other',
        nickname: '冒烟路人',
      }),
    });
    const otherRegistered = await otherRegisterResponse.json();
    check(
      otherRegisterResponse.status === 200 &&
        otherRegistered.username === otherUsername &&
        typeof otherRegistered.password === 'string',
      '/api/auth/register 创建第二个临时账号'
    );

    const otherLoggedIn = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: otherUsername,
        password: otherRegistered.password,
      }),
    });
    const otherCookie = (otherLoggedIn.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0])
      .join('; ');
    check(
      otherLoggedIn.status === 200 && otherCookie.length > 0,
      '第二个账号登录返回会话 cookie'
    );

    const otherComment = await requestJson(commentsPath, {
      method: 'POST',
      cookie: otherCookie,
      requestOrigin: origin,
      body: { body: '另一个玩家的评论' },
    });
    check(
      otherComment.status === 201 && Boolean(otherComment.body?.comment?.id),
      '第二个账号可以发表评论'
    );

    const anonymousDelete = await requestJson(
      `${commentsPath}/${ownedComment.body?.comment?.id}`,
      { method: 'DELETE' }
    );
    check(anonymousDelete.status === 401, 'DELETE 评论未登录返回 401');

    const foreignOriginDelete = await requestJson(
      `${commentsPath}/${otherComment.body?.comment?.id}`,
      {
        method: 'DELETE',
        cookie: otherCookie,
        requestOrigin: 'https://evil.example',
      }
    );
    check(foreignOriginDelete.status === 403, 'DELETE 评论跨站来源返回 403');

    const notOwnerDelete = await requestJson(
      `${commentsPath}/${ownedComment.body?.comment?.id}`,
      { method: 'DELETE', cookie: otherCookie, requestOrigin: origin }
    );
    check(notOwnerDelete.status === 403, 'DELETE 别人的评论返回 403');

    const missingCommentDelete = await requestJson(
      `${commentsPath}/00000000-0000-4000-8000-000000000000`,
      { method: 'DELETE', cookie, requestOrigin: origin }
    );
    check(missingCommentDelete.status === 404, 'DELETE 不存在的评论返回 404');

    const missingPersonDelete = await requestJson(
      `/api/people/no-such-player/comments/${ownedComment.body?.comment?.id}`,
      { method: 'DELETE', cookie, requestOrigin: origin }
    );
    check(missingPersonDelete.status === 404, 'DELETE 未知人物评论返回 404');

    const ownDelete = await requestJson(
      `${commentsPath}/${otherComment.body?.comment?.id}`,
      { method: 'DELETE', cookie: otherCookie, requestOrigin: origin }
    );
    check(
      ownDelete.status === 200 && ownDelete.body?.deleted === true,
      'DELETE 自己的评论返回 200'
    );

    // 评论限流：每账号 10 分钟 5 条。SmokePlayer 已发 1 条，再发 4 条后第 6 条 429。
    const extraCommentStatuses = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await requestJson(commentsPath, {
        method: 'POST',
        cookie,
        requestOrigin: origin,
        body: { body: `限流评论 ${index + 1}` },
      });
      extraCommentStatuses.push(result.status);
    }
    const limitedComment = await requestJson(commentsPath, {
      method: 'POST',
      cookie,
      requestOrigin: origin,
      body: { body: '超出限流的评论' },
    });
    check(
      extraCommentStatuses.every((status) => status === 201) &&
        limitedComment.status === 429,
      'POST 评论 10 分钟 5 条后返回 429'
    );

    const commentsAfter = await requestJson(commentsPath);
    check(
      commentsAfter.status === 200 &&
        commentsAfter.body?.comments?.length >= 5,
      'GET 评论返回已发表的全部评论'
    );

    // /people/ 已改为 SSR：构建期没有静态 HTML，必须从真实服务取到合并结果。
    const peoplePage = await fetch(`${origin}/people/`);
    const peopleHtml = await peoplePage.text();
    check(peoplePage.status === 200, '/people/ SSR 返回 200');
    check(
      peopleHtml.includes('服务器里真实存在的人'),
      '/people/ SSR 渲染页面标题'
    );
    check(
      peopleHtml.includes('Nz_173'),
      '/people/ SSR 合并静态人物'
    );
    check(
      peopleHtml.includes(username),
      '/people/ SSR 列出已注册账号'
    );

    // 人物详情同样是 SSR：默认标题 / 游戏 ID / 空状态 / 评论区都要现场出现。
    const personPageResponse = await fetch(`${origin}/people/nz-173/`);
    const personHtml = await personPageResponse.text();
    check(personPageResponse.status === 200, '/people/nz-173/ SSR 返回 200');
    check(
      personHtml.includes('Nz_173的人物传记'),
      '/people/nz-173/ SSR 显示默认主标题'
    );
    check(personHtml.includes('游戏 ID'), '/people/nz-173/ SSR 显示游戏 ID');
    check(
      personHtml.includes('正版账号 UUID'),
      '/people/nz-173/ SSR 渲染静态人物正文'
    );
    // 静态人物自带正文，详情页不应同时显示「正文尚未填写」。
    check(
      !personHtml.includes('正文尚未填写'),
      '/people/nz-173/ 有静态正文时不显示空状态'
    );
    check(personHtml.includes('聊两句'), '/people/nz-173/ SSR 显示评论区');
    check(personHtml.includes('服主'), '/people/nz-173/ SSR 保留静态人物身份');

    // 账号 slug 的详情页也必须由同一套 SSR 现场解析。
    const accountPageResponse = await fetch(`${origin}/people/${username.toLowerCase()}/`);
    const accountHtml = await accountPageResponse.text();
    check(accountPageResponse.status === 200, '/people/<slug>/ 账号传记 SSR 返回 200');
    check(accountHtml.includes(username), '/people/<slug>/ SSR 显示游戏 ID');
    check(
      accountHtml.includes(savedTitle),
      '/people/<slug>/ SSR 显示已保存的主标题'
    );
  } catch (error) {
    failures.push(`/api 冒烟执行失败：${String(error).split('\n')[0]}`);
    const stderr = server.stderr();
    if (stderr.trim()) console.error(stderr.trim().split('\n').slice(-10).join('\n'));
  } finally {
    await server.close();
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
    skipBrowser('找不到本地 Playwright Chromium（可运行 npx playwright-core install chromium）');
    return;
  }

  // 浏览器也走真实 standalone server：/people/ 是 SSR，静态文件服务取不到。
  let server;
  try {
    server = await startStandaloneServer({
      SESSION_SECRET: 'smoke-session-secret-0123456789',
      ISSUE_ADMIN_TOKEN: 'smoke-admin-token',
    });
  } catch (error) {
    failures.push(`浏览器冒烟服务启动失败：${String(error).split('\n')[0]}`);
    return;
  }
  const { origin } = server;

  // 通过真实接口建一个临时账号并登录，把会话 cookie 塞进浏览器上下文，
  // 后面的传记编辑 / 评论 / 删除都在登录态下执行。
  const browserUser = 'BrowserSmoke';
  let browserSession = '';
  try {
    const registerResponse = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer smoke-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: browserUser, platformId: 'qq-browser-smoke' }),
    });
    const registered = await registerResponse.json();
    const loginResponse = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: browserUser, password: registered.password }),
    });
    const cookieHeader = (loginResponse.headers.getSetCookie?.() ?? []).find((value) =>
      value.startsWith('hydwind_session=')
    );
    browserSession = decodeURIComponent(
      (cookieHeader ?? '').split(';')[0].slice('hydwind_session='.length)
    );
    check(
      registerResponse.status === 200 && loginResponse.status === 200 && browserSession.length > 0,
      '浏览器冒烟临时账号注册并登录'
    );
  } catch (error) {
    failures.push(`浏览器冒烟登录准备失败：${String(error).split('\n')[0]}`);
  }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
  } catch (error) {
    await server.close();
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
    if (browserSession) {
      await desktop.addCookies([
        { name: 'hydwind_session', value: browserSession, url: origin },
      ]);
    }
    await desktop.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin,
    });
    await desktop.route('**/api.mcsrvstat.us/**', fulfillStatus);
    await desktop.route('**/api.mcstatus.io/**', fulfillStatus);

    const page = await desktop.newPage();
    page.on('pageerror', (error) => {
      console.error(`浏览器页面脚本错误：${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`浏览器 console：${message.text()}`);
    });
    page.on('response', (response) => {
      if (response.url().includes('/comments')) {
        console.log(`评论接口 ${response.request().method()} ${response.status()} ${response.url()}`);
      }
    });
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
    check(personText.includes('正版账号 UUID'), 'SSR 人物页渲染静态正文');
    // 静态人物有正文时，列表与详情页都不应说「尚未填写」。
    check(!personText.includes('正文尚未填写'), '有静态正文时详情页不显示空状态');
    check(personText.includes('聊两句'), 'SSR 人物页显示评论区');

    // —— 登录后的编辑 / 评论浏览器冒烟 ——
    // 账号 slug 的详情页：本人可以改传记、发评论、删评论。
    await page.goto(`${origin}/people/${browserUser.toLowerCase()}/`, {
      waitUntil: 'networkidle',
    });
    check(
      await page.locator('[data-bio-editor]').isVisible(),
      '登录后传记页显示编辑器'
    );

    await page.fill('[data-bio-title-input]', '浏览器写的传记');
    await page.fill('[data-bio-input]', '## 浏览器正文\n\n保存后立即出现。');
    await page.click('[data-bio-submit]');
    check(
      await waitForText(page, '[data-bio-status]', '传记保存好了'),
      '浏览器保存传记返回成功状态'
    );
    check(
      (await page.locator('[data-bio-body]').innerText()).includes('浏览器正文'),
      '保存后正文原地更新'
    );
    check(
      (await page.locator('[data-bio-title]').innerText()).includes('浏览器写的传记'),
      '保存后主标题原地更新'
    );

    await page.fill('[data-comment-input]', '浏览器评论一条');
    await page.click('[data-comment-submit]');
    const commented = await waitForText(page, '[data-comment-list]', '浏览器评论一条');
    if (!commented) {
      console.error(
        `评论未出现；状态：${await page.locator('[data-comment-status]').innerText().catch(() => '')}`
      );
    }
    check(commented, '登录后可以通过界面发表评论');

    const deleteButtons = page.locator('[data-comment-delete]');
    const deleteCount = await deleteButtons.count();
    if (deleteCount > 0) {
      await deleteButtons.first().click();
      check(
        await waitForText(page, '[data-comment-list]', '浏览器评论一条', false),
        '评论作者可以通过界面删除自己的评论'
      );
    } else {
      check(false, '评论作者可以看到删除按钮');
    }

    // 静态人物尚无运行期传记：评论接口会先 ensure 空传记，不能 404。
    await page.goto(`${origin}/people/nz-173/`, { waitUntil: 'networkidle' });
    await page.fill('[data-comment-input]', '给静态人物留言');
    await page.click('[data-comment-submit]');
    check(
      await waitForText(page, '[data-comment-list]', '给静态人物留言'),
      '静态人物无运行期记录时也能从界面发表评论'
    );

    await page.goto(`${origin}/people/`, { waitUntil: 'networkidle' });
    check(
      await page.locator('.people-search-label').isVisible(),
      '人物搜索框有可见标签'
    );

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
      await page.goto(`${origin}${relativePath}`, { waitUntil: 'load' });
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
        waitUntil: 'load',
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
    await server.close();
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
