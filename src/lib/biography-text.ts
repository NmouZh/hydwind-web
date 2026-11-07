/**
 * 传记正文的纯函数：把 Markdown 正文渲染成可读的 HTML，并解析 `@游戏ID`。
 *
 * 只在这里写一遍，两边共用：
 * - 构建期 `people/[slug].astro` 直接生成静态正文（打开页面就有内容，不等接口）；
 * - 浏览器 `scripts/biography.ts` 保存后和编辑器预览都调用同一份逻辑，不必等一整趟请求。
 *
 * 这个文件不能 import 任何 node:* 或存储层的东西 —— 它会被打进浏览器端脚本。
 * Markdown 语法本身在 `markdown.ts`，这里只负责「谁是谁」和日期这类传记专属的规则。
 */

import { escapeHtml, renderMarkdown } from './markdown.ts';

export { escapeHtml };

/** 游戏 ID 只允许字母、数字、下划线、连字符。 */
const MENTION_SOURCE = '@([A-Za-z0-9_-]{1,32})';

export const createMentionPattern = (): RegExp => new RegExp(MENTION_SOURCE, 'g');

/** 正文里出现过的游戏 ID，去重并保留出现顺序。 */
export const parseMentions = (body: string): string[] => {
  const seen = new Set<string>();
  for (const match of body.matchAll(createMentionPattern())) seen.add(match[1]);
  return [...seen];
};

export interface BiographyRef {
  personId: string;
  gameId: string;
}

/** 人物页地址。用 join 拼而不是模板串，避免构建检查把 `${…}` 当成站内链接。 */
export const personPath = (personId: string): string =>
  ['', 'people', encodeURIComponent(personId), ''].join('/');

/**
 * 正文 → HTML。认得的 `@游戏ID` 变成能点开的人物链接，认不出的原样留着。
 * 正文写的是 Markdown（标题、列表、引用、粗体……），渲染细节见 `markdown.ts`。
 */
export const renderBiographyHtml = (body: string, refs: BiographyRef[]): string => {
  const byGameId = new Map(refs.map((ref) => [ref.gameId, ref.personId]));
  return renderMarkdown(body, {
    resolveMention: (gameId) => {
      const personId = byGameId.get(gameId);
      return personId ? personPath(personId) : null;
    },
  });
};

/** `2026-11-03T05:00:00.000Z` → `2026-11-03`，坏日期原样返回。 */
export const formatBiographyDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};
