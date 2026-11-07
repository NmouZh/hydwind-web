#!/usr/bin/env node
/**
 * 构建产物检查。
 *
 * 这是氢风官网的构建层测试缝：只读取 `bun run build` 产出的 dist/，
 * 按页面断言真实事实存在、编造内容不存在、关键页面与站内链接齐全。
 * 不引入任何依赖，也不检查具体 DOM 结构。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'dist');
/** @astrojs/node standalone 把静态产物放在 dist/client；老静态构建则直接落在 dist 根。 */
const dist = existsSync(path.join(buildDir, 'index.html'))
  ? buildDir
  : path.join(buildDir, 'client');

/** 进服指南的集合 id；页面与检查脚本共用同一个概念。 */
const JOIN_GUIDE_ID = 'join';

const failures = [];
const passes = [];

const fail = (message) => failures.push(message);
const pass = (message) => passes.push(message);

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
};

const decodeEntities = (value) =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');

const visibleText = (html) =>
  decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  );

const loadPage = async (relativePath, label) => {
  const target = path.join(dist, relativePath);
  if (!existsSync(target)) {
    fail(`缺少页面 ${label}（${relativePath}）`);
    return null;
  }
  pass(`页面存在：${label}`);
  const html = await readFile(target, 'utf8');
  return { relativePath, label, html, text: visibleText(html) };
};

const expectText = (page, needle, label) => {
  if (page.text.includes(needle)) {
    pass(`${page.label} 包含：${label}（${needle}）`);
  } else {
    fail(`${page.label} 缺少：${label}（应包含“${needle}”）`);
  }
};

