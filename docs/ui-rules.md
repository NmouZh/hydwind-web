# UI 规矩

氢风官网的界面规则。**改任何页面前先读这一页**，和这里的约定不一致的写法要么改页面，要么先改这份文档。

好处很实际：之前登录页和议题页各自写了一份 `hero-card`，样式写在 `index.astro` 的 scoped style 里，别的页面拿到类名却拿不到样式，同一个"主视觉卡"在不同页面长得不一样。所以现在统一收口。

## 1. 颜色、字体、形状、动效只能用 token

- 颜色：`var(--md-sys-color-*)`
- 字体：`var(--md-sys-typescale-*-size)`、`var(--md-sys-typescale-font)`
- 圆角：`var(--md-sys-shape-corner-*)`（`extra-small` / `small` / `medium` / `large` / `extra-large` / `full`）
- 间距：`var(--hw-space-1..9)`（4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96），页面的 margin、padding、gap 都从这里取，不要写 `18px` 这种散值
- 阴影：`var(--hw-elevation-flat / raised / overlay)`，`--md-sys-elevation-*` 是它的别名
- 描边统一用 1px `var(--md-sys-color-outline-variant)`，默认不用阴影，hover 才抬起；列表页优先用发丝线分行的 `list-rows`，不铺卡片
- 动效：`var(--md-sys-motion-duration-*)`、`var(--md-sys-motion-easing-standard)`

禁止在页面里写死 `#rrggbb`、`rgba()`、`px` 圆角、`0.2s` 这类字面值。需要半透明时用 `color-mix(in srgb, var(--token) N%, transparent)`。token 只在 `src/styles/md3-tokens.css` 里定义，由 `scripts/generate-md3-tokens.mjs` 生成，不要手改。

深浅色都要成立：新增颜色一律引用 token，深色模式由 `data-theme="dark"` 自动切换，页面里不要写 `[data-theme]` 分支（`TopAppBar` 的主题图标除外）。

## 2. 页面骨架

整站是**编辑式栅格**：左栏放标题，右栏放说明和操作，区块之间用发丝线分隔，
列表用「行」而不是一堆漂浮的卡片。内容页统一是这三层，别自创结构：

```astro
<BaseLayout title="… · 氢风 Hydwind" description="…" current="guides">
  <div class="hw-shell page-shell">
    <header class="page-head enter">
      <div class="page-head-copy">
        <h1>一句话说清这页做什么</h1>
        <p class="page-head-sub">补充说明，1～2 句。</p>
      </div>
      <div class="page-head-actions">
        <a class="filled-button is-compact" href="…">主操作</a>
      </div>
    </header>

    <div class="list-rows">…行式列表…</div>
  </div>
</BaseLayout>
```

- `hw-shell`：唯一的宽度容器，不要在页面里另写 `max-width` 居中。
- `hw-grid` + `hw-span-*`：需要并排时用这套 12 栏栅格（移动端自动收成 4 栏），不要每页自己写 `grid-template-columns`。
- `page-shell`：内容页上下边距。
- `page-head`：紧凑刊头。左栏是 `h1` 加一行 `page-head-sub`，右栏 `page-head-actions` 放主操作；手机端按钮和标题同一行，说明自动换到下方。桌面标题 24px、手机 21px，不超过两行。
- `section`：页面内的分节，自带顶部发丝线和 `padding-block` 节奏；`section-heading` 是「眉标 + 标题 + 右侧轻链接」。
- 强调区块用 `hero-plate`（底色 primary-container），普通容器用 `panel`；两端对齐的卡片网格已废弃，列表用 `list-rows`。
- 详情页要有 `breadcrumb`，返回链接放在 `page-actions` 或 `detail-aside` 里。

### 行式列表

列表页和首页的「人物」「指南」都用这套，别退回卡片网格：

