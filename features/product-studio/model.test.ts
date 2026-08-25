import { describe, expect, it } from "vitest";
import { GenerationSettingsSchema, GenerationTaskSchema, ProductAnalysisSchema, assertPlanCount } from "./model";

const settings = { platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto" };

describe("domain schemas", () => {
  it("accepts 1 through 16 images and rejects values outside the range", () => {
    expect(GenerationSettingsSchema.parse(settings).imageCount).toBe(4);
    expect(() => GenerationSettingsSchema.parse({ ...settings, imageCount: 0 })).toThrow();
    expect(() => GenerationSettingsSchema.parse({ ...settings, imageCount: 17 })).toThrow();
  });

  it("rejects a plan whose length differs from the requested count", () => {
    const analysis = ProductAnalysisSchema.parse({
      category: "杯具", productName: "保温杯", visualFacts: [{ value: "银色金属杯身", confidence: "observed" }], audience: ["通勤人群"],
      sellingPoints: [{ title: "便携", evidence: "用户提供", confidence: "user_provided" }], visualDirection: "简洁棚拍",
      plan: [{ id: "1", type: "main", title: "主图", objective: "展示产品", copy: "", scene: "白底", prompt: "白底产品主图" }],
    });
    expect(() => assertPlanCount(analysis, 2)).toThrow("规划数量应为 2，实际为 1");
  });

  it.each([
    ["success without a result URL", { planItemId: "1", providerJobId: "job-1", status: "succeeded", progress: 100, downloadToken: "token" }],
    ["success without a download token", { planItemId: "1", providerJobId: "job-1", status: "succeeded", progress: 100, resultUrl: "https://cdn.example/result.png" }],
    ["failure without an error", { planItemId: "1", providerJobId: "job-1", status: "failed", progress: 0 }],
    ["resumable timeout without a provider job id", { planItemId: "1", status: "timed_out", progress: 50, error: "查询失败" }],
  ])("rejects an impossible terminal task: %s", (_label, task) => {
    expect(GenerationTaskSchema.safeParse(task).success).toBe(false);
  });

  it("accepts complete success, failure, and resumable timeout tasks", () => {
    expect(GenerationTaskSchema.safeParse({
      planItemId: "1",
      providerJobId: "job-1",
      status: "succeeded",
      progress: 100,
      resultUrl: "https://cdn.example/result.png",
      downloadToken: "token",
    }).success).toBe(true);
    expect(GenerationTaskSchema.safeParse({
      planItemId: "2",
      providerJobId: "job-2",
      status: "failed",
      progress: 0,
      error: "生成失败",
    }).success).toBe(true);
    expect(GenerationTaskSchema.safeParse({
      planItemId: "3",
      providerJobId: "job-3",
      status: "timed_out",
      progress: 50,
      error: "查询失败",
    }).success).toBe(true);
  });
});
