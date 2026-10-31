/** 统一按 UTC 输出日期，保证构建产物稳定。 */
export const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
