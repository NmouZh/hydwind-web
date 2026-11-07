import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountAvatar,
  buildPeopleList,
  filterPeopleList,
  sortPeopleByGameId,
  type AccountInput,
  type PersonListItem,
  type StaticPersonInput,
} from '../src/lib/people-list.ts';
import type { Biography } from '../src/lib/biographies.ts';

/**
 * /people 列表的纯逻辑。
 *
 * 接缝是这些公开函数：合并静态人物与账号、按游戏 ID 排序、按 q 搜索。
 * 测试只描述页面要展示的结果，不碰 Astro 组件或文件系统。
 */

const staticPeople: StaticPersonInput[] = [
  {
    id: 'nz-173',
    gameId: 'Nz_173',
    role: '服主',
    tags: ['运维'],
    avatar: '/images/nz-173.png',
    updated: '2026-10-31T00:00:00.000Z',
    hasBody: true,
  },
];

const accounts: AccountInput[] = [
  { username: 'Alice', nickname: '爱丽丝', createdAt: '2026-10-01T00:00:00.000Z' },
  { username: 'bob', nickname: '鲍勃', createdAt: '2026-10-02T00:00:00.000Z' },
  { username: 'Nz_173', nickname: '服主本人', createdAt: '2026-09-01T00:00:00.000Z' },
];

const biographies: Biography[] = [
  {
    gameId: 'Alice',
    mainTitle: '爱丽丝的冒险',
    body: '你好，我是爱丽丝。',
    comments: [
      { id: 'c1', authorUsername: 'bob', authorGameId: 'bob', body: '欢迎', createdAt: '2026-11-01T01:00:00.000Z' },
      { id: 'c2', authorUsername: 'Nz_173', authorGameId: 'Nz_173', body: '你好', createdAt: '2026-11-01T02:00:00.000Z' },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-11-01T02:00:00.000Z',
  },
  {
    // 大小写和账号不同，用来验证按 gameId 忽略大小写合并
    gameId: 'bob',
    mainTitle: '   ',
    body: '   ',
    comments: [],
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  },
];

test('合并静态人物与账号：所有账号都出现，同一 gameId 只保留一条', () => {
  const items = buildPeopleList({ staticPeople, accounts, biographies });

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.gameId),
    ['Alice', 'bob', 'Nz_173']
  );

  // 静态人物保留原 slug、头像、角色和标签，URL /people/nz-173/ 不变
  const nz = items.find((item) => item.gameId === 'Nz_173');
  assert.ok(nz);
  assert.equal(nz.slug, 'nz-173');
  assert.equal(nz.avatar, '/images/nz-173.png');
  assert.equal(nz.role, '服主');
  assert.deepEqual(nz.tags, ['运维']);
  assert.equal(nz.nickname, '服主本人');
  assert.equal(nz.source, 'static');
  // 静态人物自带 Markdown 正文，不应被标记成「尚未填写」
  assert.equal(nz.hasBody, true);
});

test('主标题：有记录用记录值，空白或没有记录时回退 <gameId>的人物传记', () => {
  const items = buildPeopleList({ staticPeople, accounts, biographies });

  assert.equal(items.find((item) => item.gameId === 'Alice')?.mainTitle, '爱丽丝的冒险');
  assert.equal(items.find((item) => item.gameId === 'bob')?.mainTitle, 'bob的人物传记');
  assert.equal(items.find((item) => item.gameId === 'Nz_173')?.mainTitle, 'Nz_173的人物传记');
});

