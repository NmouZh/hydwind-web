import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

/** 官方 Wiki：由 Starlight 渲染，带侧边栏、目录和全文搜索 */
const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema(),
});

/** 公开组织：城镇、公会、工作室、红石团体 */
const orgs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/orgs' }),
  schema: z.object({
    name: z.string(),
    type: z.enum(['城镇', '公会', '工作室', '其他']),
    leader: z.string(),
    members: z.array(z.string()).default([]),
    founded: z.string().optional(),
    coords: z.string().optional(),
    status: z.enum(['招募中', '满员', '休整', '已解散']).default('招募中'),
    tags: z.array(z.string()).default([]),
    summary: z.string(),
    cover: z.string().optional(),
    contact: z.string().optional(),
    order: z.number().default(99),
  }),
});

/** 玩家自传 */
const players = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/players' }),
  schema: z.object({
    ign: z.string(),
    role: z.string().optional(),
    org: z.string().optional(),
    joined: z.string().optional(),
    status: z.enum(['活跃', '休假', '暂离', '已退服']).default('活跃'),
    tags: z.array(z.string()).default([]),
    avatar: z.string().optional(),
    summary: z.string(),
    order: z.number().default(99),
  }),
});

/** 公告：一条一个文件，首页与 /news/ 自动汇总 */
const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    tag: z.string().default('公告'),
    summary: z.string(),
    pinned: z.boolean().default(false),
  }),
});

/** Starlight 的界面文案集合 */
const i18n = defineCollection({
  loader: i18nLoader(),
  schema: i18nSchema(),
});

export const collections = { docs, i18n, orgs, players, news };
