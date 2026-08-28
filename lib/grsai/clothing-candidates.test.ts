// @vitest-environment node

import { expect, it } from "vitest";
import { defaultModelCandidateRequest, defaultSceneCandidateRequest } from "@/features/clothing-studio/test-fixtures";
import { buildModelCandidatePrompt, buildSceneCandidatePrompt } from "./clothing-candidates";

it("creates a fashionable but unobstructed full-body model reference", () => {
  const prompt = buildModelCandidatePrompt(defaultModelCandidateRequest, 1);

  expect(prompt).toContain("自然、有时尚感的站姿");
  expect(prompt).toContain("全身");
  expect(prompt).toContain("手臂不遮挡躯干和腰线");
  expect(prompt).toContain("头发不遮挡肩部与领口");
  expect(prompt).toContain("不穿外套");
  expect(prompt).toContain("第 2 个构图变化");
});

it("creates an empty scene reference with the selected visual filters", () => {
  const prompt = buildSceneCandidatePrompt(defaultSceneCandidateRequest, 0);

  expect(prompt).toContain("手机网感");
  expect(prompt).toContain("街头");
  expect(prompt).toContain("自然光");
  expect(prompt).toContain("不出现人物、服装、商品、Logo 或可读文字");
  expect(prompt).toContain("第 1 个构图变化");
});
