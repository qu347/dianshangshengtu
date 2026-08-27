import { createHmac, timingSafeEqual } from "node:crypto";
import type { ImageRenderConfig } from "./image-render-config";
import { bindDimensionLayout } from "./dimension-layout";

declare const downloadTokenBrand: unique symbol;
declare const jobTokenBrand: unique symbol;

export type DownloadToken = string & { readonly [downloadTokenBrand]: true };
export type JobToken = string & { readonly [jobTokenBrand]: true };

type DownloadPayload = {
  kind: "download";
  url: string;
  render: ImageRenderConfig;
  exp: number;
};

type JobPayload = {
  kind: "job";
  providerJobId: string;
  render: ImageRenderConfig;
  exp: number;
};

const DOWNLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const JOB_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const HMAC_LENGTH_BYTES = 32;
const MAX_ANNOTATIONS = 6;
const MAX_RENDER_STRING_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function requireHttps(url: string) {
  if (!isHttpsUrl(url)) throw new Error("仅允许 HTTPS 图片地址");
}

function isBoundedText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= MAX_RENDER_STRING_LENGTH
    && (allowEmpty || value.trim().length > 0);
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 64;
}

function isImageRenderConfig(value: unknown): value is ImageRenderConfig {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.imageIndex)
    || (value.imageIndex as number) < 1
    || !Array.isArray(value.annotations)
    || value.annotations.length > MAX_ANNOTATIONS
    || !isBoundedText(value.watermark, true)
    || typeof value.applyWatermark !== "boolean"
  ) {
    return false;
  }

  const annotationsValid = value.annotations.every((annotation) => isRecord(annotation)
    && isBoundedId(annotation.id)
    && isBoundedText(annotation.label)
    && isBoundedText(annotation.displayValue));
  if (!annotationsValid) return false;

  if (value.imageIndex === 2) {
    try {
      bindDimensionLayout(value.dimensionLayout, value.annotations as ImageRenderConfig["annotations"]);
      return true;
    } catch {
      return false;
    }
  }
  return value.dimensionLayout === undefined;
}

function signatureFor(payloadPart: string, secret: string) {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

function decodeCanonicalBase64Url(part: string, invalidMessage: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error(invalidMessage);
  const decoded = Buffer.from(part, "base64url");
  if (decoded.toString("base64url") !== part) throw new Error(invalidMessage);
  return decoded;
}

function signPayload(payload: DownloadPayload | JobPayload, secret: string) {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signaturePart = signatureFor(payloadPart, secret).toString("base64url");
  return `${payloadPart}.${signaturePart}`;
}

function verifySignedPayload(
  token: string,
  secret: string,
  invalidMessage: string,
): Record<string, unknown> & { exp: number } {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(invalidMessage);

  const [payloadPart, signaturePart] = parts;
  let payloadBytes: Buffer;
  let providedSignature: Buffer;
  try {
    payloadBytes = decodeCanonicalBase64Url(payloadPart, invalidMessage);
    providedSignature = decodeCanonicalBase64Url(signaturePart, invalidMessage);
  } catch {
    throw new Error(invalidMessage);
  }

  const expectedSignature = signatureFor(payloadPart, secret);
  if (
    providedSignature.length !== HMAC_LENGTH_BYTES
    || expectedSignature.length !== HMAC_LENGTH_BYTES
    || !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error(invalidMessage);
  }

  let payload: unknown;
  try {
    const payloadText = payloadBytes.toString("utf8");
    if (!Buffer.from(payloadText, "utf8").equals(payloadBytes)) throw new Error();
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error(invalidMessage);
  }

  if (!isRecord(payload) || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error(invalidMessage);
  }
  return payload as Record<string, unknown> & { exp: number };
}

function requireUnexpired(exp: number, nowSeconds: number, expiredMessage: string) {
  if (exp < nowSeconds) throw new Error(expiredMessage);
}

export function signDownloadUrl(
  url: string,
  render: ImageRenderConfig,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  ttlSeconds = DOWNLOAD_TOKEN_TTL_SECONDS,
): DownloadToken {
  requireHttps(url);
  if (!isImageRenderConfig(render)) {
    throw new Error("下载令牌无效");
  }
  return signPayload({
    kind: "download",
    url,
    render,
    exp: nowSeconds + ttlSeconds,
  }, secret) as DownloadToken;
}

export function signJobToken(
  providerJobId: string,
  render: ImageRenderConfig,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  ttlSeconds = JOB_TOKEN_TTL_SECONDS,
) {
  if (
    typeof providerJobId !== "string"
    || !providerJobId.trim()
    || !isImageRenderConfig(render)
  ) {
    throw new Error("任务令牌无效");
  }
  return signPayload({
    kind: "job",
    providerJobId,
    render,
    exp: nowSeconds + ttlSeconds,
  }, secret) as JobToken;
}

export function verifyDownloadToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { url: string; render: ImageRenderConfig } {
  const payload = verifySignedPayload(
    token,
    secret,
    "下载令牌无效",
  );

  if (
    payload.kind !== "download"
    || typeof payload.url !== "string"
    || !isHttpsUrl(payload.url)
    || !isImageRenderConfig(payload.render)
  ) {
    throw new Error("下载令牌无效");
  }
  requireUnexpired(payload.exp, nowSeconds, "下载令牌已过期");
  return { url: payload.url, render: payload.render };
}

export function verifyJobToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { providerJobId: string; render: ImageRenderConfig } {
  const payload = verifySignedPayload(
    token,
    secret,
    "任务令牌无效",
  );
  if (
    payload.kind !== "job"
    || typeof payload.providerJobId !== "string"
    || payload.providerJobId.trim().length === 0
    || !isImageRenderConfig(payload.render)
  ) {
    throw new Error("任务令牌无效");
  }
  requireUnexpired(payload.exp, nowSeconds, "任务令牌已过期");
  return { providerJobId: payload.providerJobId, render: payload.render };
}
