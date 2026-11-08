/**
 * 传记正文用的极简 Markdown 渲染器。
 *
 * 为什么自己写而不是装一个库：
 * - 同一份逻辑要跑两遍 —— 构建期在 Node 里预渲染页面，浏览器里在编辑器做即时预览；
 * - 所以这个文件不能 import 任何 `node:*`，也不能依赖 DOM；
 * - 支持的语法刻意收窄（见 docs/ui-rules.md §8.5）：标题、粗体、斜体、删除线、
 *   行内代码、围栏代码块、引用、有序/无序列表（可嵌套）、分隔线、链接、图片、
 *   以及正文里的 `@游戏ID`。
 *
 * 安全底线：所有正文先转义再拼标签；链接和图片地址只放行
 * `http(s):`、`mailto:`、站内绝对路径 `/…`、锚点 `#…`、相对路径 `./…`，
 * 其余（`javascript:`、`data:` 之类）一律降级成纯文本。
 */

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export interface MarkdownOptions {
  /** `@游戏ID` → 站内地址；返回 null 时原样保留（引用了不存在的人就只是个名字） */
  resolveMention?: (gameId: string) => string | null;
}

/** 只放行这几种地址，别的都当纯文本处理。 */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/|#|\.{0,2}\/)/i;

const safeHref = (raw: string): string | null => {
  const href = raw.trim();
  // 反斜杠会被浏览器在特殊 scheme 下归一成斜杠（`/\evil.com` → `//evil.com`）；
  // 协议相对地址 `//host` 也不是站内链接。两者都拒绝，避免把外链伪装成站内路径。
  if (!href || /[\s<>"'\\]/.test(href) || href.startsWith('//')) return null;
  return SAFE_HREF.test(href) ? href : null;
};

/**
 * 行内语法。顺序有讲究：代码、图片、链接在强调之前，
 * 这样 `` `**不加粗**` `` 不会被当成粗体，`[链接](…)` 里的星号也不会被拆开吃。
 */
const INLINE_SOURCE = [
  // 反斜杠转义放最前面：`\*不是斜体\*` 里的星号不该被当成强调
  '\\\\(?<escape>[`*_{}\\[\\]()#+.!~>|-])',
  '`(?<code>[^`\\n]+)`',
  '!\\[(?<imgAlt>[^\\]\\n]*)\\]\\((?<imgUrl>[^)\\s]+)\\)',
  '\\[(?<linkText>[^\\]\\n]+)\\]\\((?<linkUrl>[^)\\s]+)\\)',
  '\\*\\*(?<strong>.+?)\\*\\*',
  '~~(?<strike>.+?)~~',
  '\\*(?<em>[^*\\n]+?)\\*',
  '@(?<mention>[A-Za-z0-9_-]{1,32})',
].join('|');

const inlinePattern = (): RegExp => new RegExp(INLINE_SOURCE, 'g');

/** 行内渲染：边扫边转义，认得的语法才换成标签。 */
const renderInline = (text: string, options: MarkdownOptions): string => {
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(inlinePattern())) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += escapeHtml(text.slice(cursor, index));
    cursor = index + match[0].length;

    if (groups.escape !== undefined) {
      out += escapeHtml(groups.escape);
      continue;
    }

    if (groups.code !== undefined) {
      out += `<code>${escapeHtml(groups.code)}</code>`;
      continue;
    }

    if (groups.imgUrl !== undefined) {
      const alt = groups.imgAlt ?? '';
      const src = safeHref(groups.imgUrl);
      out += src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`
        : escapeHtml(alt);
      continue;
    }

    if (groups.linkUrl !== undefined) {
      const label = renderInline(groups.linkText ?? '', options);
      const href = safeHref(groups.linkUrl);
      out += href
        ? `<a href="${escapeHtml(href)}" rel="nofollow noopener noreferrer" target="_blank">${label}</a>`
        : label;
      continue;
    }

    if (groups.strong !== undefined) {
      out += `<strong>${renderInline(groups.strong, options)}</strong>`;
      continue;
    }

    if (groups.strike !== undefined) {
      out += `<del>${renderInline(groups.strike, options)}</del>`;
      continue;
    }

    if (groups.em !== undefined) {
      out += `<em>${renderInline(groups.em, options)}</em>`;
      continue;
    }

    if (groups.mention !== undefined) {
      const gameId = groups.mention;
      const href = options.resolveMention?.(gameId) ?? null;
      out += href
        ? `<a class="bio-mention" href="${escapeHtml(href)}">@${escapeHtml(gameId)}</a>`
        : `@${escapeHtml(gameId)}`;
    }
  }

  return out + escapeHtml(text.slice(cursor));
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^\s{0,3}>\s?/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
  /** 有序列表的起始序号：`3.` 开头就从 3 数起 */
  start: number;
}

const asListItem = (line: string): ListItem | null => {
  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      indent: bullet[1].replaceAll('\t', '    ').length,
      ordered: false,
      text: bullet[2],
      start: 1,
    };
  }
  const numbered = NUMBERED.exec(line);
  if (numbered) {
    return {
      indent: numbered[1].replaceAll('\t', '    ').length,
      ordered: true,
      text: numbered[3],
      start: Number(numbered[2]),
    };
  }
  return null;
};

const isBlockStart = (line: string): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  asListItem(line) !== null;

/** 列表最大嵌套层数；4000 字正文理论上可以造出很深的缩进，递归要有硬上限。 */
const MAX_LIST_DEPTH = 16;

/** 列表：缩进比本层深的行交给递归，挂到上一个 `<li>` 里面。 */
const renderList = (
  lines: string[],
  start: number,
  options: MarkdownOptions,
  depth = 0
): { html: string; next: number } => {
  const first = asListItem(lines[start]);
  const ordered = first?.ordered ?? false;
  const baseIndent = first?.indent ?? 0;
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      const following = lines[index + 1] ? asListItem(lines[index + 1]) : null;
      if (following && following.ordered === ordered && following.indent >= baseIndent) {
        index += 1;
        continue;
      }
      break;
    }

    const item = asListItem(line);
    if (!item || item.ordered !== ordered || item.indent < baseIndent) break;

    if (item.indent > baseIndent && depth < MAX_LIST_DEPTH) {
      const nested = renderList(lines, index, options, depth + 1);
      if (items.length > 0) {
        items[items.length - 1] = items[items.length - 1].replace(
          /<\/li>$/,
          `${nested.html}</li>`
        );
      } else {
        items.push(`<li>${nested.html}</li>`);
      }
      index = nested.next;
      continue;
    }

    items.push(`<li>${renderInline(item.text, options)}</li>`);
    index += 1;
  }

  const open = ordered
    ? `<ol${first && first.start !== 1 ? ` start="${first.start}"` : ''}>`
    : '<ul>';
  return { html: `${open}${items.join('')}</${ordered ? 'ol' : 'ul'}>`, next: index };
};

const renderBlocks = (lines: string[], options: MarkdownOptions): string => {
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s{0,3}\\${marker}{3,}\\s*$`).test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      // 页面自己已经有 h1，正文标题从 h2 起；再深的封顶 h4，避免出现 h6 那种小字
      const level = Math.min(4, heading[1].length + 1);
      html.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      html.push('<hr />');
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].replace(QUOTE, ''));
        index += 1;
      }
      html.push(`<blockquote>${renderBlocks(quoted, options)}</blockquote>`);
      continue;
    }

    if (asListItem(line)) {
      const list = renderList(lines, index, options);
      html.push(list.html);
      index = list.next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    // 段内换行保留成 <br />：写的人怎么断行，读的人就怎么看到
    html.push(`<p>${paragraph.map((row) => renderInline(row, options)).join('<br />')}</p>`);
  }

  return html.join('');
};

/** 正文 → HTML。空行分段，块级语法按行识别。 */
export const renderMarkdown = (source: string, options: MarkdownOptions = {}): string =>
  renderBlocks(source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'), options);
