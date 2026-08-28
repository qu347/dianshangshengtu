import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ImageRenderConfig } from "./image-render-config";
import {
  signDownloadUrl,
  signJobToken,
  verifyDownloadToken,
  verifyJobToken,
} from "./download-token";

const render: ImageRenderConfig = {
  imageIndex: 2,
  annotations: [{ id: "height", label: "Height", displayValue: "4.72 in" }],
  dimensionLayout: {
    bounds: { left: 180, top: 220, right: 820, bottom: 820 },
    placements: [{ id: "height", axis: "vertical", side: "right" }],
  },
  watermark: "Brand",
  applyWatermark: true,
};

function tokenFor(payload: unknown, secret = "secret") {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signaturePart = createHmac("sha256", secret).update(payloadPart).digest("base64url");
  return `${payloadPart}.${signaturePart}`;
}

describe("render-context tokens", () => {
  it("round-trips signed download and job render context", () => {
    const download = signDownloadUrl("https://cdn.example/image.png", render, "secret", 100, 60);
    expect(verifyDownloadToken(download, "secret", 120)).toEqual({
      url: "https://cdn.example/image.png",
      render,
    });
    const job = signJobToken("provider-job", render, "secret", 100, 60);
    expect(verifyJobToken(job, "secret", 120)).toEqual({ providerJobId: "provider-job", render });
  });

  it("round-trips an ordinary image-two render context without dimension layout", () => {
    const ordinary: ImageRenderConfig = {
      imageIndex: 2,
      annotations: [],
      watermark: "Brand",
      applyWatermark: true,
    };

    const token = signDownloadUrl("https://cdn.example/ordinary.png", ordinary, "secret", 100, 60);
    expect(verifyDownloadToken(token, "secret", 120)).toEqual({
      url: "https://cdn.example/ordinary.png",
      render: ordinary,
    });
  });

  it("rejects a render-context mutation", () => {
    const token = signJobToken("provider-job", render, "secret", 100, 60);
    const [payload, signature] = token.split(".");
    const changed = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      render: { ...render, applyWatermark: false },
    })).toString("base64url");

    expect(() => verifyJobToken(`${changed}.${signature}`, "secret", 120)).toThrow("任务令牌无效");
  });

  it("rejects expired download and job tokens", () => {
    const download = signDownloadUrl("https://cdn.example/image.png", render, "secret", 100, 60);
    const job = signJobToken("provider-job", render, "secret", 100, 60);

    expect(() => verifyDownloadToken(download, "secret", 161)).toThrow("下载令牌已过期");
    expect(() => verifyJobToken(job, "secret", 161)).toThrow("任务令牌已过期");
  });

  it("keeps default job tokens valid for 24 hours while downloads expire after 15 minutes", () => {
    const download = signDownloadUrl("https://cdn.example/image.png", render, "secret", 100);
    const job = signJobToken("provider-job", render, "secret", 100);

    expect(verifyJobToken(job, "secret", 100 + 20 * 60 + 1)).toEqual({
      providerJobId: "provider-job",
      render,
    });
    expect(verifyJobToken(job, "secret", 100 + 24 * 60 * 60)).toEqual({
      providerJobId: "provider-job",
      render,
    });
    expect(() => verifyJobToken(job, "secret", 100 + 24 * 60 * 60 + 1))
      .toThrow("任务令牌已过期");
    expect(verifyDownloadToken(download, "secret", 100 + 15 * 60)).toEqual({
      url: "https://cdn.example/image.png",
      render,
    });
    expect(() => verifyDownloadToken(download, "secret", 100 + 15 * 60 + 1))
      .toThrow("下载令牌已过期");
  });

  it("rejects the wrong token kind", () => {
    const download = signDownloadUrl("https://cdn.example/image.png", render, "secret", 100, 60);
    const job = signJobToken("provider-job", render, "secret", 100, 60);

    expect(() => verifyJobToken(download, "secret", 120)).toThrow("任务令牌无效");
    expect(() => verifyDownloadToken(job, "secret", 120)).toThrow("下载令牌无效");
  });

  it("rejects signed download payloads without a discriminator", () => {
    const token = tokenFor({ url: "https://cdn.example/image.png", exp: 160 });

    expect(() => verifyDownloadToken(token, "secret", 120)).toThrow("下载令牌无效");
  });

  it("rejects non-HTTPS source URLs without exposing them", () => {
    const unsafeUrl = "http://127.0.0.1/private-resource";
    const token = tokenFor({ kind: "download", url: unsafeUrl, render, exp: 160 });

    expect(() => signDownloadUrl(unsafeUrl, render, "secret", 100, 60)).toThrow(
      "仅允许 HTTPS 图片地址",
    );
    expect(() => verifyDownloadToken(token, "secret", 120)).toThrow("下载令牌无效");
    try {
      verifyDownloadToken(token, "secret", 120);
    } catch (error) {
      expect((error as Error).message).not.toContain(unsafeUrl);
    }
  });

  it("rejects malformed token structure and non-canonical Base64URL", () => {
    const valid = signJobToken("provider-job", render, "secret", 100, 60);
    const [payloadPart, signaturePart] = valid.split(".");
    const nonCanonicalPayload = `${payloadPart}=`;
    const matchingSignature = createHmac("sha256", "secret")
      .update(nonCanonicalPayload)
      .digest("base64url");

    for (const token of [
      "payload",
      "payload.signature.extra",
      "e30.AA",
      `${payloadPart}.${signaturePart}=`,
      `${nonCanonicalPayload}.${matchingSignature}`,
    ]) {
      expect(() => verifyJobToken(token, "secret", 120)).toThrow("任务令牌无效");
    }
  });

  it("rejects malformed, invalid, and incomplete job payloads", () => {
    const payloads = [
      null,
      [],
      { kind: "job", providerJobId: "", render, exp: 160 },
      { kind: "job", providerJobId: "   ", render, exp: 160 },
      { kind: "job", providerJobId: 123, render, exp: 160 },
      { kind: "job", providerJobId: "provider-job", render, exp: "160" },
      { kind: "job", providerJobId: "provider-job", render: null, exp: 160 },
      { kind: "job", providerJobId: "provider-job", exp: 160 },
      { kind: "download", url: "https://cdn.example/image.png", render, exp: 100 },
    ];

    for (const payload of payloads) {
      expect(() => verifyJobToken(tokenFor(payload), "secret", 120)).toThrow("任务令牌无效");
    }
  });

  it("validates every nested render field and its bounds", () => {
    const invalidRenders = [
      { ...render, imageIndex: 0 },
      { ...render, imageIndex: 1.5 },
      { ...render, imageIndex: Number.MAX_SAFE_INTEGER + 1 },
      { ...render, imageIndex: "2" },
      { ...render, annotations: "none" },
      { ...render, annotations: Array.from({ length: 7 }, () => ({ label: "H", displayValue: "1 cm" })) },
      { ...render, annotations: [null] },
      { ...render, annotations: [{ label: "", displayValue: "1 cm" }] },
      { ...render, annotations: [{ label: "x".repeat(41), displayValue: "1 cm" }] },
      { ...render, annotations: [{ label: 2, displayValue: "1 cm" }] },
      { ...render, annotations: [{ label: "Height", displayValue: "" }] },
      { ...render, annotations: [{ label: "Height", displayValue: "x".repeat(41) }] },
      { ...render, annotations: [{ label: "Height", displayValue: 2 }] },
      { ...render, dimensionLayout: { ...render.dimensionLayout, bounds: { left: -1, top: 220, right: 820, bottom: 820 } } },
      { ...render, dimensionLayout: { ...render.dimensionLayout, placements: [{ id: "height", axis: "diagonal", side: "right" }] } },
      { ...render, dimensionLayout: { ...render.dimensionLayout, placements: [{ id: "wrong", axis: "vertical", side: "right" }] } },
      { ...render, watermark: "x".repeat(41) },
      { ...render, watermark: false },
      { ...render, applyWatermark: "yes" },
    ];

    for (const invalidRender of invalidRenders) {
      const token = tokenFor({
        kind: "job",
        providerJobId: "provider-job",
        render: invalidRender,
        exp: 160,
      });
      expect(() => verifyJobToken(token, "secret", 120)).toThrow("任务令牌无效");
    }
  });
});
