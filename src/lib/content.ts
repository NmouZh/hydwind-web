import { getCollection, getEntry } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

/** site 单例在内容集合中的固定 id。 */
export const SITE_ENTRY_ID = 'info';

/** 进服指南在 guides 集合中的固定 id；首页、导航与检查脚本共用。 */
export const JOIN_GUIDE_ID = 'join';

export type SiteInfo = CollectionEntry<'site'>['data'];

/**
 * 已发布人物在 schema 中保证有头像。这里把这一约束反映到类型上，
 * 页面因此不需要再写“没有头像时显示首字母”的回退。
 */
export type PublishedPerson = CollectionEntry<'people'> & {
  data: CollectionEntry<'people'>['data'] & { avatar: string };
};

export const getSite = async (): Promise<SiteInfo> => {
  const entry = await getEntry('site', SITE_ENTRY_ID);
  if (!entry) throw new Error('缺少 site 内容：src/content/site/info.md');
  return entry.data;
};

export const getPublishedPeople = async (): Promise<PublishedPerson[]> => {
  const people = await getCollection('people', ({ data }) => data.published);
  return people.sort(
    (a, b) =>
      a.data.order - b.data.order || a.data.gameId.localeCompare(b.data.gameId)
  ) as PublishedPerson[];
};

/** 已发布的 Wiki 页面；草稿不会进构建产物。 */
export const getAllGuides = async (): Promise<CollectionEntry<'guides'>[]> => {
  const guides = await getCollection('guides');
  return guides.filter((guide) => !guide.data.draft);
};

export const getGuides = async (): Promise<CollectionEntry<'guides'>[]> => {
  const guides = await getAllGuides();
  return guides.sort(
    (a, b) =>
      a.data.order - b.data.order || a.data.title.localeCompare(b.data.title)
  );
};

export interface GuideGroup {
  category: string;
  pages: CollectionEntry<'guides'>[];
}

/** 按分类分组；分类顺序取组内最小 order，组内再按 order / 标题。 */
export const groupGuides = (
  guides: CollectionEntry<'guides'>[]
): GuideGroup[] => {
  const buckets = new Map<string, CollectionEntry<'guides'>[]>();

  for (const guide of guides) {
    const category = guide.data.category || '其他';
    const bucket = buckets.get(category);
    if (bucket) bucket.push(guide);
    else buckets.set(category, [guide]);
  }

  const orderOf = (group: GuideGroup): number =>
    Math.min(...group.pages.map((page) => page.data.order));

  return [...buckets.entries()]
    .map(([category, pages]) => ({
      category,
      pages: [...pages].sort(
        (a, b) =>
          a.data.order - b.data.order || a.data.title.localeCompare(b.data.title)
      ),
    }))
    .sort(
      (a, b) =>
        orderOf(a) - orderOf(b) || a.category.localeCompare(b.category, 'zh-CN')
    );
};

const stripMarkdown = (source: string): string =>
  source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 摘要留空时从正文截一段，Wiki 新页面不必被摘要卡住。 */
export const guideExcerpt = (
  guide: CollectionEntry<'guides'>,
  limit = 120
): string => {
  const text = guide.data.summary.trim() || stripMarkdown(guide.body ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

export const getJoinGuide = async (): Promise<CollectionEntry<'guides'>> => {
  const entry = await getEntry('guides', JOIN_GUIDE_ID);
  if (!entry) {
    throw new Error(`缺少进服指南：src/content/guides/${JOIN_GUIDE_ID}.md`);
  }
  return entry;
};