```astro
<div class="list-rows">
  <a class="list-row" href="…">
    <span class="list-row-index">01</span>
    <div>
      <h2 class="list-row-title">标题</h2>
      <p class="list-row-text">一行说明</p>
    </div>
    <div class="list-row-meta">
      <span>更新于 …</span>
      <span class="list-row-cta">查看 <Icon name="arrow_forward" size={16} /></span>
    </div>
  </a>
</div>
```

人物行额外加 `person-row`（第一列是头像）。行与行之间只有一根发丝线，hover 时底色淡入，不要再给每行加圆角卡片。

### 详情页

正文 + 粘性侧栏：外层 `detail-layout`，正文放 `prose`，信息放 `detail-aside`（内含 `meta-list`）。
移动端侧栏自动落到正文上方。

### 错误页

403 / 404 共用 `ErrorPage.astro` + `src/styles/error.css`：

- 左侧一个巨大的状态码当视觉锚点，右侧一句人话 + 两个出口；下面一行常用入口，不堆链接。
- 主操作默认「回到首页」，次操作默认「看进服指南」；403 的次操作换成「登录账号」。
- 错误页不加导航高亮语义（`current` 只是让页头保持完整），也不要做「敬请期待」式空话；
  说明里必须告诉用户下一步能做什么。
- 新增错误页要同步加到 `scripts/check-build.mjs` 的 `requiredPages` 和文案断言里。

### 指南页

指南是「路线」，允许比普通内容页更重的刊头，样式集中在 `src/styles/guides.css`：

- `/guides/`：`guide-hero` 刊头 + 一张 `guide-feature` 起点卡（底色 primary-container）+ `guide-facts` 事实条。
  只有一篇指南时不要再用「刊头按钮 + 单条列表行」重复同一件事。
- `/guides/:slug/`：`guide-layout` 两栏。左侧 `guide-route` 用大号序号和标题组织步骤（`GuideSteps variant="route"`），
  步骤标题必须比 `prose` 正文更醒目；右侧 `guide-aside` 放 `server-card` 和页内步骤导航。
- 服务器事实只在 `server-card` 里详细展示一次，步骤和正文不复述「上方服务器信息」。
- 手机端 `guide-aside` 落到路线之前，页内步骤导航隐藏；触控目标不小于 44px。

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

按钮只有这一套配色，**任何页面都不许给按钮换底色**（历史写法 `.hero-primary` / `.account-primary` 这类反色覆盖已经删掉）。`hero-plate` 的底色是 primary-container（tone 90 的浅色），filled 按钮叠在上面天然成立；如果发现对比度不够，改的是容器色，不是按钮。

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

逻辑全在 `src/scripts/motion.ts`（GSAP + ScrollTrigger），页面里**只写属性、不写动画代码**：

- `.enter`：首屏元素，加载时一次性淡入上浮，可配 `--enter-delay`。
- `data-reveal`：滚动进入视口时出现，可配 `--reveal-delay`；`BaseLayout` 里统一挂，页面只写属性。
- `data-split`：首屏大标题逐字升起（只给主视觉 h1 用，别给正文标题用）。
- `data-parallax="0.1"`：滚动的视差位移，数字是位移比例，取 0.05～0.15，别超过。
- `data-glow`：鼠标跟随的柔光层，只给主视觉容器；触屏和减弱动效下自动不生效。
- `data-magnetic`：主操作按钮被指针轻吸，一屏最多一个。
- `data-roll="3"`：数字从 0 滚到目标值，用于序号、统计。

两套主节奏（`.enter` / `data-reveal`）不要混用，也不要新增第三套。上面这些是叠加在节奏上的原语，
不改变章节结构；新增原语要同时加到 `motion.ts`、`base.css` 和这一节。
所有动效都必须被 `prefers-reduced-motion: reduce` 关掉：`motion.ts` 在这种情况下直接不加载 GSAP，
CSS 侧也要有对应的兜底（`.enter` 关动画、`data-reveal` 直接可见）。

### 换页：预取 + 过渡

站内跳转是原生导航，不接客户端路由，三层各管一件事，不要重复实现：

