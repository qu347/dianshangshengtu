import { lookup as dnsLookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as nodeHttpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { checkServerIdentity as verifyTlsIdentity } from "node:tls";

const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type LookupImplementation = (hostname: string) => Promise<ResolvedAddress[]>;
type ImageTransport = (
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
) => Promise<Response>;
type HttpsRequestImplementation = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => Pick<ClientRequest, "destroy" | "end" | "once">;

function ipv4Octets(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPublicIpv4(address: string) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(address: string) {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const dottedIndex = normalized.lastIndexOf(":");
  if (normalized.includes(".") && dottedIndex >= 0) {
    const octets = ipv4Octets(normalized.slice(dottedIndex + 1));
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, dottedIndex)}:${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function hasIpv6Prefix(value: bigint, prefix: bigint, bits: number) {
  return value >> BigInt(128 - bits) === prefix >> BigInt(128 - bits);
}

function isPublicIpv6(address: string) {
  const value = parseIpv6(address);
  if (value === null) return false;
  const globalUnicastPrefix = 0x20000000000000000000000000000000n;
  if (!hasIpv6Prefix(value, globalUnicastPrefix, 3)) return false;

  const excluded = [
    [0x20010000000000000000000000000000n, 23],
    [0x20010db8000000000000000000000000n, 32],
    [0x20020000000000000000000000000000n, 16],
    [0x3fff0000000000000000000000000000n, 20],
  ] as const;
  return !excluded.some(([prefix, bits]) => hasIpv6Prefix(value, prefix, bits));
}

export function isPublicAddress(address: ResolvedAddress) {
  return address.family === 4
    ? isIP(address.address) === 4 && isPublicIpv4(address.address)
    : isIP(address.address) === 6 && isPublicIpv6(address.address);
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: hostname, family: literalFamily }];
  }
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.flatMap((result) => (
    result.family === 4 || result.family === 6
      ? [{ address: result.address, family: result.family }]
      : []
  ));
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("请求已取消", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("请求已取消", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function responseHeaders(response: IncomingMessage) {
  const headers = new Headers();
  Object.entries(response.headers).forEach(([name, value]) => {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else if (value !== undefined) headers.set(name, value);
  });
  return headers;
}

export function requestPinnedHttps(
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
  requestImpl: HttpsRequestImplementation = nodeHttpsRequest as HttpsRequestImplementation,
): Promise<Response> {
  const originalHostname = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const request = requestImpl({
      protocol: "https:",
      hostname: address.address,
      family: address.family,
      port: url.port ? Number(url.port) : 443,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: { Host: url.host },
      servername: isIP(originalHostname) ? undefined : originalHostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_hostname, certificate) => verifyTlsIdentity(originalHostname, certificate),
      agent: false,
    }, (response) => {
      const status = response.statusCode ?? 502;
      const body = status === 204 || status === 304
        ? null
        : Readable.toWeb(response as Readable) as BodyInit;
      resolve(new Response(body, { status, headers: responseHeaders(response) }));
    });
    const abort = () => request.destroy(new DOMException("请求已取消", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.once("close", () => signal.removeEventListener("abort", abort));
    request.end();
  });
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) throw new Error("图片响应为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("图片响应过大");
        throw new Error("图片响应过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export async function fetchPublicImage(
  sourceUrl: string,
  options: {
    lookup?: LookupImplementation;
    transport?: ImageTransport;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
) {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("仅允许 HTTPS 图片地址");
  }
  const timeoutSignal = AbortSignal.timeout(30_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await waitWithAbort((options.lookup ?? defaultLookup)(hostname), signal);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("图片地址必须解析到公开网络地址");
  }

  const response = await (options.transport ?? requestPinnedHttps)(url, addresses[0], signal);
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (!response.ok || !contentType || !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
    await response.body?.cancel("图片响应无效");
    throw new Error("图片下载失败，请稍后重试");
  }
  return readBoundedBody(response, options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES);
}

const DEFAULT_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const SUPPORTED_VIDEO_CONTENT_TYPES = new Set(["video/mp4"]);

export async function fetchPublicVideo(
  sourceUrl: string,
  options: {
    lookup?: LookupImplementation;
    transport?: ImageTransport;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
) {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("仅允许 HTTPS 视频地址");
  }
  const timeoutSignal = AbortSignal.timeout(60_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await waitWithAbort((options.lookup ?? defaultLookup)(hostname), signal);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("视频地址必须解析到公开网络地址");
  }

  const response = await (options.transport ?? requestPinnedHttps)(url, addresses[0], signal);
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (!response.ok || !contentType || !SUPPORTED_VIDEO_CONTENT_TYPES.has(contentType)) {
    await response.body?.cancel("视频响应无效");
    throw new Error("视频下载失败，请稍后重试");
  }
  return readBoundedBody(response, options.maxBytes ?? DEFAULT_MAX_VIDEO_BYTES);
}
