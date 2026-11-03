/**
 * 服务器状态的运行时接口层。
 *
 * 数据源用 mcstatus.io 的公开 Java 状态接口（无需 api key），
 * 由服务端代理并缓存，避免浏览器直连第三方被 CORS / 限流挡住。
 * 未来插件侧自建 HTTP 状态接口时，只要把 STATUS_ENDPOINT 换掉即可。
 */

const DEFAULT_ENDPOINT = 'https://api.mcstatus.io/v2/status/java';
const CACHE_TTL_MS = 60_000;

export interface ServerStatus {
  online: boolean;
  address: string;
  players: { online: number; max: number; names: string[] };
  version: string;
  motd: string;
  latencyMs: number | null;
  icon: string | null;
  checkedAt: string;
  source: 'live' | 'cache' | 'fallback';
}

interface CacheEntry {
  status: ServerStatus;
  at: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<ServerStatus> | null = null;

const endpoint = () => (process.env.STATUS_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, '');

const timeoutSignal = (ms: number) => AbortSignal.timeout(ms);

const offline = (address: string, checkedAt = new Date().toISOString()): ServerStatus => ({
  online: false,
  address,
  players: { online: 0, max: 0, names: [] },
  version: '未知',
  motd: '',
  latencyMs: null,
  icon: null,
  checkedAt,
  source: 'fallback',
});

interface McStatusResponse {
  online?: boolean;
  host?: string;
  port?: number;
  version?: { name_clean?: string; name_raw?: string };
  players?: { online?: number; max?: number; list?: { name_clean?: string; name_raw?: string }[] };
  motd?: { clean?: string; raw?: string };
  icon?: string;
}

export const fetchServerStatus = async (address: string, now = Date.now()): Promise<ServerStatus> => {
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.status, source: 'cache' };
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch(`${endpoint()}/${encodeURIComponent(address)}`, {
        headers: { accept: 'application/json' },
        signal: timeoutSignal(8_000),
      });
      if (!response.ok) throw new Error(`status endpoint ${response.status}`);
      const data = (await response.json()) as McStatusResponse;
      const names = (data.players?.list ?? [])
        .map((player) => player.name_clean || player.name_raw || '')
        .filter(Boolean);

      const status: ServerStatus = {
        online: Boolean(data.online),
        address,
        players: {
          online: data.players?.online ?? 0,
          max: data.players?.max ?? 0,
          names,
        },
        version: data.version?.name_clean || data.version?.name_raw || '未知',
        motd: (data.motd?.clean || data.motd?.raw || '').trim(),
        latencyMs: null,
        icon: data.icon ?? null,
        checkedAt: new Date(now).toISOString(),
        source: 'live',
      };
      cache = { status, at: now };
      return status;
    } catch {
      // 第三方挂了也不该让官网崩：退回上次缓存，再退回离线占位
      if (cache) return { ...cache.status, source: 'cache' };
      return offline(address);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
};
