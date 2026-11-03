# UI 规矩

氢风官网的界面规则。**改任何页面前先读这一页**，和这里的约定不一致的写法要么改页面，要么先改这份文档。

好处很实际：之前登录页和议题页各自写了一份 `hero-card`，样式写在 `index.astro` 的 scoped style 里，别的页面拿到类名却拿不到样式，同一个"主视觉卡"在不同页面长得不一样。所以现在统一收口。

## 1. 颜色、字体、形状、动效只能用 token

- 颜色：`var(--md-sys-color-*)`
- 字体：`var(--md-sys-typescale-*-size)`、`var(--md-sys-typescale-font)`
- 圆角：`var(--md-sys-shape-corner-*)`（`extra-small` / `small` / `medium` / `large` / `extra-large` / `full`）
- 阴影：`var(--hw-elevation-flat / raised / overlay)`，`--md-sys-elevation-*` 是它的别名
- 卡片描边统一用 1px `var(--md-sys-color-outline-variant)`，默认不用阴影，hover 才抬起
- 动效：`var(--md-sys-motion-duration-*)`、`var(--md-sys-motion-easing-standard)`

禁止在页面里写死 `#rrggbb`、`rgba()`、`px` 圆角、`0.2s` 这类字面值。需要半透明时用 `color-mix(in srgb, var(--token) N%, transparent)`。token 只在 `src/styles/md3-tokens.css` 里定义，由 `scripts/generate-md3-tokens.mjs` 生成，不要手改。

深浅色都要成立：新增颜色一律引用 token，深色模式由 `data-theme="dark"` 自动切换，页面里不要写 `[data-theme]` 分支（`TopAppBar` 的主题图标除外）。

## 2. 页面骨架

内容页统一是这三层，别自创结构：

```astro
<BaseLayout title="… · 氢风 Hydwind" description="…" current="guides">
  <div class="hw-shell page-shell">
    <header class="page-header enter">
      <p class="hw-eyebrow">指南</p>
      <h1>一句话说清这页做什么</h1>
      <p class="page-lede">补充说明，1～2 句。</p>
      <div class="page-actions">…主操作按钮…</div>
    </header>
    …
  </div>
</BaseLayout>
```

- `hw-shell`：唯一的宽度容器，不要在页面里另写 `max-width` 居中。
- `page-shell`：内容页上边距。
- `page-header` / `hw-eyebrow` / `page-lede` / `page-actions`：页头四件套，顺序固定。
- 首屏区块想要"强调感"用 `hero-card`，普通区块用 `panel`。
- 详情页要有 `breadcrumb`，返回链接放在 `page-actions` 里。

## 3. 导航只有一处数据源

一级导航写在 `src/lib/nav.ts` 的 `NAV_ITEMS`，`TopAppBar` 和 `BottomNav` 都读它。规矩：

- 固定 5 项，顺序不变：首页 / 指南 / 人物 / 议题 / 账号。
- 页面通过 `<BaseLayout current="…">` 传当前 key，值必须是 `NavKey`。
- 子页面高亮父级：`/guides/join/` 属于「指南」，`current="guides"`。不要为子页面新增一级入口。
- 新增入口 = 改 `NAV_ITEMS` + 加页面 + 在 `scripts/check-build.mjs` 的导航断言里加一条。底部导航的格子数是 5，加项要一起看移动端。

## 4. 按钮层级

一次只给一个主操作，按这个顺序挑：

| 场景 | 类名 |
| --- | --- |
| 页面主操作 | `filled-button` |
| 次要操作、取消 | `outlined-button` |
| 轻量链接式操作 | `text-button` |
| 纯图标 | `icon-button` + `aria-label` |
| 标签、状态 | `assist-chip` / `tag-chip` |

按钮只有这一套配色，**任何页面都不许给按钮换底色**（历史写法 `.hero-primary` / `.account-primary` 这类反色覆盖已经删掉）。`hero-card` 的底色是 primary-container（tone 90 的浅色），filled 按钮叠在上面天然成立；如果发现对比度不够，改的是容器色，不是按钮。

## 5. 表单

表单只用 `form-stack` + `field`：

```astro
<form class="form-stack">
  <label class="field">
    <span>账号（游戏 ID）</span>
    <input name="username" type="text" autocomplete="username" required />
  </label>
  <span class="field-hint">补充说明</span>
  <button class="filled-button" type="submit">登录</button>
  <p class="form-status" role="status" aria-live="polite"></p>
</form>
```

- 每个输入都要有可见的 `<span>` 标签，不靠 placeholder 顶替。
- 反馈文字统一用 `.form-status`（默认 error 色，成功时加 `data-tone="ok"`），并且必须是 `role="status" aria-live="polite"`。
- 提交时禁用按钮，避免重复提交。

## 6. 静态壳 + 接口补水

内容页在构建期预渲染（`export const prerender = true`），需要登录态或实时数据的部分由浏览器拉 `/api/*` 后填充，`/issues/` 和 `/account/` 都是这个模式。

- 需要服务端的页面显式写 `export const prerender = false`。
- 服务端路由（`/issues/`、`/login`）没有静态产物，`scripts/check-build.mjs` 的链接检查里要同步放行。
- 已登录 / 未登录两套视图都用 `[data-view]` + `hidden` 切换，别用 `innerHTML` 拼整块 DOM。

## 7. 无障碍与响应式

- 断点只有两个：`839px`（移动端，底部导航出现）和 `599px`（小屏细节）。不要引入第三个断点。
- 所有交互元素可键盘聚焦，`:focus-visible` 用全局描边，不要单独关掉。
- 图片有 `alt`，纯装饰图标 `aria-hidden`，图标按钮必须有 `aria-label`。
- 尊重 `prefers-reduced-motion`：新动效要能被全局的降级规则覆盖。

## 8. 出现节奏

两套，不要混用，也不要新增第三套：

- `.enter`：首屏元素，加载时一次性淡入上浮，可配 `--enter-delay`。
- `data-reveal`：滚动进入视口时出现，可配 `--reveal-delay`；监听逻辑在 `BaseLayout` 里统一挂，页面只写属性。

两套都必须被 `prefers-reduced-motion: reduce` 的全局规则关掉。

## 9. 改完必须验证

```bash
npm run build          # 构建
node scripts/check-build.mjs   # 产物断言（导航、页面、链接、SEO）
node scripts/smoke.mjs         # 真实浏览器冒烟
```

三条都过才算改完。检查脚本里新增的页面、导航项、关键文案，要同步加断言，否则下次改坏没人发现。
