import { createHmac, timingSafeEqual } from "node:crypto";

type DownloadPayload = {
  url: string;
  exp: number;
};

const DEFAULT_TTL_SECONDS = 15 * 60;

function requireHttps(url: string) {
  try {
    if (new URL(url).protocol === "https:") return;
  } catch {
    // Use the same safe validation error for malformed and non-HTTPS URLs.
  }
  throw new Error("仅允许 HTTPS 图片地址");
}

function signatureFor(payloadPart: string, secret: string) {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

function decodeCanonicalBase64Url(part: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("下载令牌无效");
  const decoded = Buffer.from(part, "base64url");
  if (decoded.toString("base64url") !== part) throw new Error("下载令牌无效");
  return decoded;
}

export function signDownloadUrl(
  url: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  ttlSeconds = DEFAULT_TTL_SECONDS,
) {
  requireHttps(url);
  const payload: DownloadPayload = { url, exp: nowSeconds + ttlSeconds };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signaturePart = signatureFor(payloadPart, secret).toString("base64url");
  return `${payloadPart}.${signaturePart}`;
}

export function verifyDownloadToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("下载令牌无效");

  const [payloadPart, signaturePart] = parts;
  let payloadBytes: Buffer;
  let providedSignature: Buffer;
  try {
    payloadBytes = decodeCanonicalBase64Url(payloadPart);
    providedSignature = decodeCanonicalBase64Url(signaturePart);
  } catch {
    throw new Error("下载令牌无效");
  }
  const expectedSignature = signatureFor(payloadPart, secret);
  if (
    providedSignature.length !== expectedSignature.length
    || !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error("下载令牌无效");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("下载令牌无效");
  }
  if (
    typeof payload !== "object"
    || payload === null
    || !("url" in payload)
    || !("exp" in payload)
    || typeof payload.url !== "string"
    || typeof payload.exp !== "number"
    || !Number.isFinite(payload.exp)
  ) {
    throw new Error("下载令牌无效");
  }

  requireHttps(payload.url);
  if (payload.exp < nowSeconds) throw new Error("下载令牌已过期");
  return payload.url;
}
