import { expect, it } from "vitest";
import { signDownloadUrl, verifyDownloadToken } from "./download-token";

it("round trips an HTTPS result URL and rejects expiry or tampering", () => {
  const token = signDownloadUrl("https://cdn.example/result.png", "secret", 1_000, 60);

  expect(verifyDownloadToken(token, "secret", 1_030)).toBe("https://cdn.example/result.png");
  expect(() => verifyDownloadToken(`${token}x`, "secret", 1_030)).toThrow("下载令牌无效");
  expect(() => verifyDownloadToken(token, "secret", 1_061)).toThrow("下载令牌已过期");
});

it("refuses non-HTTPS URLs", () => {
  expect(() => signDownloadUrl("http://127.0.0.1/private", "secret", 1_000, 60)).toThrow(
    "仅允许 HTTPS 图片地址",
  );
});

it("uses a 15-minute default lifetime", () => {
  const token = signDownloadUrl("https://cdn.example/result.png", "secret", 1_000);

  expect(verifyDownloadToken(token, "secret", 1_900)).toBe("https://cdn.example/result.png");
  expect(() => verifyDownloadToken(token, "secret", 1_901)).toThrow("下载令牌已过期");
});

it("rejects malformed token parts without comparing unequal signature buffers", () => {
  expect(() => verifyDownloadToken("payload", "secret", 1_000)).toThrow("下载令牌无效");
  expect(() => verifyDownloadToken("payload.signature.extra", "secret", 1_000)).toThrow("下载令牌无效");
  expect(() => verifyDownloadToken("e30.AA", "secret", 1_000)).toThrow("下载令牌无效");
});