test('静态人物没有静态正文且运行期正文为空时，hasBody 与详情页一致为 false', () => {
  const items = buildPeopleList({
    staticPeople: [
      {
        id: 'empty-person',
        gameId: 'EmptyPerson',
        role: '玩家',
        tags: [],
        avatar: '/images/empty.png',
        updated: '2026-10-31T00:00:00.000Z',
        hasBody: false,
      },
    ],
    accounts: [],
    biographies: [],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].hasBody, false);

  // 只要运行期传记写了正文，仍然算「有正文」。
  const withBiography = buildPeopleList({
    staticPeople: [
      {
        id: 'empty-person',
        gameId: 'EmptyPerson',
        role: '玩家',
        tags: [],
        avatar: '/images/empty.png',
        updated: '2026-10-31T00:00:00.000Z',
        hasBody: false,
      },
    ],
    accounts: [],
    biographies: [
      {
        gameId: 'EmptyPerson',
        mainTitle: 'EmptyPerson的人物传记',
        body: '后来写了正文',
        comments: [],
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal(withBiography[0].hasBody, true);
});

test('账号没有头像时使用默认头像接口，静态人物用原头像', () => {
  const items = buildPeopleList({ staticPeople, accounts, biographies });

  assert.equal(items.find((item) => item.gameId === 'Alice')?.avatar, '/api/avatar/Alice');
  assert.equal(items.find((item) => item.gameId === 'bob')?.avatar, '/api/avatar/bob');
  assert.equal(items.find((item) => item.gameId === 'Nz_173')?.avatar, '/images/nz-173.png');
  assert.equal(accountAvatar('玩家_1'), '/api/avatar/%E7%8E%A9%E5%AE%B6_1');
});

test('空正文标记尚未填写，评论数与更新时间取传记记录', () => {
  const items = buildPeopleList({ staticPeople, accounts, biographies });

  const alice = items.find((item) => item.gameId === 'Alice');
  assert.ok(alice);
  assert.equal(alice.hasBody, true);
  assert.equal(alice.commentCount, 2);
  assert.equal(alice.updatedAt, '2026-11-01T02:00:00.000Z');

  const bob = items.find((item) => item.gameId === 'bob');
  assert.ok(bob);
  assert.equal(bob.hasBody, false);
  assert.equal(bob.commentCount, 0);
  assert.equal(bob.updatedAt, '2026-10-20T00:00:00.000Z');
});

test('没有传记记录的账号：默认更新时间用账号创建时间，可被搜索的昵称保留', () => {
  const items = buildPeopleList({
    staticPeople: [],
    accounts: [
      { username: 'Carol', nickname: '小卡', createdAt: '2026-09-09T00:00:00.000Z' },
      { username: 'Dave', nickname: 'Dave', createdAt: '2026-09-10T00:00:00.000Z' },
    ],
    biographies: [],
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].mainTitle, 'Carol的人物传记');
  assert.equal(items[0].hasBody, false);
  assert.equal(items[0].updatedAt, '2026-09-09T00:00:00.000Z');
  assert.equal(items[0].nickname, '小卡');
  assert.equal(items[0].commentCount, 0);
  // 昵称缺省时给空串，组件只在它和 gameId 不同时才显示
  assert.equal(items[1].nickname, 'Dave');
  assert.equal(items[1].avatar, '/api/avatar/Dave');
});

test('按 gameId 忽略大小写排序，且不修改输入数组', () => {
  const input: PersonListItem[] = [
    { ...baseItem('gamma'), gameId: 'gamma' },
    { ...baseItem('alpha'), gameId: 'Alpha' },
    { ...baseItem('beta'), gameId: 'Beta' },
  ];

  const sorted = sortPeopleByGameId(input);
  assert.deepEqual(
    sorted.map((item) => item.gameId),
    ['Alpha', 'Beta', 'gamma']
  );
  assert.deepEqual(
    input.map((item) => item.gameId),
    ['gamma', 'Alpha', 'Beta']
  );
});

test('q 搜索 gameId 和昵称，忽略大小写与首尾空白', () => {
  const items = buildPeopleList({ staticPeople, accounts, biographies });

  assert.deepEqual(
    filterPeopleList(items, 'ALICE').map((item) => item.gameId),
    ['Alice']
  );
  assert.deepEqual(
    filterPeopleList(items, ' 爱丽 ').map((item) => item.gameId),
    ['Alice']
  );
  assert.deepEqual(
    filterPeopleList(items, '鲍').map((item) => item.gameId),
    ['bob']
  );
  assert.deepEqual(
    filterPeopleList(items, '_17').map((item) => item.gameId),
    ['Nz_173']
  );
  assert.deepEqual(
    filterPeopleList(items, '   ').map((item) => item.gameId),
    ['Alice', 'bob', 'Nz_173']
  );
  assert.deepEqual(filterPeopleList(items, '冒险'), []);
});

const baseItem = (slug: string): PersonListItem => ({
  slug,
  gameId: slug,
  nickname: '',
  mainTitle: `${slug}的人物传记`,
  avatar: `/api/avatar/${slug}`,
  role: '',
  tags: [],
  hasBody: false,
  updatedAt: null,
  commentCount: 0,
  source: 'account',
});