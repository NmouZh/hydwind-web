/**
 * API 响应的共享辅助。
 *
 * 所有接口统一返回 JSON、禁止缓存；集中在一处后，路由里不用再各抄一份
 * `new Response(JSON.stringify(...))`。headers 可覆盖默认值（比如位置跳转）。
 */
export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

/** 路由只接受 `application/json`（允许带 charset 或其它参数）。 */
export const isJson = (request: Request): boolean => {
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json';
};

export type JsonObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * 读取 JSON 对象请求体：大小上限、坏 JSON、非对象都按统一错误返回。
 * 传记与评论接口共用，避免两处状态码 / 文案漂移。
 */
export const readJsonObject = async (
  request: Request,
  maxBytes: number
): Promise<JsonObjectResult> => {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: json({ error: '请求体太大' }, 413) };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    // Node 适配器的 bodySizeLimit 在流式读取超限时抛错；这里统一映射为 413。
    return { ok: false, response: json({ error: '请求体太大' }, 413) };
  }
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, response: json({ error: '请求体太大' }, 413) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, response: json({ error: '请求体不是合法 JSON' }, 400) };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, response: json({ error: '请求体格式不对' }, 400) };
  }

  return { ok: true, value: payload as Record<string, unknown> };
};