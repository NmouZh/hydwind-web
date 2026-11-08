/**
 * 全站动效层。
 *
 * 只负责「效果」：进场、滚动揭示、视差、柔光、数字滚动都由这里统一接管，
 * 页面里只写 `data-*` 属性，不在各页写动画逻辑（见 docs/ui-rules.md 第 8 条）。
 *
 * 当前支持的属性：
 * - `data-reveal`：滚动进入视口时升起（可配 `--reveal-delay`）
 * - `data-split`：标题逐字升起（首屏用）
 * - `data-parallax="0.12"`：随滚动做视差位移，数字是位移比例
 * - `data-glow`：鼠标跟随的柔光层（只给主视觉用）
 * - `data-magnetic`：按钮被指针轻吸（只给主操作按钮用）
 * - `data-roll="3"`：数字从 0 滚到目标值
 *
 * 降级顺序：
 * 1. `prefers-reduced-motion: reduce` → 全部直接可见，连 GSAP 都不加载；
 * 2. GSAP 加载失败 → 退回 base.css 的 CSS 过渡 + `.is-revealed`；
 * 3. 其余情况 → GSAP 接管，`html.hw-motion` 关掉同名的 CSS 过渡避免两套动画打架。
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** 把 `--md-sys-motion-duration-medium4: 400ms` 这类 token 读成 GSAP 用的秒数。 */
const durationToken = (name: string, fallbackMs: number): number => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return (Number.isFinite(value) && value > 0 ? value : fallbackMs) / 1000;
};

/** 读取元素上的延迟 token（如 `--reveal-delay: 80ms`），转成秒。 */
const delayOf = (element: HTMLElement, name: string): number => {
  const raw = getComputedStyle(element).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value / 1000 : 0;
};

const revealImmediately = (targets: readonly HTMLElement[]): void => {
  targets.forEach((target) => target.classList.add('is-revealed'));
};

/**
 * 把标题拆成单字，外层保留完整 label 给读屏。
 * 不套 overflow 遮罩：`line-height: 0.92` 的主视觉标题会被裁掉字头。
 */
const splitChars = (element: HTMLElement): HTMLElement[] => {
  const text = element.textContent ?? '';
  const label = text.trim();
  if (label === '') return [];

  const chars: HTMLElement[] = [];
  const fragment = document.createDocumentFragment();

  Array.from(text).forEach((char) => {
    if (char.trim() === '') {
      fragment.append(document.createTextNode('\u00a0'));
      return;
    }
    const span = document.createElement('span');
    span.className = 'hw-char';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = char;
    fragment.append(span);
    chars.push(span);
  });

  element.setAttribute('aria-label', label);
  element.textContent = '';
  element.append(fragment);
  return chars;
};

