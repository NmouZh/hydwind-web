import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 氢风官网的全部事实都来自内容集合。
 * 页面不得硬编码服务器地址、版本、收费等会变化的信息。
 */

const site = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/site' }),
  schema: z
    .object({
      name: z.string().min(1),
      tagline: z.string().min(1),
      statusLabel: z.string().min(1),
      address: z.string().regex(/^[^:\s]+:\d+$/, '地址必须包含端口'),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      clientVersions: z.string().min(1),
      clientRequirement: z.string().min(1),
      versionNote: z.string().min(1),
      authentication: z.string().min(1),
      pricing: z.string().min(1),
      qqGroup: z.string().regex(/^\d+$/, 'QQ 群号只能是数字'),
      joinLimit: z.string().min(1),
      testingNotice: z.string().min(1),
      updated: z.coerce.date(),
    })
    .refine((data) => data.address === `${data.host}:${data.port}`, {
      message: 'address 必须等于 host:port，避免三处事实漂移',
      path: ['address'],
    }),
});

const people = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/people' }),
  schema: z
    .object({
      gameId: z.string().min(1),
      role: z.string().min(1),
      tags: z.array(z.string()).default([]),
      order: z.number().default(0),
      published: z.boolean().default(true),
      avatar: z.string().startsWith('/').optional(),
      joined: z.coerce.date().optional(),
      updated: z.coerce.date(),
    })
    .refine((data) => !data.published || Boolean(data.avatar), {
      message: '已发布人物必须提供真实头像（avatar）',
      path: ['avatar'],
    }),
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    order: z.number().default(0),
    updated: z.coerce.date(),
    steps: z
      .array(
        z.object({
          title: z.string().min(1),
          text: z.string().min(1),
        })
      )
      .min(1),
  }),
});

export const collections = { site, people, guides };
