// @vitest-environment node

import { expect, it, vi } from "vitest";
import { analyzeProduct } from "@/lib/grsai/analysis";
import { POST } from "./route";

vi.mock("@/lib/grsai/analysis", () => ({ analyzeProduct: vi.fn() }));

it("rejects more than six images before calling Grsai", async () => {
  const form = new FormData();
  for (let index = 0; index < 7; index += 1) {
    form.append("images", new File(["x"], `${index}.png`, { type: "image/png" }));
  }
  form.append(
    "settings",
    JSON.stringify({
      platform: "taobao",
      language: "zh-CN",
      aspectRatio: "1024x1536",
      imageCount: 4,
      quality: "auto",
    }),
  );

  const response = await POST(new Request("http://localhost/api/product/analyze", { method: "POST", body: form }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "最多上传 6 张产品图" });
});

it("does not treat an upstream SyntaxError as invalid generation settings", async () => {
  vi.mocked(analyzeProduct).mockRejectedValueOnce(new SyntaxError("upstream body was invalid"));
  const form = new FormData();
  form.append("images", new File(["x"], "product.png", { type: "image/png" }));
  form.append(
    "settings",
    JSON.stringify({
      platform: "taobao",
      language: "zh-CN",
      aspectRatio: "1024x1536",
      imageCount: 4,
      quality: "auto",
    }),
  );

  const response = await POST(new Request("http://localhost/api/product/analyze", { method: "POST", body: form }));

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "分析失败，请稍后重试" });
});
