import type { PersonListItem } from './people-list.ts';

/**
 * hydwind-api 人物接口的响应形状。
 *
 * 页面只做展示，不重新判断权限：`canEdit`、评论的 `canDelete` 都由后端
 * 按账号存储计算好，Web 不再读 accounts / biographies。
 */

/** GET /api/people?q= */
export interface PeopleListResponse {
  people: PersonListItem[];
}

/** 人物在 URL 里的身份：静态人物沿用内容集 id，账号用小写 username。 */
export interface PersonIdentity {
  slug: string;
  gameId: string;
  source: 'static' | 'account';
  /** 仅 source=static：对应 src/content/people 的 entry id。 */
  personId?: string;
}

export interface PersonBiography {
  gameId: string;
  mainTitle: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonComment {
  id: string;
  authorGameId: string;
  authorDisplay: string;
  body: string;
  createdAt: string;
  /** 后端按 authorUsername + 账号角色算好的删除权限。 */
  canDelete: boolean;
}

export interface PersonViewer {
  username: string;
  nickname: string;
  role: string;
}

/** GET /api/people/:id */
export interface PersonResponse {
  person: PersonIdentity;
  biography: PersonBiography | null;
  comments: PersonComment[];
  viewer: PersonViewer | null;
  canEdit: boolean;
}
