/** 统一按 UTC 输出日期，保证构建产物稳定；坏日期返回占位符而不是抛 RangeError。 */
export const formatDate = (date: Date): string => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};
