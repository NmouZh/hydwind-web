import assert from 'node:assert/strict';
import test from 'node:test';

import {
  biographyEmptyMessage,
  biographyTitle,
  canDeleteCommentForViewer,
  commentAuthorLabel,
  commentDay,
  formatCommentTime,
  groupCommentsByDay,
  isBiographyEmpty,
} from '../src/lib/person-page.ts';

/**
 * 人物详情页的纯展示逻辑。
 *
 * 这些函数同时跑在 SSR 页面和浏览器脚本里，所以测试只断言输入 → 输出，
 * 不碰存储、会话或 DOM。覆盖三件容易悄悄坏掉的小事：
 * 标题回退、空正文状态、评论的署名 / 时间 / 分组 / 删除权限。
 */

test('标题为空或只有空白时回退到「游戏 ID 的人物传记」', () => {
  assert.equal(biographyTitle(null, 'Nz_173'), 'Nz_173的人物传记');
  assert.equal(biographyTitle(undefined, 'Nz_173'), 'Nz_173的人物传记');
  assert.equal(biographyTitle({ mainTitle: '' }, 'Nz_173'), 'Nz_173的人物传记');
  assert.equal(biographyTitle({ mainTitle: '   ' }, 'Nz_173'), 'Nz_173的人物传记');
});

test('标题有值时原样保留并去掉首尾空白', () => {
  assert.equal(biographyTitle({ mainTitle: '服主的碎碎念' }, 'Nz_173'), '服主的碎碎念');
  assert.equal(biographyTitle({ mainTitle: '  服主  ' }, 'Nz_173'), '服主');
});

test('正文为空、空白或没有传记记录时都算尚未填写', () => {
  assert.equal(isBiographyEmpty(null), true);
  assert.equal(isBiographyEmpty(undefined), true);
  assert.equal(isBiographyEmpty({ body: '' }), true);
  assert.equal(isBiographyEmpty({ body: '  \n\t ' }), true);
  assert.equal(isBiographyEmpty({ body: '你好' }), false);
});

test('空状态文案按访客身份区分，并且都点明「尚未填写」', () => {
  const owner = biographyEmptyMessage('Nz_173', 'owner');
  const viewer = biographyEmptyMessage('Nz_173', 'viewer');
  const guest = biographyEmptyMessage('Nz_173', 'guest');

  assert.match(owner, /尚未填写/);
  assert.match(owner, /写/);

  assert.match(viewer, /Nz_173/);
  assert.match(viewer, /尚未填写/);
  assert.doesNotMatch(viewer, /登录/);

  assert.match(guest, /Nz_173/);
  assert.match(guest, /尚未填写/);
  assert.match(guest, /登录/);
});

test('评论署名：昵称与游戏 ID 不同时两者都显示，相同时只显示一次', () => {
  assert.equal(commentAuthorLabel('小波', 'Bob'), '小波（@Bob）');
  assert.equal(commentAuthorLabel('Bob', 'Bob'), 'Bob');
  assert.equal(commentAuthorLabel('bob', 'Bob'), 'bob');
  assert.equal(commentAuthorLabel('', 'Bob'), 'Bob');
  assert.equal(commentAuthorLabel('小波', ''), '小波');
});

test('评论时间按北京时间（UTC+8）格式化，坏日期原样返回', () => {
  assert.equal(formatCommentTime('2026-11-07T05:30:00.000Z'), '2026-11-07 13:30');
  assert.equal(formatCommentTime('2026-11-07T20:00:00.000Z'), '2026-11-08 04:00');
  assert.equal(formatCommentTime('not-a-date'), 'not-a-date');
});

test('评论按自然日分组，保持传入的时间正序', () => {
  const groups = groupCommentsByDay([
    { id: 'a', createdAt: '2026-11-06T15:00:00.000Z' }, // 北京时间 11-06 23:00
    { id: 'b', createdAt: '2026-11-06T16:10:00.000Z' }, // 北京时间 11-07 00:10
    { id: 'c', createdAt: '2026-11-07T09:00:00.000Z' }, // 北京时间 11-07 17:00
  ]);

  assert.deepEqual(
    groups.map((group) => group.date),
    ['2026-11-06', '2026-11-07']
  );
  assert.deepEqual(
    groups.map((group) => group.comments.map((comment) => comment.id)),
    [['a'], ['b', 'c']]
  );
});

test('评论日从 ISO 时间换算到北京时间，坏日期保留原串', () => {
  assert.equal(commentDay('2026-11-07T20:00:00.000Z'), '2026-11-08');
  assert.equal(commentDay('broken'), 'broken');
});

test('只有本人或管理员可以删除评论', () => {
  const comment = { authorGameId: 'Bob' };

  assert.equal(canDeleteCommentForViewer(comment, null), false);
  assert.equal(canDeleteCommentForViewer(comment, { username: 'Bob', role: 'player' }), true);
  assert.equal(canDeleteCommentForViewer(comment, { username: 'bob', role: 'player' }), true);
  assert.equal(canDeleteCommentForViewer(comment, { username: 'Alice', role: 'player' }), false);
  assert.equal(canDeleteCommentForViewer(comment, { username: 'Root', role: 'admin' }), true);
});