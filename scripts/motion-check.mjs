#!/usr/bin/env node
/**
 * 动效自查：真实浏览器里确认 GSAP 接管后没有报错，
 * 首屏逐字、滚动揭示、数字滚动、进度线都真的动了。
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const dist = existsSync(path.join(distRoot, 'index.html'))
  ? distRoot
  : path.join(distRoot, 'client');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const serve = async () => {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let file = path.join(dist, urlPath);
      const info = await stat(file).catch(() => null);
      if (!info || info.isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
};

const findExecutable = () => {
  const candidates = [
    '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    '.cache/ms-playwright/chromium-1248/chrome-linux/chrome',
  ].map((entry) => path.join(os.homedir(), entry));
  return candidates.find((entry) => existsSync(entry));
};

const { server, origin } = await serve();
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({
  executablePath: findExecutable(),
  args: ['--no-sandbox'],
});

const shots = path.join(root, '..', 'shots', 'motion');
await mkdir(shots, { recursive: true });
const errors = [];

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

const heroState = await page.evaluate(() => ({
  motionClass: document.documentElement.classList.contains('hw-motion'),
  chars: document.querySelectorAll('[data-split] .hw-char').length,
  charOpacity: getComputedStyle(document.querySelector('[data-split] .hw-char')).opacity,
  charTransform: getComputedStyle(document.querySelector('[data-split] .hw-char')).transform,
  progress: getComputedStyle(document.querySelector('[data-scroll-progress]')).transform,
  glowVars: document
    .querySelector('[data-glow]')
    .style.getPropertyValue('--glow-x'),
}));

await page.screenshot({ path: path.join(shots, '01-first-paint.png') });

await page.mouse.move(420, 220);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(shots, '02-glow.png') });

await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' }));
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(shots, '03-facts.png') });

const factState = await page.evaluate(() => {
  const item = document.querySelector('.fact-item');
  return {
    revealed: item.classList.contains('is-revealed'),
    opacity: getComputedStyle(item).opacity,
    index: document.querySelector('.fact-index').textContent.trim(),
    progress: getComputedStyle(document.querySelector('[data-scroll-progress]')).transform,
  };
});

await page.evaluate(() => window.scrollTo({ top: 2000, behavior: 'instant' }));
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(shots, '04-people.png') });

const peopleState = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.list-row'));
  return {
    rows: rows.length,
    revealed: rows.filter((row) => row.classList.contains('is-revealed')).length,
    stillEnter: rows.filter((row) => row.classList.contains('enter')).length,
  };
});

// 移动端 + 减弱动效：GSAP 不该加载，元素必须直接可见
const reduced = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
});
await reduced.goto(origin, { waitUntil: 'networkidle' });
await reduced.waitForTimeout(900);
const reducedState = await reduced.evaluate(() => ({
  motionClass: document.documentElement.classList.contains('hw-motion'),
  revealOpacity: getComputedStyle(document.querySelector('.fact-item')).opacity,
  splitChars: document.querySelectorAll('[data-split] .hw-char').length,
}));
await reduced.screenshot({ path: path.join(shots, '05-reduced-motion.png') });

console.log(JSON.stringify({ heroState, factState, peopleState, reducedState, errors }, null, 2));

await browser.close();
server.close();
