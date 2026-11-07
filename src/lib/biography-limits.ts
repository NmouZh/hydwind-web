/**
 * 传记与评论的长度限制。
 *
 * 服务端校验（`biographies.ts`）和浏览器端预校验（`scripts/person-page.ts`）
 * 必须用同一组数字，避免前端放行、后端才报错的体验。这个模块不能 import
 * 任何 `node:*` 或存储层代码，浏览器脚本可以直接引用。
 */

export const MIN_BIO_TITLE = 2;
export const MAX_BIO_TITLE = 40;
export const MAX_BIO_BODY = 4000;

export const MIN_COMMENT_BODY = 1;
export const MAX_COMMENT_BODY = 500;