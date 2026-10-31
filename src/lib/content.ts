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

export const getAllGuides = (): Promise<CollectionEntry<'guides'>[]> =>
  getCollection('guides');

export const getGuides = async (): Promise<CollectionEntry<'guides'>[]> => {
  const guides = await getAllGuides();
  return guides.sort(
    (a, b) =>
      a.data.order - b.data.order || a.data.title.localeCompare(b.data.title)
  );
};

export const getJoinGuide = async (): Promise<CollectionEntry<'guides'>> => {
  const entry = await getEntry('guides', JOIN_GUIDE_ID);
  if (!entry) {
    throw new Error(`缺少进服指南：src/content/guides/${JOIN_GUIDE_ID}.md`);
  }
  return entry;
};
