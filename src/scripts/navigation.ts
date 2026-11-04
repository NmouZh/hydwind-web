/**
 * 站内跳转的手感层。
 *
 * 三件事分工明确，别重复造：
 * 1. 预取：`astro.config.mjs` 里的 `prefetch`（viewport 策略，手机桌面都覆盖）；
 * 2. 淡入淡出：`base.css` 的 `@view-transition { navigation: auto }`，跨文档原生过渡；
 * 3. 这里只补 CSS 补不了的两点 —— 点击瞬间点亮顶部进度条、给导航项一个按下反馈。
 *
 * 不改路由：全部走浏览器原生跳转，浏览器前进后退、右键新开标签都不受影响。
 */

const NAVIGABLE = 'a[href]';

const shouldHandle = (anchor: HTMLAnchorElement, event: MouseEvent): boolean => {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  if (anchor.dataset.noTransition !== undefined) return false;

  const raw = anchor.getAttribute('href') ?? '';
  if (raw === '' || raw.startsWith('#')) return false;

  let url: URL;
  try {
    url = new URL(raw, location.href);
  } catch {
    return false;
  }

  if (url.origin !== location.origin) return false;
  // 同一页里换锚点不算换页
  if (url.pathname === location.pathname && url.search === location.search) return false;

  return true;
};

export const initNavigation = (): void => {
  const html = document.documentElement;
  const bar = document.querySelector<HTMLElement>('[data-nav-progress]');
  let leaving = false;

  const reset = (): void => {
    leaving = false;
    html.removeAttribute('data-navigating');
    html.removeAttribute('data-vt-flat');
    bar?.removeAttribute('data-active');
  };

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>(NAVIGABLE);
      if (!anchor || !shouldHandle(anchor, event)) return;

      leaving = true;
      html.setAttribute('data-navigating', '');
      bar?.setAttribute('data-active', '');

      const navItem = anchor.closest<HTMLElement>('[data-nav-key]');
      if (navItem) {
        navItem.setAttribute('data-pressed', '');
        window.setTimeout(() => navItem.removeAttribute('data-pressed'), 180);
      }
    },
    { capture: false }
  );

  // 浏览器后退时从 bfcache 恢复：把状态清干净，否则进度条会一直亮着
  window.addEventListener('pageshow', (event) => {
    if (event.persisted || document.readyState === 'complete') reset();
  });

  // 链接在下载 / 打开同一页时没有 unload，兜底把进度条收掉
  window.addEventListener('pagehide', () => {
    if (leaving) bar?.setAttribute('data-active', '');
  });
};
