import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { json } from '../../lib/api-response.ts';

/**
 * GET /api/health —— 给 systemd / 插件探活用，不需要鉴权。
 *
 * 默认只报进程是否活着和运行了多久（liveness）。加 `?ready=1` 时在数据目录
 * 创建、写入、fsync 并删除一个探针文件（readiness）：权限位可写但磁盘满/只读
 * 时也能发现，比 `access(W_OK)` 可靠。结果缓存 5 秒，避免探针本身打爆磁盘。
 */

const READY_CACHE_MS = 5_000;
let readyCache: { at: number; failure: string | null } | null = null;

const dataDir = () => process.env.HYDWIND_DATA_DIR ?? path.join(process.cwd(), 'data');

const probeDataDir = async (): Promise<string | null> => {
  const dir = dataDir();
  const probe = path.join(dir, `.ready-${process.pid}-${randomUUID()}`);
  try {
    const handle = await open(probe, 'wx', 0o600);
    try {
      await handle.writeFile('ok', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await unlink(probe);
    return null;
  } catch {
    // 清理失败也无所谓；探针文件只有几个字节，下次启动会重新生成。
    await unlink(probe).catch(() => undefined);
    return '数据目录不可写（磁盘满、只读或权限错误）';
  }
};

const readiness = async (now: number): Promise<string | null> => {
  if (readyCache && now - readyCache.at < READY_CACHE_MS) return readyCache.failure;
  const failure = await probeDataDir();
  readyCache = { at: now, failure };
  return failure;
};

export const GET: APIRoute = async ({ url }) => {
  const uptime = Math.floor(process.uptime());
  if (url.searchParams.get('ready') !== '1') {
    return json({ ok: true, uptime });
  }

  const failure = await readiness(Date.now());
  if (failure) {
    return json({ ok: false, ready: false, error: failure, uptime }, 503);
  }
  return json({ ok: true, ready: true, uptime });
};