export const initMotion = async (): Promise<void> => {
  const revealTargets = Array.from(
    document.querySelectorAll<HTMLElement>('[data-reveal]')
  );

  if (window.matchMedia(REDUCED_MOTION).matches) {
    revealImmediately(revealTargets);
    return;
  }

  let gsap: typeof import('gsap').gsap;
  let ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;

  try {
    const [core, plugin] = await Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger'),
    ]);
    gsap = core.gsap;
    ScrollTrigger = plugin.ScrollTrigger;
  } catch {
    // 动效是装饰，加载失败就让内容直接可读
    revealImmediately(revealTargets);
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  const html = document.documentElement;
  html.classList.add('hw-motion');

  const revealDuration = durationToken('--md-sys-motion-duration-medium4', 400) * 1.7;
  const reduced = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /** 先把元素压到起点，再交给 ScrollTrigger 放行。 */
  const stage = (targets: readonly HTMLElement[], distance: number): void => {
    gsap.set(targets, { opacity: 0, y: distance, filter: 'blur(8px)' });
  };

  const revealBatch = (targets: readonly HTMLElement[], distance = 22): void => {
    if (targets.length === 0) return;
    stage(targets, distance);

    ScrollTrigger.batch(targets as HTMLElement[], {
      start: 'top 88%',
      once: true,
      onEnter: (batch) => {
        batch.forEach((element, index) => {
          gsap.to(element, {
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: revealDuration,
            delay: index * 0.08 + delayOf(element as HTMLElement, '--reveal-delay'),
            ease: 'power3.out',
            overwrite: true,
            onComplete: () => {
              element.classList.add('is-revealed');
              gsap.set(element, { clearProps: 'opacity,transform,filter' });
            },
          });
        });
      },
    });
  };

  // 1. 顶部滚动进度线
  const progress = document.querySelector<HTMLElement>('[data-scroll-progress]');
  if (progress) {
    gsap.set(progress, { scaleX: 0 });
    gsap.to(progress, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 'top top', end: 'bottom bottom', scrub: 0.4 },
    });
  }

  // 2. 首屏逐字升起 + 英文字距收拢
  const chars = Array.from(document.querySelectorAll<HTMLElement>('[data-split]')).flatMap(
    splitChars
  );
  const heroEn = Array.from(document.querySelectorAll<HTMLElement>('[data-hero] .hero-en'));

  if (chars.length > 0) {
    gsap.set(chars, { yPercent: 110, opacity: 0, filter: 'blur(6px)' });
    gsap.to(chars, {
      yPercent: 0,
      opacity: 1,
      filter: 'blur(0px)',
      duration: revealDuration * 1.15,
      stagger: 0.09,
      ease: 'power3.out',
      onComplete: () => gsap.set(chars, { clearProps: 'transform,filter,opacity' }),
    });
  }

  heroEn.forEach((element, index) => {
    gsap.set(element, { opacity: 0, letterSpacing: '0.7em' });
    gsap.to(element, {
      opacity: 1,
      letterSpacing: '0.42em',
      duration: revealDuration * 1.4,
      delay: 0.08 + index * 0.06,
      ease: 'power2.out',
      onComplete: () => gsap.set(element, { clearProps: 'opacity,letterSpacing' }),
    });
  });

  // 3. 视差：主视觉里比背景慢半拍
  document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((element) => {
    const strength = Number.parseFloat(element.dataset.parallax ?? '') || 0.12;
    gsap.to(element, {
      yPercent: -100 * strength,
      ease: 'none',
      scrollTrigger: {
        trigger: element.closest('section') ?? element,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });
  });

  // 4. 首屏主视觉整体上移，滚走时不黏在顶上
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (hero && !reduced) {
    gsap.to(hero.querySelectorAll('.hero-main'), {
      yPercent: -6,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
    });
  }

  // 5. 鼠标跟随柔光
  if (reduced) {
    document.querySelectorAll<HTMLElement>('[data-glow]').forEach((host) => {
      const state = { x: 50, y: 0 };
      const apply = (): void => {
        host.style.setProperty('--glow-x', `${state.x}%`);
        host.style.setProperty('--glow-y', `${state.y}%`);
      };

      host.addEventListener('pointermove', (event) => {
        const rect = host.getBoundingClientRect();
        gsap.to(state, {
          x: ((event.clientX - rect.left) / rect.width) * 100,
          y: ((event.clientY - rect.top) / rect.height) * 100,
          duration: 0.6,
          ease: 'power2.out',
          overwrite: true,
          onUpdate: apply,
        });
      });

      host.addEventListener('pointerleave', () => {
        gsap.to(state, { x: 50, y: 0, duration: 0.8, ease: 'power2.out', onUpdate: apply });
      });
    });
  }

  // 6. 主操作按钮被指针轻吸
  if (reduced) {
    document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((element) => {
      const xTo = gsap.quickTo(element, 'x', { duration: 0.45, ease: 'power3.out' });
      const yTo = gsap.quickTo(element, 'y', { duration: 0.45, ease: 'power3.out' });

      element.addEventListener('pointermove', (event) => {
        const rect = element.getBoundingClientRect();
        xTo((event.clientX - (rect.left + rect.width / 2)) * 0.16);
        yTo((event.clientY - (rect.top + rect.height / 2)) * 0.2);
      });

      element.addEventListener('pointerleave', () => {
        xTo(0);
        yTo(0);
      });
    });
  }

  // 7. 数字从 0 滚到目标值
  document.querySelectorAll<HTMLElement>('[data-roll]').forEach((element) => {
    const target = Number.parseInt(element.dataset.roll ?? '', 10);
    if (!Number.isFinite(target)) return;

    const digits = (element.textContent ?? '').trim().length || String(target).length;
    const counter = { value: 0 };

    ScrollTrigger.create({
      trigger: element,
      start: 'top 92%',
      once: true,
      onEnter: () => {
        gsap.to(counter, {
          value: target,
          duration: revealDuration,
          ease: 'power2.out',
          onUpdate: () => {
            element.textContent = String(Math.round(counter.value)).padStart(digits, '0');
          },
        });
      },
    });
  });

  // 8. 首屏之外的列表行改成滚动揭示：否则它们在屏幕外就把进场放完了
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.list-row.enter'));
  const deferredRows = rows.filter((row) => {
    if (row.getBoundingClientRect().top <= window.innerHeight) return false;
    row.classList.remove('enter');
    return true;
  });

  revealBatch(deferredRows, 18);

  // 9. 页面自带的滚动出现（data-reveal）统一交给 ScrollTrigger
  revealBatch(revealTargets, 22);

  // 字体和图片会改变高度，布局稳定后再校准一次触发点
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
};
