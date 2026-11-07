import type { APIRoute } from 'astro';
import { json } from '../../lib/api-response.ts';

/**
 * GET /api/health —— 给 systemd / 插件探活用，不需要鉴权。
 * 只报进程是否活着和运行了多久，不泄露任何配置或数据。
 */
export const GET: APIRoute = () => json({ ok: true, uptime: Math.floor(process.uptime()) });