- **预取**：`astro.config.mjs` 的 `prefetch`（`prefetchAll` + `viewport` 策略）。手机没有 hover 也能提前抓到 HTML；不要再手写 `<link rel="prefetch">` 或自己的 fetch 预取。
- **过渡**：`base.css` 的 `@view-transition { navigation: auto }`。**常驻 chrome（页头、页脚、底栏）留在 root 快照里，root 不做任何动画**；`main` 单独命名 `hw-page`，负责「抬起 + 淡入」。不支持的浏览器就是普通跳转。
  - **不要**再给页头/底栏加 `view-transition-name`，也不要用 1ms 定格 + `data-vt-flat` 摘毛玻璃。这条链路依赖 `pagereveal` 时序，实测会偶发残留，导致毛玻璃整页失效；`backdrop-filter` 也可能被快照画成空白。页头/底栏用实心表面，直接并进 root。
  - 唯一命名的是当前项胶囊：`nav-top-active` / `nav-bottom-active`。旧胶囊隐藏、新胶囊显示，由 group 补间位置，跨页滑到新位置；别把整条导航拖进快照。
  - 时间轴是**两段式**：旧内容先淡出（`--hw-vt-out-duration`），新内容晚 `--hw-vt-in-delay` 再入场，中间看到的是 root 快照的底色。别改回同时淡入淡出——两段重叠时旧文字会以半透明状态压在新文字上，看起来像「旧文字慢一步才消失」的残影。但新内容也别拖太久：空内容区一旦超过一眨眼，就又像闪了。
  - **跨文档过渡期间进场动画要让位**：浏览器在新页面首次渲染时就截快照，`.enter` 这时还在 `opacity: 0`，截到的就是空页。`BaseLayout` 在 `pagereveal` 挂 `data-vt="cross"`，过渡结束后改成 `data-vt="settled"`；两种状态都关掉 `.enter`，避免结束之后二次入场。动效层等 `window.__hwViewTransition` resolve 后再接管。
  - **主题切换**：`setTheme` 先给 `html` 挂 `data-theme-switching` 停掉颜色过渡，两帧后再移除，避免「浅色底 + 深色页头」的半主题混合帧。
- **开发工具栏**：`astro.config.mjs` 里 `devToolbar.enabled = false`。390px 视口下它会盖住底栏中间三项，真实点击会被吃掉。
- **点击反馈**：`src/scripts/navigation.ts` 在点击瞬间点亮顶部进度条、给导航项按下态。它不接管路由，浏览器前进后退、右键新开标签都不受影响。

## 8.5 人物传记区块

人物页底部的「玩家写的传记」是全站唯一有写作入口的地方，三态都要成立：

| 访客状态 | 入口 | 说明 |
| --- | --- | --- |
| 未登录 | `登录后写一篇`（`outlined-button`，链接 `/account/`） | 这一版直接写进 HTML，不等脚本判断登录态 |
| 已登录、能改 | `写一篇传记` / `编辑这篇传记`（`filled-button`） | 由 `/api/…/biography` 的 `canEdit` 决定 |
| 已登录、改不了别人的 | 不给按钮 | `data-bio-note` 说明只有作者本人和站务能改 |

- 正文在构建期就渲染进 HTML（`src/lib/biography-text.ts` 的 `renderBiographyHtml`，浏览器端同一份逻辑），
  接口回来只在内容变了时才重画，避免先闪一下空态。
- 引用他人：候选按钮插入 `@游戏ID`；正文里认得的 `@` 会实时列成可移除的标签，上限 12 位。
- 一个字都不许隐藏得像彩蛋：入口始终在区块标题右侧，未登录也不藏起来。

## 9. 改完必须验证

```bash
npm run build          # 构建
node scripts/check-build.mjs   # 产物断言（导航、页面、链接、SEO）
node scripts/smoke.mjs         # 真实浏览器冒烟
```

三条都过才算改完。检查脚本里新增的页面、导航项、关键文案，要同步加断言，否则下次改坏没人发现。
