import { GrsaiError } from "./errors";

const BASE_URL = process.env.GRSAI_BASE_URL ?? "https://grsai.dakka.com.cn";

export async function grsaiFetch<T>(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const apiKey = process.env.GRSAI_API_KEY;
  if (!apiKey) throw new GrsaiError("auth", "服务端尚未配置 GRSAI_API_KEY", 503);

  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(60_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new GrsaiError("timeout", "Grsai 请求超时，请重试", 504);
    }
    throw new GrsaiError("upstream", "无法连接 Grsai 服务", 502);
  }

  if (!response.ok) {
    const body = await response.text();
    const lower = body.toLowerCase();
    if (response.status === 401 || response.status === 403) {
      throw new GrsaiError("auth", "Grsai API Key 无效或无权限", response.status);
    }
    if (lower.includes("balance") || lower.includes("积分")) {
      throw new GrsaiError("balance", "Grsai 积分或余额不足", 402);
    }
    throw new GrsaiError("upstream", "Grsai 服务暂时不可用", response.status);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new GrsaiError("upstream", "Grsai 服务响应格式异常，请重试", 502);
  }
}
