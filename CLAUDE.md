## Git commits

- After finishing any piece of work, always create a detailed git commit: stage the relevant files and write a message that explains what changed and why, not just "update files".
- Do not push unless explicitly asked.

## Daily work log

每天的改动记在 `docs/daily/YYYY-MM-DD.md`（一天一个文件，按本地日期）。主 Agent、子 Agent 和人类编辑都往当天文件追加。

- 完成任何一段工作后，在当天文件末尾追加一节：`## <名字 / Agent> · <HH:MM>`，写清改了什么、为什么、怎么验证、还有什么没做。
- 只追加，不改写别人已经写下的内容；文件不存在就新建。
- 日报不是文件清单：决策、踩过的坑、已知问题比罗列文件名更有价值。
- 日报本身不要写进 CLAUDE.md；CLAUDE.md 只放这条约定。

## UI 规矩

- 改页面前先读 `docs/ui-rules.md`：颜色/字体/圆角/动效一律用 MD3 token，页面骨架用 `hw-shell` + `page-shell` + `page-header`，卡片只用 `hero-card` / `panel`。
- 一级导航只改 `src/lib/nav.ts` 的 `NAV_ITEMS`，不要在组件里就地写死链接；子页面高亮父级。
- 页面自带的 scoped style 只放本页独有的东西，通用形状提升到 `src/styles/base.css` 的共享原语区。

## Checking and verification
- Delegate all checking work to a subagent: page walkthroughs, browser screenshots, responsive and accessibility checks, code review, and build or test verification.
- The main agent implements and fixes. It should not run these checks itself or get stuck in a self-review loop.
- When a check fails, hand the evidence back to the main agent, fix it there, and send the next check to a subagent.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`NmouZh/hydwind-web`) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
