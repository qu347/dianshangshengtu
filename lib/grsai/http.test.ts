import { beforeEach, expect, it, vi } from "vitest";
import { grsaiFetch } from "./http";

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it("maps balance responses without exposing the upstream body", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("积分不足: internal account 123", { status: 402 }));

  await expect(grsaiFetch("/test", { method: "POST", body: "{}" }, fetchImpl)).rejects.toMatchObject({
    code: "balance",
    message: "Grsai 积分或余额不足",
  });
});

it("maps network and timeout failures", async () => {
  await expect(grsaiFetch("/test", {}, vi.fn().mockRejectedValue(new TypeError("socket detail")))).rejects.toMatchObject({ code: "upstream" });
  await expect(grsaiFetch("/test", {}, vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")))).rejects.toMatchObject({ code: "timeout" });
});

it("normalizes malformed JSON from a successful upstream response", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("{ private upstream detail", { status: 200 }));

  await expect(grsaiFetch("/test", {}, fetchImpl)).rejects.toMatchObject({
    code: "upstream",
    status: 502,
    message: "Grsai 服务响应格式异常，请重试",
  });
});
