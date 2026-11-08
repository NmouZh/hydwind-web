/**
 * 服务器状态的运行时接口层。
 *
 * 数据源用 mcstatus.io 的公开 Java 状态接口（无需 api key），
 * 由服务端代理并缓存，避免浏览器直连第三方被 CORS / 限流挡住。
 * 未来插件侧自建 HTTP 状态接口时，只要把 STATUS_ENDPOINT 换掉即可。
 */

const DEFAULT_ENDPOINT = 'https://api.mcstatus.io/v2/status/java';
const CACHE_TTL_MS = 60_000;
/** 上游故障时的负缓存：避免每个访客都等一次 8 秒超时。 */
const FAILURE_TTL_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PLAYER_NAMES = 200;
const MAX_NAME_LENGTH = 32;

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
let failure: CacheEntry | null = null;
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
  // 上游刚失败过：负缓存期内直接返回离线占位，不再挂 8 秒。
  if (failure && now - failure.at < FAILURE_TTL_MS) {
    return failure.status;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch(`${endpoint()}/${encodeURIComponent(address)}`, {
        headers: { accept: 'application/json' },
        signal: timeoutSignal(8_000),
        redirect: 'manual',
      });
      if (!response.ok) throw new Error(`status endpoint ${response.status}`);
      const raw = await readBodyLimited(response, MAX_RESPONSE_BYTES);
      if (!raw) throw new Error('status endpoint response too large');
      const data = JSON.parse(raw) as McStatusResponse;
      const names = (data.players?.list ?? [])
        .map((player) => (player.name_clean || player.name_raw || '').slice(0, MAX_NAME_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_PLAYER_NAMES);

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
      failure = null;
      return status;
    } catch {
      // 第三方挂了也不该让官网崩：退回上次缓存，再退回离线占位。
      // 失败也写负缓存，避免上游故障时每个访客都触发一次 8 秒请求。
      if (cache) {
        failure = { status: { ...cache.status, source: 'cache' }, at: now };
        return failure.status;
      }
      const unavailable = offline(address, new Date(now).toISOString());
      failure = { status: unavailable, at: now };
      return unavailable;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
};

/** 读取上游响应体并限制大小；超过上限返回 null，交给负缓存处理。 */
const readBodyLimited = async (response: Response, maxBytes: number): Promise<string | null> => {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
};
