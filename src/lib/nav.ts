/**
 * 站点一级导航的唯一数据源。
 *
 * 顶部导航栏和移动端底部导航都从这里读，页面通过 `current` 传入当前 key。
 * 规矩（见 docs/ui-rules.md）：一级导航固定 5 个、顺序固定、key 与路由一一对应；
 * 新增页面先加到这里，不要在组件里就地写死。
 */

export const NAV_KEYS = ['home', 'guides', 'people', 'issues', 'account'] as const;

export type NavKey = (typeof NAV_KEYS)[number];

export interface NavItem {
  key: NavKey;
  /** 顶部导航的文字标签，2 个字，保持等宽节奏 */
  label: string;
  /** 站内绝对路径，必须带结尾斜杠 */
  href: string;
  /** 底部导航使用的图标名，见 Icon.astro */
  icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '首页', href: '/', icon: 'home' },
  { key: 'guides', label: '指南', href: '/guides/', icon: 'book' },
  { key: 'people', label: '人物', href: '/people/', icon: 'person' },
  { key: 'issues', label: '议题', href: '/issues/', icon: 'message' },
  { key: 'account', label: '账号', href: '/account/', icon: 'badge' },
];

export const findNavItem = (key: NavKey): NavItem => {
  const item = NAV_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`未知导航项：${key}`);
  return item;
};
