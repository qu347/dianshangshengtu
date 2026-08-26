// @vitest-environment node

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPublicImage,
  requestPinnedHttps,
  type ResolvedAddress,
} from "./remote-image";

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function imageResponse(body: BodyInit = pngBytes) {
  return new Response(body, { status: 200, headers: { "Content-Type": "image/png" } });
}

describe("fetchPublicImage", () => {
  it.each([
    ["unspecified IPv4", "0.0.0.0", 4],
    ["private IPv4", "10.0.0.1", 4],
    ["carrier-grade NAT", "100.64.0.1", 4],
    ["loopback IPv4", "127.0.0.1", 4],
    ["link-local IPv4", "169.254.1.1", 4],
    ["private IPv4", "192.168.1.1", 4],
    ["benchmark IPv4", "198.18.0.1", 4],
    ["documentation IPv4", "203.0.113.1", 4],
    ["multicast IPv4", "224.0.0.1", 4],
    ["unspecified IPv6", "::", 6],
    ["loopback IPv6", "::1", 6],
    ["mapped loopback IPv6", "::ffff:127.0.0.1", 6],
    ["unique-local IPv6", "fd00::1", 6],
    ["link-local IPv6", "fe80::1", 6],
    ["multicast IPv6", "ff02::1", 6],
    ["documentation IPv6", "2001:db8::1", 6],
  ] as const)("rejects %s before opening a connection", async (_label, address, family) => {
    const transport = vi.fn();

    await expect(fetchPublicImage("https://cdn.example/image.png", {
      lookup: vi.fn().mockResolvedValue([{ address, family }]),
      transport,
    })).rejects.toThrow("公开网络地址");

    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a hostname when any DNS answer is non-public", async () => {
    const transport = vi.fn();

    await expect(fetchPublicImage("https://cdn.example/image.png", {
      lookup: vi.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
      transport,
    })).rejects.toThrow("公开网络地址");

    expect(transport).not.toHaveBeenCalled();
  });

  it("passes the validated public DNS answer to the transport and returns bounded image bytes", async () => {
    const address: ResolvedAddress = { address: "93.184.216.34", family: 4 };
    const transport = vi.fn().mockResolvedValue(imageResponse());

    const result = await fetchPublicImage("https://cdn.example/image.png", {
      lookup: vi.fn().mockResolvedValue([address]),
      transport,
    });

    expect(result).toEqual(Buffer.from(pngBytes));
    expect(transport).toHaveBeenCalledWith(
      new URL("https://cdn.example/image.png"),
      address,
      expect.any(AbortSignal),
    );
  });

  it("rejects redirects without following the Location target", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "https://other.example/result.png" },
    }));

    await expect(fetchPublicImage("https://cdn.example/image.png", {
      lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
      transport,
    })).rejects.toThrow("图片下载失败");

    expect(transport).toHaveBeenCalledOnce();
  });

  it("cancels unsupported and oversized response bodies", async () => {
    let cancelled = 0;
    const unsupported = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled += 1; },
    });
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(9)); },
      cancel() { cancelled += 1; },
    });
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response(unsupported, { headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(new Response(oversized, { headers: { "Content-Type": "image/png" } }));
    const options = {
      lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
      transport,
      maxBytes: 8,
    };

    await expect(fetchPublicImage("https://cdn.example/unsupported", options)).rejects.toThrow("图片下载失败");
    await expect(fetchPublicImage("https://cdn.example/oversized", options)).rejects.toThrow("图片响应过大");
    expect(cancelled).toBe(2);
  });
});

describe("requestPinnedHttps", () => {
  it("connects to the validated IP while preserving the original host for TLS and HTTP", async () => {
    const incoming = Readable.from([pngBytes]) as Readable & {
      statusCode: number;
      headers: Record<string, string>;
    };
    incoming.statusCode = 200;
    incoming.headers = { "content-type": "image/png" };
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
    });
    const requestImpl = vi.fn((options, callback: (response: typeof incoming) => void) => {
      queueMicrotask(() => callback(incoming));
      return request;
    });
    const url = new URL("https://cdn.example:8443/path/image.png?size=large");

    const response = await requestPinnedHttps(
      url,
      { address: "93.184.216.34", family: 4 },
      new AbortController().signal,
      requestImpl as never,
    );

    const options = requestImpl.mock.calls[0][0];
    expect(options).toMatchObject({
      hostname: "93.184.216.34",
      port: 8443,
      path: "/path/image.png?size=large",
      servername: "cdn.example",
      headers: { Host: "cdn.example:8443" },
    });
    expect(options.checkServerIdentity).toBeTypeOf("function");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(pngBytes));
  });
});
