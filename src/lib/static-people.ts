import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StaticPersonRef } from './biographies.ts';

/**
 * Runtime view of the curated people collection.
 *
 * Pages read `src/content/people` through `astro:content`, which only exists
 * inside the Astro/Vite pipeline. API routes must also run under plain
 * `node:test`, so this reads the same Markdown frontmatter directly instead of
 * duplicating the list. Deployment keeps the repository (including
 * `src/content`) as the service working directory.
 *
 * Only fields needed for slug resolution are parsed; the full schema stays in
 * `src/content.config.ts` and keeps validating content at build time.
 */
const PEOPLE_DIR = path.join(process.cwd(), 'src', 'content', 'people');

const frontmatter = (source: string): Record<string, string> => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    fields[pair[1]] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
};

export const loadStaticPeople = async (): Promise<StaticPersonRef[]> => {
  let names: string[];
  try {
    names = await readdir(PEOPLE_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const people: StaticPersonRef[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.md')) continue;
    const source = await readFile(path.join(PEOPLE_DIR, name), 'utf8');
    const fields = frontmatter(source);
    if ((fields.published ?? 'true').toLowerCase() === 'false') continue;
    const gameId = fields.gameId?.trim();
    if (!gameId) continue;
    people.push({ id: name.slice(0, -'.md'.length), gameId });
  }
  return people;
};