const main = async () => {
  if (!existsSync(dist)) {
    console.error('dist/ 不存在，请先运行 bun run build');
    process.exit(1);
  }

  const requiredPages = [
    ['index.html', '首页 /'],
    ['guides/index.html', '指南索引 /guides/'],
    [`guides/${JOIN_GUIDE_ID}/index.html`, `进服指南 /guides/${JOIN_GUIDE_ID}/`],
    ['account/index.html', '账号页 /account/'],
    ['403/index.html', '无权限页 /403/'],
    ['404.html', '页面不存在 /404/'],
  ];

  const pages = new Map();
  for (const [relativePath, label] of requiredPages) {
    const loaded = await loadPage(relativePath, label);
    if (loaded) pages.set(relativePath, loaded);
  }

  const home = pages.get('index.html');
  const joinGuide = pages.get(`guides/${JOIN_GUIDE_ID}/index.html`);
  const account = pages.get('account/index.html');
  const forbiddenPage = pages.get('403/index.html');
  const notFound = pages.get('404.html');

  // —— 错误页：状态码、人话说明、可用出口，缺一个都算没做完 ——
  if (forbiddenPage) {
    expectText(forbiddenPage, '403', '无权限状态码');
    expectText(forbiddenPage, '站务', '无权限说明');
    expectText(forbiddenPage, '回到首页', '无权限页回首页出口');
  }
  if (notFound) {
    expectText(notFound, '404', '404 状态码');
    expectText(notFound, '进服指南', '404 页进服指南出口');
    expectText(notFound, '回到首页', '404 页回首页出口');
  }

  // —— 一级导航：进服已并入指南，账号是独立入口 ——
  if (home) {
    const topNav = home.html.match(
      /<nav[^>]*class="top-nav"[^>]*>([\s\S]*?)<\/nav>/
    )?.[1];
    const bottomNav = home.html.match(
      /<nav[^>]*class="bottom-nav"[^>]*>([\s\S]*?)<\/nav>/
    )?.[1];
    for (const [label, html] of [
      ['顶部导航', topNav],
      ['底部导航', bottomNav],
    ]) {
      if (!html) {
        fail(`${label}缺失`);
        continue;
      }
      for (const href of ['/guides/', '/people/', '/issues/', '/account/']) {
        if (html.includes(`href="${href}"`)) pass(`${label}包含 ${href}`);
        else fail(`${label}缺少 ${href}`);
      }
      if (/>\s*进服\s*</.test(html)) fail(`${label}仍有「进服」一级入口，应已并入指南`);
      else pass(`${label}没有单独的「进服」入口`);
    }
  }

  if (account) {
    expectText(account, '登录氢风', '账号页登录标题');
    expectText(account, '注册', '账号页注册说明');
  }

  // —— 首页必须自己呈现全部已确认事实 ——
  if (home) {
    const homeFacts = [
      ['服务器完整地址（含端口）', 'zzbgp2.coreyun.net:35282'],
      ['客户端版本范围', '1.8.9 – 26.3'],
      ['离线服务器', '离线'],
      ['暂时免费', '暂时免费'],
      ['QQ 群号', '1129694648'],
      ['服主游戏 ID', 'Nz_173'],
      ['测试期提示', '测试期'],
      ['世界可能重置提示', '世界可能重置'],
      ['无白名单说明', '白名单'],
      ['不需要安装模组', '模组'],
    ];
    for (const [label, fact] of homeFacts) expectText(home, fact, label);
  }

  // —— 进服指南页面自身必须包含测试期重置提示与进服步骤 ——
  if (joinGuide) {
    expectText(joinGuide, '世界可能重置', '测试期重置提示');
    expectText(joinGuide, '测试期提示', '测试期提示标题');
    for (const step of ['确认客户端', '添加服务器', '加入 QQ 群', '进入服务器']) {
      expectText(joinGuide, step, `进服步骤「${step}」`);
    }
  }

  // —— 人物列表与详情都由 SSR 路由提供（/people/、/people/[slug]/）：
  //    源码必须存在，构建期不能产出静态 HTML，运行时行为交给 smoke。
  for (const route of ['src/pages/people/index.astro', 'src/pages/people/[slug].astro']) {
    if (existsSync(path.join(root, route))) pass(`存在 SSR 路由源码：${route}`);
    else fail(`缺少 SSR 路由源码：${route}`);
  }
  const htmlFiles = (await walk(dist)).filter((file) => file.endsWith('.html'));
  const peopleArtifacts = htmlFiles
    .map((file) => path.relative(dist, file))
    .filter((relative) => relative === 'people/index.html' || relative.startsWith('people/'));
  if (peopleArtifacts.length === 0) {
    pass('人物页面由 SSR 提供，构建期未生成 people 静态产物');
  } else {
    for (const relative of peopleArtifacts) {
      fail(`人物页面应为 SSR，不应产出静态 HTML：${relative}`);
    }
  }

  // —— 每个页面都不得残留编造的旧内容 ——
  const forbidden = [
    '第八周目',
    '1.21.4',
    '1.21.x',
    '正常开放',
    '半公益',
    '主世界长期不删档',
    '资源世界每周六刷新',
    '每周六刷新',
    '七炫',
    'YunQi',
    'yunqi',
    '北岸',
    '铁道局',
    '红石工坊',
    'play.hydwind.com',
    '设计原型',
    '公开组织',
    '官方 wiki',
    '栏目页稍后补齐',
    '人物与组织内容为示例',
    'NmouZh',
  ];

  for (const file of htmlFiles) {
    const relative = path.relative(dist, file);
    const html = await readFile(file, 'utf8');
    const found = forbidden.filter((word) => html.includes(word));
    if (found.length > 0) {
      for (const word of found) {
        fail(`${relative} 残留编造内容：“${word}”`);
      }
    } else {
      pass(`${relative} 不含编造内容`);
    }
  }

  // —— 每页的 SEO 字段都必须真实有效 ——
  const canonicalBase = 'http://103.236.99.253:62179';
  for (const file of htmlFiles) {
    const relative = path.relative(dist, file);
    const html = await readFile(file, 'utf8');

    if (html.includes(`rel="canonical"`) && html.includes(canonicalBase)) {
      pass(`规范 URL 正确：${relative}`);
    } else {
      fail(`缺少规范 URL ${canonicalBase}：${relative}`);
    }

    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
    if (title.includes('氢风')) pass(`页面标题包含品牌：${relative}`);
    else fail(`页面标题缺少“氢风”：${relative}`);

    const description =
      html.match(/<meta name="description" content="([^"]*)"/i)?.[1] ?? '';
    if (description.trim().length >= 20) pass(`页面描述有效：${relative}`);
    else fail(`页面描述缺失或过短：${relative}`);
  }

  // —— 实时状态：公开 API、双数据源回退、无障碍播报 ——
  const indexHtml = home?.html ?? '';
  if (indexHtml.includes('https://api.mcsrvstat.us/3/')) {
    pass('状态查询使用 mcsrvstat 主数据源');
  } else {
    fail('首页缺少 mcsrvstat 状态查询');
  }
  if (indexHtml.includes('https://api.mcstatus.io/v2/status/java/')) {
    pass('状态查询包含 mcstatus 回退数据源');
  } else {
    fail('首页缺少 mcstatus 回退数据源');
  }
  if (/aria-live="(polite|assertive)"/.test(indexHtml)) {
    pass('状态区域使用 aria-live 播报');
  } else {
    fail('状态区域缺少 aria-live');
  }

  // —— 头像：本地 PNG，页面不依赖第三方运行时头像 ——
  const avatarPath = path.join(dist, 'images', 'nz-173.png');
  if (existsSync(avatarPath)) {
    const buffer = await readFile(avatarPath);
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.subarray(0, 8).toString('hex') === pngSignature) {
      pass('Nz_173 头像已保存为本地 PNG');
    } else {
      fail('Nz_173 头像不是有效 PNG');
    }
  } else {
    fail('缺少本地头像 dist/images/nz-173.png');
  }

  // 在线玩家没有正版头像时的兜底，必须是官方默认皮肤裁出的本地 PNG
  for (const [file, label] of [
    ['default-steve.png', 'Steve 默认头像'],
    ['default-alex.png', 'Alex 默认头像'],
  ]) {
    const fallbackPath = path.join(dist, 'images', 'avatars', file);
    if (!existsSync(fallbackPath)) {
      fail(`缺少默认头像 dist/images/avatars/${file}`);
      continue;
    }
    const buffer = await readFile(fallbackPath);
    if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      pass(`${label}已保存为本地 PNG`);
    } else {
      fail(`${label}不是有效 PNG`);
    }
  }
  const allHtml = (
    await Promise.all(htmlFiles.map((file) => readFile(file, 'utf8')))
  ).join('\n');
  if (allHtml.includes('/images/nz-173.png')) {
    pass('页面引用本地头像');
  } else {
    fail('页面未引用本地头像 /images/nz-173.png');
  }
  if (/minotar\.net|crafatar\.com|mc-heads\.net/.test(allHtml)) {
    fail('页面仍依赖第三方运行时头像服务');
  } else {
    pass('页面不依赖第三方运行时头像服务');
  }

  // —— 每个页面的站内链接都必须解析到构建产物 ——
  // /issues/、/login、/gate 和改用 SSR 的 /people/ 没有静态产物，单独放行。
  const serverRenderedRoutes = new Set([
    '/people/',
    '/issues/',
    '/login',
    '/login/',
    '/gate',
    '/gate/',
    '/edit',
    '/edit/',
  ]);
  const hrefPattern = /href="([^"]+)"/g;
  for (const file of htmlFiles) {
    const relative = path.relative(dist, file);
    const html = await readFile(file, 'utf8');
    const broken = new Set();

    for (const match of html.matchAll(hrefPattern)) {
      const href = match[1];
      if (
        !href.startsWith('/') ||
        href.startsWith('//') ||
        href.startsWith('/_astro/') ||
        href.startsWith('/favicon')
      ) {
        continue;
      }
      const clean = href.split('?')[0].split('#')[0];
      if (serverRenderedRoutes.has(clean)) continue;
      // 人物详情 /people/[slug]/ 是 SSR 路由，任何 slug 都在运行时解析，
      // 没有对应的 dist 静态文件。
      if (clean.startsWith('/people/') && clean !== '/people/') continue;
      if (!clean || clean === '/') {
        if (!existsSync(path.join(dist, 'index.html'))) broken.add(href);
        continue;
      }
      const decoded = decodeURIComponent(clean);
      const target = decoded.endsWith('/')
        ? path.join(dist, decoded, 'index.html')
        : path.extname(decoded)
          ? path.join(dist, decoded)
          : path.join(dist, decoded, 'index.html');
      if (!existsSync(target) || !(await stat(target)).isFile()) {
        broken.add(href);
      }
    }

    if (broken.size === 0) {
      pass(`${relative} 的内部链接全部可解析`);
    } else {
      for (const href of broken) fail(`${relative} 的内部链接失效：${href}`);
    }
  }

  // —— 服务器事实必须只存在于 site 单例，不能散落在页面/组件/内容里 ——
  const sourceDirs = [
    path.join(root, 'src', 'pages'),
    path.join(root, 'src', 'components'),
    path.join(root, 'src', 'lib'),
    path.join(root, 'src', 'content', 'guides'),
    path.join(root, 'src', 'content', 'people'),
  ];
  const factLiterals = [
    ['服务器地址', 'zzbgp2.coreyun.net'],
    ['QQ 群号', '1129694648'],
    ['客户端版本范围', '1.8.9 – 26.3'],
    ['离线服务器描述', '离线服务器'],
    ['无白名单说明', '没有白名单'],
    ['世界重置描述', '世界可能重置'],
    ['免费描述', '暂时免费'],
    ['模组要求', '不需要安装模组'],
    ['正版验证要求', '不需要正版验证'],
  ];
  let hardcoded = 0;
  for (const dir of sourceDirs) {
    if (!existsSync(dir)) continue;
    for (const file of await walk(dir)) {
      if (!/\.(astro|md|ts|mjs)$/.test(file)) continue;
      const source = await readFile(file, 'utf8');
      const relative = path.relative(root, file);
      for (const [label, literal] of factLiterals) {
        if (source.includes(literal)) {
          fail(`${relative} 硬编码了${label}：“${literal}”`);
          hardcoded += 1;
        }
      }
    }
  }
  if (hardcoded === 0) {
    pass('服务器事实只存在于 site 单例，页面与内容不硬编码');
  }

  // —— 内容文件确实由内容集合生成，而非页面硬编码 ——
  const contentFiles = [
    'src/content/site/info.md',
    'src/content/people/nz-173.md',
    `src/content/guides/${JOIN_GUIDE_ID}.md`,
    'src/content.config.ts',
    '.pages.yml',
  ];
  for (const relativePath of contentFiles) {
    if (existsSync(path.join(root, relativePath))) {
      pass(`存在内容/配置：${relativePath}`);
    } else {
      fail(`缺少内容/配置：${relativePath}`);
    }
  }

  if (failures.length > 0) {
    console.error('\n构建产物检查失败：');
    for (const message of failures) console.error(`  ✗ ${message}`);
    console.error(`\n通过 ${passes.length} 项，失败 ${failures.length} 项。`);
    process.exit(1);
  }

  console.log(`构建产物检查通过：${passes.length} 项全部满足。`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
