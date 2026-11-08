/*
 * 首帧主题与跨文档过渡时序。
 *
 * 必须是外部同步脚本：CSP 的 script-src 只自动 hash Astro 处理过的内联脚本，
 * is:inline 内联脚本会被拒绝；放到 public 由 'self' 放行，且在解析 body 前执行，
 * 不会出现深色用户先闪浅色的问题。
 */
(() => {
  try {
    const stored = localStorage.getItem('hydwind-theme');
    const dark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document
      .querySelector('meta[data-theme-color]')
      ?.setAttribute('content', dark ? '#0e141c' : '#f8f9ff');
  } catch {
    document.documentElement.dataset.theme = 'light';
  }

  /*
   * 跨文档换页：
   * - 常驻 chrome 留在 root 快照里，root 本身不做动画，页头/底栏不会闪、不会消失；
   * - 只有 main 和当前项胶囊各自过渡；
   * - 这里把「过渡何时结束」变成 promise，动效层等它跑完再接管，
   *   否则 GSAP 的 opacity: 0 会被截进新页面快照。
   */
  window.__hwViewTransition = new Promise((resolve) => {
    let settled = false;

    const finish = (transition) => {
      if (settled) return;
      settled = true;
      resolve(transition ?? null);
    };

    window.addEventListener(
      'pagereveal',
      (event) => {
        if (!event.viewTransition) return finish(null);

        const root = document.documentElement;
        root.dataset.vt = 'cross';
        window.hydwindViewTransition = event.viewTransition;

        event.viewTransition.finished
          .then(() => {
            root.dataset.vt = 'settled';
          })
          .catch(() => {
            root.dataset.vt = 'settled';
          })
          .finally(() => finish(event.viewTransition));
      },
      { once: true }
    );

    // 直接打开、bfcache 恢复、浏览器不支持过渡：load 后放行动效层
    window.addEventListener(
      'load',
      () => {
        setTimeout(() => finish(null), 0);
      },
      { once: true }
    );

    // 兜底：任何异常情况下都不让动效层永远等下去
    setTimeout(() => finish(null), 2000);
  });

  // 动效层整体没跑起来（脚本被阻断 / bundle 失败）时，
  // 别把 [data-reveal] 永久留在 opacity: 0。没有 JS 的情况由 noscript 兜底。
  window.addEventListener(
    'load',
    () => {
      setTimeout(() => {
        if (document.documentElement.classList.contains('hw-motion')) return;
        document
          .querySelectorAll('[data-reveal]')
          .forEach((element) => element.classList.add('is-revealed'));
      }, 2500);
    },
    { once: true }
  );
})();