import type { APIRoute } from 'astro';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { json } from '../../lib/api-response.ts';

/**
 * GET /api/health —— 给 systemd / 插件探活用，不需要鉴权。
 *
 * 默认只报进程是否活着和运行了多久（liveness）。加 `?ready=1` 时额外检查
 * 数据目录可写、现有 JSON 能解析（readiness）；磁盘满或权限错误会让注册、
 * 登录、评论持续 500，但进程本身还活着，liveness 发现不了。
 */

const DATA_FILES = ['accounts.json', 'biographies.json', 'issues.json'] as const;

const dataDir = () => process.env.HYDWIND_DATA_DIR ?? path.join(process.cwd(), 'data');

const readiness = async (): Promise<string | null> => {
  const dir = dataDir();
  try {
    await access(dir, constants.R_OK | constants.W_OK);
  } catch {
    return '数据目录不可读写';
  }

  for (const name of DATA_FILES) {
    try {
      const raw = await readFile(path.join(dir, name), 'utf8');
      JSON.parse(raw);
    } catch (error) {
      // 首次部署时文件还不存在是正常的；存在但读不了/解析不了才是故障。
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      return `${name} 无法读取或解析`;
    }
  }
  return null;
};

export const GET: APIRoute = async ({ url }) => {
  const uptime = Math.floor(process.uptime());
  if (url.searchParams.get('ready') !== '1') {
    return json({ ok: true, uptime });
  }

  const failure = await readiness();
  if (failure) {
    return json({ ok: false, ready: false, error: failure, uptime }, 503);
  }
  return json({ ok: true, ready: true, uptime });
};