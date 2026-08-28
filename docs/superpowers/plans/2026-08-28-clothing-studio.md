# Clothing Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent clothing-image studio that accepts garment references, one selected model, an optional scene, and produces a consistent 1–16 image e-commerce set whose first image is a validated white-background flat lay.

**Architecture:** Add `/clothing-studio`, `features/clothing-studio`, and `/api/clothing/*` without converting the existing product studio into a mode switch. Reuse the current Grsai transport, signed job/download tokens, safe remote-image fetch, white-background normalization, watermark renderer, polling concepts, and upload preprocessing; keep clothing schemas, planning rules, UI state, candidate generation, and two-stage orchestration inside the new module.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Tailwind CSS 4, Sharp, JSZip, Vitest, Testing Library, Playwright, Grsai GPT Image 2 and Gemini chat completions.

**Spec:** `docs/superpowers/specs/2026-08-28-clothing-studio-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`, `04-linking-and-navigating.md`, `05-server-and-client-components.md`, and `15-route-handlers.md` before editing App Router files.
- Keep the clothing module independent; do not add a clothing mode to `features/product-studio`.
- Garment references are required and limited to 1–6 normalized JPG, PNG, or WEBP files.
- A selected model is required before analysis; a scene is optional.
- Model and scene candidate generation accepts exactly 1–4 results per request.
- Final image count is exactly 1–16 and is chosen by the user; AI chooses image types after image one.
- Image one is always a complete garment-only flat lay on a pure-white canvas with no person, mannequin, hanger, props, marketing copy, or dimension annotation.
- Every later image depends on the signed successful image-one result and uses the same selected model; the scene reference remains optional.
- Model identity, garment colors/shape/pattern/Logo, and selected scene style must remain visibly consistent across the set.
- All planning fields and image-generation prompts are Chinese; visible marketing copy follows the existing Chinese/English/Russian platform mapping.
- Reuse the existing watermark rule exactly: Amazon image one has no watermark; a non-empty watermark applies to other images and to all images for other platforms.
- Candidate history is page-lifetime only; final task IDs and plan data may use `sessionStorage` only for same-tab refresh recovery.
- Final generation has at most three concurrent jobs. A white-background failure for image one gets one automatic retry; no other error is auto-resubmitted.
- Automated tests must mock Grsai and must not spend real image-generation credits.
- Preserve all pre-existing modified and untracked files. Each commit stages only the paths explicitly listed for its task.

---

### Task 1: Define the independent clothing domain and fixed plan rules

**Files:**
- Create: `features/clothing-studio/model.ts`
- Create: `features/clothing-studio/model.test.ts`
- Create: `features/clothing-studio/lib/plan-rules.ts`
- Create: `features/clothing-studio/lib/plan-rules.test.ts`
- Create: `features/clothing-studio/test-fixtures.ts`

**Interfaces:**
- Produces: `ClothingGenerationSettings`, with platform/language/aspect-ratio/quality/watermark/image-count fields and no dimension flag.
- Produces: `ReferenceAsset = { id; kind; source; previewUrl; file?; downloadToken? }`.
- Produces: `ClothingPlanItem`, `ClothingAnalysis`, and `ClothingGenerationTask` schemas and types.
- Produces: `ModelCandidateRequestSchema` and `SceneCandidateRequestSchema` with count `1..4`.
- Produces: `applyClothingPlanRules(analysis)` and `ClothingGenerationPlanSchema(settings)`.

- [ ] **Step 1: Write failing domain tests**

Cover the exact count limits, platform-language mapping, reference-source invariant, consecutive plan IDs, Chinese fields, no-copy mode, and the immutable first item:

```ts
expect(ClothingGenerationSettingsSchema.parse({
  platform: "ozon", language: "ru", aspectRatio: "1090x1443",
  imageCount: 16, quality: "auto", watermark: "Brand",
})).toMatchObject({ imageCount: 16, language: "ru" });
expect(() => ClothingGenerationSettingsSchema.parse({
  ...defaultClothingSettings, platform: "amazon", language: "zh-CN",
})).toThrow();
expect(() => ModelCandidateRequestSchema.parse({
  ...defaultModelCandidateRequest, count: 5,
})).toThrow();
expect(ClothingCategorySchema.options).toEqual(["top", "bottom", "dress", "coat", "set"]);

const ruled = applyClothingPlanRules(makeClothingAnalysis(3));
expect(ruled.plan[0]).toMatchObject({
  id: "1", type: "flat_lay", title: "白底服装平铺主图", copy: "",
});
expect(ruled.plan[0].prompt).toContain("纯白背景");
expect(ruled.plan[0].prompt).toContain("不出现人物");
expect(ClothingGenerationPlanSchema(defaultClothingSettings).parse(ruled.plan)).toHaveLength(3);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run features/clothing-studio/model.test.ts features/clothing-studio/lib/plan-rules.test.ts
```

Expected: FAIL because the clothing domain does not exist.

- [ ] **Step 3: Implement strict Zod schemas**

Define these exact core shapes in `model.ts`:

```ts
export const ClothingGenerationSettingsSchema = z.object({
  platform: z.enum(["general", "taobao", "douyin", "amazon", "shopify", "ozon"]),
  language: z.enum(["none", "zh-CN", "en", "ru"]),
  aspectRatio: z.enum(["1024x1024", "1024x1536", "1536x1024", "1090x1443"]),
  imageCount: z.number().int().min(1).max(16),
  quality: z.enum(["auto", "low", "medium", "high"]),
  watermark: z.string().max(40),
}).superRefine((settings, context) => {
  const fixed = { taobao: "zh-CN", douyin: "zh-CN", amazon: "en", shopify: "en", ozon: "ru" } as const;
  const expected = fixed[settings.platform as keyof typeof fixed];
  if (expected && settings.language !== expected) {
    context.addIssue({ code: "custom", path: ["language"], message: "平台语言必须使用固定映射" });
  }
});

export const ClothingPlanItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["flat_lay", "model", "scene", "detail"]),
  title: z.string().min(1), objective: z.string().min(1), copy: z.string(),
  scene: z.string().min(1), prompt: z.string().min(1),
});

export const ClothingCategorySchema = z.enum(["top", "bottom", "dress", "coat", "set"]);

export type ReferenceAsset = {
  id: string;
  kind: "model" | "scene";
  source: "upload" | "generated";
  previewUrl: string;
  file?: File;
  downloadToken?: string;
};
```

Use non-empty strings with sensible maximums for all candidate filters and `requirements`; enforce exactly one of `file` or `downloadToken` in a pure `validateReferenceAsset` helper rather than attempting to parse `File` through Zod.

- [ ] **Step 4: Implement canonical plan rules**

Set index zero to this fixed template and strip copy from every item when language is `none`:

```ts
const firstPlanItem = {
  type: "flat_lay" as const,
  title: "白底服装平铺主图",
  objective: "完整准确展示当前销售服装",
  copy: "",
  scene: "纯白背景摄影棚，服装正面平铺、完整居中并保留安全边距",
  prompt: "仅展示当前销售服装，保持颜色、版型、材质、纹理、图案、Logo 和 SKU 特征不变；服装正面平铺、完整居中、不裁切；整张画布使用无渐变无纹理的纯白背景；不出现人物、人体模型、衣架、道具、营销文字或尺寸标注。",
};
```

Require plan IDs to be `1..imageCount` without gaps; require Han characters in `title`, `objective`, `scene`, and `prompt`; prevent later items from using `flat_lay`; require image one to match the fixed type, blank copy, and white/no-person invariants.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- features/clothing-studio/model.ts features/clothing-studio/model.test.ts features/clothing-studio/lib/plan-rules.ts features/clothing-studio/lib/plan-rules.test.ts features/clothing-studio/test-fixtures.ts
git commit -m "feat: define clothing studio domain"
```

---

### Task 2: Build clothing analysis and generation prompts

**Files:**
- Create: `lib/grsai/clothing-analysis.ts`
- Create: `lib/grsai/clothing-analysis.test.ts`
- Create: `lib/grsai/clothing-images.ts`
- Create: `lib/grsai/clothing-images.test.ts`
- Create: `lib/grsai/clothing-candidates.ts`
- Create: `lib/grsai/clothing-candidates.test.ts`

**Interfaces:**
- Produces: `analyzeClothing(input, fetchImpl?)` with one JSON-repair attempt.
- Produces: `buildClothingAnalysisPrompt(input)`.
- Produces: `buildClothingGenerationPrompt(item, settings, { hasScene })`.
- Produces: `buildModelCandidatePrompt(filters, variationIndex)` and `buildSceneCandidatePrompt(filters, variationIndex)`.
- Consumes: existing `grsaiFetch` and `submitImageGeneration`; no new provider transport is introduced.

- [ ] **Step 1: Write failing prompt tests**

Require the analysis request to label reference groups and the generated plan to be normalized:

```ts
const analysis = await analyzeClothing({
  garments: ["data:image/webp;base64,Z2FybWVudA=="],
  model: "data:image/webp;base64,bW9kZWw=",
  scene: undefined,
  settings: { ...defaultClothingSettings, imageCount: 2 },
  requirements: "突出垂坠感",
}, fetchImpl);
expect(analysis.plan[0].title).toBe("白底服装平铺主图");
expect(analysis.plan[1].type).not.toBe("flat_lay");
expect(fetchImpl).toHaveBeenCalledTimes(1);
```

Add a first-invalid/second-valid case with exactly two calls and a two-invalid case that throws `AI 服装分析结果格式异常，请重新分析`.

Require generation prompts to contain the correct invariants:

```ts
expect(buildClothingGenerationPrompt(plan[0], settings, { hasScene: false }))
  .toContain("不使用模特参考图或场景参考图");
expect(buildClothingGenerationPrompt(plan[1], settings, { hasScene: true }))
  .toContain("所有人物参考图均为同一位模特");
expect(buildClothingGenerationPrompt(plan[1], settings, { hasScene: true }))
  .toContain("保持脸部、体型、肤色和发型一致");
```

Require candidate prompts to include full-body visibility, unobstructed torso/waist, uncovered shoulders/neckline, no outerwear, and an empty person-free scene.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run lib/grsai/clothing-analysis.test.ts lib/grsai/clothing-images.test.ts lib/grsai/clothing-candidates.test.ts
```

Expected: FAIL because the clothing Grsai adapters do not exist.

- [ ] **Step 3: Implement structured clothing analysis**

Build the multimodal content in this exact order:

```ts
const content = [
  { type: "text", text: buildClothingAnalysisPrompt(promptInput) },
  { type: "text", text: "以下图片为服装参考图：" },
  ...input.garments.map((url) => ({ type: "image_url", image_url: { url } })),
  { type: "text", text: "以下图片为整组唯一模特参考图：" },
  { type: "image_url", image_url: { url: input.model } },
  ...(input.scene ? [
    { type: "text", text: "以下图片为可选场景风格参考图：" },
    { type: "image_url", image_url: { url: input.scene } },
  ] : []),
];
```

Request `gemini-3.1-flash-lite`, strict JSON, exactly `settings.imageCount` items, Chinese planning fields, the supported clothing categories, and no invented composition/certification/function claims. Parse with the Task 1 schemas, apply fixed plan rules, and perform only one format-repair request.

- [ ] **Step 4: Implement final and candidate prompts**

For later final images, state the reference order and exact consistency rules:

```ts
return [
  "第 1 组参考图是同一件销售服装，生成结果必须保持颜色、版型、纹理、图案、Logo 和关键结构一致。",
  "白底平铺图是服装标准参考，不得把平铺形态复制到穿着状态。",
  "模特参考图定义唯一人物；保持脸部、体型、肤色和发型一致，只改变姿势、镜头和构图。",
  hasScene
    ? "场景参考图定义整组空间、光线与视觉风格；允许改变机位、景别和局部布置。"
    : "没有指定场景参考图；使用与服装匹配且整组统一的简洁场景。",
  `任务目标：${item.objective}。场景与构图：${item.scene}。`,
  item.copy ? `画面文案：${item.copy}。` : "",
  `用户确认的中文提示词：${item.prompt}。`,
].filter(Boolean).join("\n");
```

Model-candidate prompts use a clean background and fitted neutral base clothing; scene-candidate prompts forbid people, garments, products, logos, and readable text. Add `variationIndex + 1` as a composition variation instruction so a 1–4 batch is not four identical prompts.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS and no test reaches the network.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/grsai/clothing-analysis.ts lib/grsai/clothing-analysis.test.ts lib/grsai/clothing-images.ts lib/grsai/clothing-images.test.ts lib/grsai/clothing-candidates.ts lib/grsai/clothing-candidates.test.ts
git commit -m "feat: add clothing image prompts"
```

---

### Task 3: Validate clothing uploads and trusted model/scene references

**Files:**
- Create: `lib/clothing-upload.ts`
- Create: `lib/clothing-upload.test.ts`
- Create: `lib/clothing-reference.ts`
- Create: `lib/clothing-reference.test.ts`

**Interfaces:**
- Produces: `clothingRequestHeaders = { "X-Clothing-Studio-Request": "1" }`.
- Produces: `validateClothingPostRequest(request)` with a 48 MB declared-body limit.
- Produces: `validateClothingImages(form, field, { min, max, label })` using MIME, size, and magic-byte checks.
- Produces: `resolveClothingReference(form, { fileField, tokenField, required }, secret)` returning a data URL from exactly one uploaded file or one signed generated-result token.

- [ ] **Step 1: Write failing boundary tests**

Cover missing private header, a body over 48 MB, 0 and 7 garments, spoofed WEBP data, model file/token ambiguity, missing required model, optional missing scene, tampered/expired tokens, and a valid token fetched only through `fetchPublicImage`:

```ts
await expect(resolveClothingReference(formWithBothModelSources, {
  fileField: "modelImage", tokenField: "modelToken", required: true,
}, "secret")).rejects.toThrow("模特图来源无效");

expect(await resolveClothingReference(formWithValidModelToken, {
  fileField: "modelImage", tokenField: "modelToken", required: true,
}, "secret", { fetchImage })).toBe("data:image/png;base64,aW1hZ2U=");
expect(fetchImage).toHaveBeenCalledWith("https://cdn.example/model.png");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run lib/clothing-upload.test.ts lib/clothing-reference.test.ts
```

Expected: FAIL because the clothing upload boundary does not exist.

- [ ] **Step 3: Implement exact upload validation**

Use maximum normalized file size `5 * 1024 * 1024`, accept only JPEG/PNG/WEBP, and inspect these signatures:

```ts
const signatures = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
} as const;
```

For WEBP, also require bytes 8–11 to equal `WEBP`. Return role-specific Chinese errors such as `请至少上传 1 张服装图`, `最多上传 6 张服装图`, and `模特图格式或大小不符合要求`.

- [ ] **Step 4: Resolve one trusted reference source**

For an uploaded file, validate exactly one file and convert it to a data URL. For a token, call `verifyDownloadToken`, require `render.imageIndex === 99` with empty annotations and no watermark, fetch its HTTPS source through `fetchPublicImage`, rotate and encode the returned buffer with Sharp, and return `data:image/png;base64,...`. Reject both-sources and neither-source cases before fetching.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/clothing-upload.ts lib/clothing-upload.test.ts lib/clothing-reference.ts lib/clothing-reference.test.ts
git commit -m "feat: validate clothing references"
```

---

### Task 4: Add model and scene candidate APIs

**Files:**
- Create: `app/api/clothing/model-candidates/route.ts`
- Create: `app/api/clothing/model-candidates/route.test.ts`
- Create: `app/api/clothing/scene-candidates/route.ts`
- Create: `app/api/clothing/scene-candidates/route.test.ts`
- Create: `lib/clothing-candidate-jobs.ts`
- Create: `lib/clothing-candidate-jobs.test.ts`

**Interfaces:**
- Produces: `submitCandidateBatch({ kind, count, promptForIndex, aspectRatio, quality, requestUrl })` returning `ClothingGenerationTask[]`.
- Model endpoint accepts `ModelCandidateRequest`; scene endpoint accepts `SceneCandidateRequest`.
- Candidate job render config is `{ imageIndex: 99, annotations: [], watermark: "", applyWatermark: false }`, so existing signed job/download infrastructure treats it as a plain reference image.

- [ ] **Step 1: Write failing route and batch tests**

Require count validation, provider call count, model portrait ratio, scene-selected ratio, partial failure preservation, and opaque signed job IDs:

```ts
expect(submitImageGeneration).toHaveBeenCalledTimes(3);
expect(submitImageGeneration).toHaveBeenNthCalledWith(1, expect.objectContaining({
  images: [], aspectRatio: "1090x1443", quality: "auto",
}));
expect(responseBody.tasks).toHaveLength(3);
expect(verifyJobToken(responseBody.tasks[0].providerJobId, "secret").render.imageIndex).toBe(99);
```

For one rejected provider call, require one failed task with a localized error and retain the other submitted tasks instead of returning an all-or-nothing 500.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run lib/clothing-candidate-jobs.test.ts app/api/clothing/model-candidates/route.test.ts app/api/clothing/scene-candidates/route.test.ts
```

Expected: FAIL because candidate APIs do not exist.

- [ ] **Step 3: Implement partial-success candidate submission**

Use `Promise.allSettled` and map each slot to a stable local ID:

```ts
const settled = await Promise.allSettled(Array.from({ length: input.count }, async (_, index) => {
  const job = await submitImageGeneration({
    images: [], prompt: input.promptForIndex(index),
    aspectRatio: input.aspectRatio, quality: input.quality,
  });
  return providerJobToTask(job, `${input.kind}-${crypto.randomUUID()}`, input.requestUrl);
}));
```

Sign running provider IDs with `signJobToken`. For immediate success, sign the HTTPS result with `signDownloadUrl(..., nowSeconds, 2 * 60 * 60)` and create a same-origin `/api/clothing/download?inline=1` preview URL. Candidate-reference tokens use a two-hour lifetime so review and planning do not invalidate the selected model or scene. Never expose raw provider job IDs or raw CDN URLs.

- [ ] **Step 4: Implement the two POST routes**

Both routes require `clothingRequestHeaders`, `GRSAI_API_KEY`, and `DOWNLOAD_TOKEN_SECRET`. Parse JSON through the Task 1 request schema. Model uses fixed `1090x1443`; scene uses its requested final ratio. Map `GrsaiError` to its normalized status/message and malformed JSON/Zod input to 400.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- app/api/clothing/model-candidates/route.ts app/api/clothing/model-candidates/route.test.ts app/api/clothing/scene-candidates/route.ts app/api/clothing/scene-candidates/route.test.ts lib/clothing-candidate-jobs.ts lib/clothing-candidate-jobs.test.ts
git commit -m "feat: generate clothing reference candidates"
```

---

### Task 5: Add clothing analysis and final-generation APIs

**Files:**
- Create: `app/api/clothing/analyze/route.ts`
- Create: `app/api/clothing/analyze/route.test.ts`
- Create: `app/api/clothing/generate/route.ts`
- Create: `app/api/clothing/generate/route.test.ts`
- Create: `app/api/clothing/jobs/[id]/route.ts`
- Create: `app/api/clothing/jobs/[id]/route.test.ts`
- Create: `app/api/clothing/download/route.ts`
- Create: `app/api/clothing/download/route.test.ts`
- Create: `lib/clothing-render-config.ts`
- Create: `lib/clothing-render-config.test.ts`

**Interfaces:**
- `POST /api/clothing/analyze` accepts `garments`, exactly one model source, optional scene source, `settings`, and `requirements`.
- `POST /api/clothing/generate` accepts one confirmed item; image one accepts garments only, while later items require `baseImageToken`, model, and optional scene.
- `GET /api/clothing/jobs/[id]` verifies signed job tokens and returns same-origin clothing preview URLs.
- `GET /api/clothing/download` uses the existing token verifier, safe remote fetcher, and renderer through a thin clothing route.
- Produces: `createClothingRenderConfig(item, settings)` with no annotations.

- [ ] **Step 1: Write failing analysis-route tests**

Require 1–6 garments, one model source, optional scene, exact settings parsing, Chinese plan output, and no provider call on invalid inputs:

```ts
expect(analyzeClothing).toHaveBeenCalledWith(expect.objectContaining({
  garments: ["data:image/webp;base64,UklGRgAAAABXRUJQ"],
  model: "data:image/webp;base64,UklGRgAAAABXRUJQ",
  scene: undefined,
  settings: defaultClothingSettings,
}));
```

- [ ] **Step 2: Write failing generation/job/download tests**

Require these boundaries:

```ts
expect(imageOneRequestWithModel.status).toBe(400);
expect(laterImageWithoutBase.status).toBe(400);
expect(laterImageWithoutModel.status).toBe(400);
expect(submitImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
  images: [normalizedMain, ...garments, model, scene],
}));
```

Assert image-one render config has no annotations and follows the shared watermark rule. Assert immediate/polled results use `/api/clothing/download`, white-background failure returns a failed task without signing, tampered tokens return 400, and the download route returns the same PNG bytes as the existing product download handler.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npx vitest run app/api/clothing/analyze/route.test.ts app/api/clothing/generate/route.test.ts app/api/clothing/jobs/[id]/route.test.ts app/api/clothing/download/route.test.ts lib/clothing-render-config.test.ts
```

Expected: FAIL because the clothing API namespace does not exist.

- [ ] **Step 4: Implement analysis and render configuration**

Parse multipart JSON before calling `analyzeClothing`. Convert garments to data URLs, resolve model/scene through Task 3, and return `{ analysis }`.

Create render config without dimension data:

```ts
export function createClothingRenderConfig(item: ClothingPlanItem, settings: ClothingGenerationSettings): ImageRenderConfig {
  const imageIndex = Number(item.id);
  if (!Number.isSafeInteger(imageIndex) || imageIndex < 1 || imageIndex > settings.imageCount) {
    throw new Error("图片序号无效");
  }
  const watermark = settings.watermark.trim();
  return {
    imageIndex,
    annotations: [],
    watermark,
    applyWatermark: shouldApplyWatermark(settings.platform, imageIndex, watermark),
  };
}
```

- [ ] **Step 5: Implement two-stage-safe generation**

For image one, reject `modelImage`, `modelToken`, `sceneImage`, `sceneToken`, and `baseImageToken`; submit only garment data URLs with the fixed flat-lay prompt.

For image two and later:

1. verify `baseImageToken` and require `render.imageIndex === 1`;
2. fetch and normalize the signed image-one source;
3. resolve the required model and optional scene;
4. submit `[normalizedMain, ...garments, model, ...(scene ? [scene] : [])]`;
5. sign the Task 5 render config into running or successful task tokens.

Call `prepareGeneratedImageResult` before signing immediate and polled success, so image one uses the existing white-background validation/normalization path. In the polling route, detect `render.imageIndex === 99` and sign candidate results for two hours; keep the existing normal result TTL for final images. Use the same Grsai and moderation error mapping as product routes.

- [ ] **Step 6: Implement query and download routes**

Copy the product job-query control flow but build preview URLs with:

```ts
const resultUrl = new URL("/api/clothing/download", request.url);
resultUrl.searchParams.set("token", downloadToken);
resultUrl.searchParams.set("inline", "1");
```

In the clothing download route, verify `token` with `verifyDownloadToken`, fetch `verified.url` through `fetchPublicImage`, and call `renderProductImage(input, verified.render)`. Return `image/png` with `private, no-store` and `nosniff` headers. This keeps signature verification, SSRF protection, normalization, watermarking, MIME, byte, and pixel limits identical without importing one Next.js route file from another.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- app/api/clothing/analyze/route.ts app/api/clothing/analyze/route.test.ts app/api/clothing/generate/route.ts app/api/clothing/generate/route.test.ts app/api/clothing/jobs/[id]/route.ts app/api/clothing/jobs/[id]/route.test.ts app/api/clothing/download/route.ts app/api/clothing/download/route.test.ts lib/clothing-render-config.ts lib/clothing-render-config.test.ts
git commit -m "feat: add clothing generation APIs"
```

---

### Task 6: Add client APIs, polling, dependency orchestration, and recovery

**Files:**
- Create: `features/clothing-studio/lib/client-api.ts`
- Create: `features/clothing-studio/lib/client-api.test.ts`
- Create: `features/clothing-studio/lib/generation-runner.ts`
- Create: `features/clothing-studio/lib/generation-runner.test.ts`
- Create: `features/clothing-studio/lib/session-store.ts`
- Create: `features/clothing-studio/lib/session-store.test.ts`
- Create: `features/clothing-studio/lib/downloads.ts`
- Create: `features/clothing-studio/lib/downloads.test.ts`
- Create: `features/clothing-studio/state.ts`
- Create: `features/clothing-studio/state.test.ts`

**Interfaces:**
- Produces: `ClothingStudioApi = { analyze; submitCandidates; submit; status }`.
- Produces: `pollClothingJob`, `runCandidateBatch`, and `runClothingGenerationBatch`.
- Produces: `saveClothingSession`, `loadClothingSession`, and `clearClothingSession` using key `clothing-studio-active-run-v1`.
- Produces: reducer state phases `input | analyzing | reviewing_plan | generating_main | generating_set | completed`.

- [ ] **Step 1: Write failing client serialization tests**

Require `analyzeClothingClient` and `submitClothingGenerationClient` to serialize uploaded and generated references differently:

```ts
expect(form.get("modelImage")).toBe(uploadedModel.file);
expect(form.get("modelToken")).toBeNull();
expect(generatedForm.get("modelToken")).toBe(generatedModel.downloadToken);
expect(imageOneForm.get("modelToken")).toBeNull();
expect(imageTwoForm.get("baseImageToken")).toBe("main-token");
```

Require model candidate requests to call `/api/clothing/model-candidates`, scene requests to call `/api/clothing/scene-candidates`, and status to URL-encode the opaque job token.

- [ ] **Step 2: Write failing orchestration and session tests**

Use deferred promises and require:

```ts
expect(maximumObservedConcurrency).toBeLessThanOrEqual(3);
expect(imageTwoSubmittedBeforeImageOneSuccess).toBe(false);
expect(imageTwoSubmit.baseImageToken).toBe("main-token");
expect(imageTwoSubmit.model).toEqual(selectedModel);
```

Add exact cases for:

- image-one white-background failure, one automatic retry, then success;
- moderation/non-white-unrelated failure with no automatic retry;
- two white-background failures blocking every later item;
- a later item failing without affecting siblings;
- manual later-image retry reusing the original plan and main token;
- saved session restoring settings, analysis, and opaque running tasks but no `File` or candidate-history data.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npx vitest run features/clothing-studio/lib/client-api.test.ts features/clothing-studio/lib/generation-runner.test.ts features/clothing-studio/lib/session-store.test.ts features/clothing-studio/lib/downloads.test.ts features/clothing-studio/state.test.ts
```

Expected: FAIL because the clothing client layer does not exist.

- [ ] **Step 4: Implement client API and shared polling semantics**

Use the private clothing header on every POST. Append a reference with this exact branch:

```ts
function appendReference(form: FormData, prefix: "model" | "scene", asset: ReferenceAsset) {
  if (asset.source === "upload" && asset.file) {
    form.append(`${prefix}Image`, asset.file);
    return;
  }
  if (asset.source === "generated" && asset.downloadToken) {
    form.append(`${prefix}Token`, asset.downloadToken);
    return;
  }
  throw new Error(prefix === "model" ? "模特图来源无效" : "场景图来源无效");
}
```

Poll with 2s exponential backoff capped at 8s and a 20-minute timeout. Treat non-retryable 4xx status errors as failed; keep network/5xx and elapsed jobs as `timed_out` with a continue-query action.

- [ ] **Step 5: Implement the two-stage batch**

Run image one first. Retry once only when `task.status === "failed"` and `task.error` contains `白底服装主图` or `白底商品主图`. On success, send its `downloadToken` to every remaining item and run three workers. When no token exists, publish this deterministic task for every dependent item without calling the API:

```ts
{
  planItemId: item.id,
  status: "failed",
  progress: 0,
  error: "请先生成或重试白底服装平铺主图",
}
```

For a batch containing no image one, require the caller-provided `baseImageToken` and run the supplied later items directly; this is the single-image retry path.

- [ ] **Step 6: Implement reducer, session, and downloads**

Invalidate analysis/tasks whenever garments, selected model, selected scene, requirements, or generation settings change. Store only JSON-safe settings, analysis, and tasks. On refresh, restore the final workspace and continue polling running/timed-out task IDs; mark the restored run as `recovered` so retry buttons explain that original files must be reselected.

Use `/api/clothing/download` for single and ZIP downloads and filenames `clothing-01.png` through `clothing-16.png`; name the archive `clothing-results.zip`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- features/clothing-studio/lib/client-api.ts features/clothing-studio/lib/client-api.test.ts features/clothing-studio/lib/generation-runner.ts features/clothing-studio/lib/generation-runner.test.ts features/clothing-studio/lib/session-store.ts features/clothing-studio/lib/session-store.test.ts features/clothing-studio/lib/downloads.ts features/clothing-studio/lib/downloads.test.ts features/clothing-studio/state.ts features/clothing-studio/state.test.ts
git commit -m "feat: orchestrate clothing image tasks"
```

---

### Task 7: Build garment, model, scene, and settings controls

**Files:**
- Create: `features/clothing-studio/components/garment-uploader.tsx`
- Create: `features/clothing-studio/components/garment-uploader.test.tsx`
- Create: `features/clothing-studio/components/reference-card.tsx`
- Create: `features/clothing-studio/components/reference-card.test.tsx`
- Create: `features/clothing-studio/components/reference-picker-dialog.tsx`
- Create: `features/clothing-studio/components/reference-picker-dialog.test.tsx`
- Create: `features/clothing-studio/components/clothing-settings.tsx`
- Create: `features/clothing-studio/components/clothing-settings.test.tsx`
- Create: `features/clothing-studio/lib/image-files.ts`
- Create: `features/clothing-studio/lib/image-files.test.ts`

**Interfaces:**
- `GarmentUploader` preprocesses and returns 1–6 normalized garment files.
- `ReferenceCard` displays selected model/scene and emits upload/generate/reselect/delete actions.
- `ReferencePickerDialog` is configured by `kind: "model" | "scene"` and returns one selected `ReferenceAsset`.
- `ClothingSettingsForm` edits platform/language/ratio/quality/watermark/count without dimensions.

- [ ] **Step 1: Write failing component tests**

Cover upload validation and these dialog behaviors:

```tsx
render(<ReferencePickerDialog kind="model" open candidates={[]} onClose={onClose} onUse={onUse} api={api} />);
expect(screen.getByLabelText("性别")).toBeVisible();
expect(screen.getByLabelText("年龄段")).toBeVisible();
expect(screen.getByLabelText("肤色或地域外观")).toBeVisible();
expect(screen.getByLabelText("体型")).toBeVisible();
expect(screen.getByLabelText("发型")).toBeVisible();
expect(screen.getByRole("button", { name: "使用选中的模特" })).toBeDisabled();
```

For scene mode, require style, venue, lighting, season, additional requirements, count 1–4, and final aspect ratio. Require uploaded candidates and generated candidates to coexist in the right-hand history, selection to enable the footer button, Escape/close to preserve the prior selected asset, and generated-task failures to remain individually retryable.

Require platform changes to fix language (`amazon → en`, `ozon → ru`) and count options exactly 1–16.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run features/clothing-studio/components/garment-uploader.test.tsx features/clothing-studio/components/reference-card.test.tsx features/clothing-studio/components/reference-picker-dialog.test.tsx features/clothing-studio/components/clothing-settings.test.tsx features/clothing-studio/lib/image-files.test.ts
```

Expected: FAIL because the clothing controls do not exist.

- [ ] **Step 3: Implement normalized image preprocessing**

Wrap the existing proven preprocessing rules without changing product-studio files: JPG/PNG/WEBP only, original maximum 15 MB, orientation correction, longest edge 2048 px, WEBP quality 0.9, normalized maximum 5 MB. Export `preprocessClothingImage(file)` and `validateGarmentFiles(files)` with garment-specific messages.

- [ ] **Step 4: Implement the controlled settings and reference cards**

Render selects for all existing platform/language/ratio values plus quality values `auto`, `low`, `medium`, `high`. Use `fixedPlatformLanguage` and `settingsPatchForPlatform` from the existing platform rules so clothing and product language behavior cannot diverge. The reference card must expose explicit buttons instead of making the whole card an ambiguous click target.

- [ ] **Step 5: Implement the reusable two-column dialog**

Use a native open `<dialog>` with `aria-modal="true"`. Render role-specific filter fields on the left and tabs `上传` / `AI 生成` on the right. Candidate buttons use `aria-pressed`; the footer action remains disabled until one candidate is selected.

For uploaded files, preprocess immediately and create/revoke object URLs. For AI generation, call `submitCandidates`, poll every returned task through `runCandidateBatch`, and convert successes to:

```ts
{
  id: task.planItemId,
  kind,
  source: "generated",
  previewUrl: task.resultUrl!,
  downloadToken: task.downloadToken!,
}
```

Desktop dialog width is constrained to the viewport and uses two columns; below `768px`, use one column with a scrollable body and sticky footer.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- features/clothing-studio/components/garment-uploader.tsx features/clothing-studio/components/garment-uploader.test.tsx features/clothing-studio/components/reference-card.tsx features/clothing-studio/components/reference-card.test.tsx features/clothing-studio/components/reference-picker-dialog.tsx features/clothing-studio/components/reference-picker-dialog.test.tsx features/clothing-studio/components/clothing-settings.tsx features/clothing-studio/components/clothing-settings.test.tsx features/clothing-studio/lib/image-files.ts features/clothing-studio/lib/image-files.test.ts
git commit -m "feat: build clothing input controls"
```

---

### Task 8: Assemble planning, results, page state, and navigation

**Files:**
- Create: `features/clothing-studio/components/clothing-analysis-panel.tsx`
- Create: `features/clothing-studio/components/clothing-plan-editor.tsx`
- Create: `features/clothing-studio/components/clothing-plan-editor.test.tsx`
- Create: `features/clothing-studio/components/clothing-result-grid.tsx`
- Create: `features/clothing-studio/components/clothing-result-grid.test.tsx`
- Create: `features/clothing-studio/components/clothing-studio.tsx`
- Create: `features/clothing-studio/components/clothing-studio.test.tsx`
- Create: `app/clothing-studio/page.tsx`
- Modify: `components/app-shell.tsx`
- Modify: `components/app-shell.test.tsx`

**Interfaces:**
- `ClothingPlanEditor` edits all planning text but locks image-one type and fixed invariants.
- `ClothingResultGrid` exposes preview, single download, ZIP download, retry, and continue-query actions.
- `ClothingStudio` owns candidate dialogs and coordinates the Task 6 reducer/API.
- `/clothing-studio` renders `<AppShell active="clothing-studio">`.

- [ ] **Step 1: Write failing planning and result tests**

Require image-one type control to be disabled, later item fields to be editable, invalid Chinese/fixed-white rules to disable confirmation, and failed/timed-out tasks to expose the correct action.

```tsx
expect(screen.getByLabelText("第 1 张类型")).toBeDisabled();
await user.clear(screen.getByLabelText("第 2 张中文生图提示词"));
expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeDisabled();
```

- [ ] **Step 2: Write failing full-page and navigation tests**

Require the initial form, model validation, optional scene, dialog opening, analysis invalidation, two-stage task order, retry, session recovery, and active navigation:

```tsx
await user.click(screen.getByRole("button", { name: "开始分析服装" }));
expect(screen.getByRole("alert")).toHaveTextContent("请选择模特图");

render(<AppShell active="clothing-studio"><div>服装工作区</div></AppShell>);
expect(screen.getByRole("link", { name: "服装组图" })).toHaveAttribute("aria-current", "page");
expect(screen.getByRole("link", { name: "全品类商品图" })).not.toHaveAttribute("aria-current");
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npx vitest run features/clothing-studio/components/clothing-plan-editor.test.tsx features/clothing-studio/components/clothing-result-grid.test.tsx features/clothing-studio/components/clothing-studio.test.tsx components/app-shell.test.tsx
```

Expected: FAIL because the workspace and navigation entry do not exist.

- [ ] **Step 4: Implement planning and result presentation**

Use the current product-studio visual tokens and spacing, but keep clothing types and copy independent. The result card image uses `object-contain`, reports that generation may take several minutes, and restores focus after closing the large-image dialog. A recovered session disables retry with `重新上传服装和模特后可重试`, while continue-query and download remain available.

- [ ] **Step 5: Implement the page controller**

Use reducer plus epoch refs to ignore stale analysis/generation results. Before analysis require garments and a selected model; pass scene only when selected. On final confirmation:

```ts
await runClothingGenerationBatch({
  items: state.analysis.plan,
  garments: state.garments,
  model: state.model!,
  scene: state.scene ?? undefined,
  settings: state.settings,
  api,
  onTaskChange: (task) => dispatch({ type: "task_changed", task }),
});
```

When retrying image one, include only image one plus tasks blocked by `请先生成或重试白底服装平铺主图`; when retrying a later image, require the current successful image-one download token and call the single-item path. Persist active final tasks after every change and resume opaque job polling once after mount.

- [ ] **Step 6: Implement route and app-shell link**

Create the server page:

```tsx
import { AppShell } from "@/components/app-shell";
import { ClothingStudio } from "@/features/clothing-studio/components/clothing-studio";

export default function ClothingStudioPage() {
  return <AppShell active="clothing-studio"><ClothingStudio /></AppShell>;
}
```

Replace the disabled clothing `<span>` with a Next `<Link href="/clothing-studio">`, using the same active/inactive classes and `aria-current` logic as the product link.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all tests PASS.

- [ ] **Step 8: Run product regression tests**

Run:

```powershell
npx vitest run components/app-shell.test.tsx features/product-studio app/api/product lib --exclude '.worktrees/**'
```

Expected: all existing product tests PASS; the clothing link is the only product-shell behavior change.

- [ ] **Step 9: Commit**

```powershell
git add -- features/clothing-studio/components/clothing-analysis-panel.tsx features/clothing-studio/components/clothing-plan-editor.tsx features/clothing-studio/components/clothing-plan-editor.test.tsx features/clothing-studio/components/clothing-result-grid.tsx features/clothing-studio/components/clothing-result-grid.test.tsx features/clothing-studio/components/clothing-studio.tsx features/clothing-studio/components/clothing-studio.test.tsx app/clothing-studio/page.tsx components/app-shell.tsx components/app-shell.test.tsx
git commit -m "feat: add clothing studio workspace"
```

---

### Task 9: Complete the mocked browser workflow and documentation

**Files:**
- Create: `tests/e2e/clothing-studio.spec.ts`
- Modify: `README.md`

**Interfaces:**
- E2E intercepts every `/api/clothing/*` call and performs no real Grsai request.
- README documents both local module URLs and the minimal real clothing smoke test.

- [ ] **Step 1: Write the failing E2E workflow**

Mock one immediately successful model candidate, two-item clothing analysis, two opaque final jobs, same-origin previews, and downloads. Assert this sequence:

```text
open clothing studio
upload one garment
open model dialog
generate and select one model candidate
leave scene empty
select Ozon, Russian, 3:4, two final images, and a watermark
analyze and edit the second Chinese prompt
confirm generation
observe image one submission and success before image two submission
observe two successful result cards
download a single result and enable ZIP download
```

Inspect multipart bodies so image one contains neither model nor base token, while image two contains `modelToken` and image-one `baseImageToken`. Verify no request is made to `/api/product/*` during this workflow.

- [ ] **Step 2: Run E2E and verify RED**

Run:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'; npx playwright test tests/e2e/clothing-studio.spec.ts
```

Expected: FAIL until the complete page behavior and mocks agree.

- [ ] **Step 3: Finalize the mocked fixture and README**

Use an in-memory 1×1 PNG for every preview/download interception. Document:

- `/product-studio` for all-category products;
- `/clothing-studio` for garments;
- mandatory garment and model inputs, optional scene, 1–16 final count;
- fixed white flat-lay image one and dependent later images;
- candidate/session limitations;
- a real smoke test limited to one model candidate and two final images.

- [ ] **Step 4: Run focused E2E and verify GREEN**

Run the Step 2 command. Expected: the clothing workflow PASSes with zero external requests.

- [ ] **Step 5: Run the complete verification matrix**

Run:

```powershell
npx vitest run --exclude '.worktrees/**'
npx eslint app/api/clothing app/clothing-studio features/clothing-studio lib/grsai/clothing-analysis.ts lib/grsai/clothing-images.ts lib/grsai/clothing-candidates.ts lib/clothing-upload.ts lib/clothing-reference.ts lib/clothing-candidate-jobs.ts lib/clothing-render-config.ts components/app-shell.tsx tests/e2e/clothing-studio.spec.ts
npx tsc --noEmit --incremental false
npm run build
$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e
$matches = rg -n "Bearer sk-|sk-[A-Za-z0-9]{20,}|GRSAI_API_KEY|DOWNLOAD_TOKEN_SECRET" .next/static
if ($LASTEXITCODE -eq 1) { Write-Output "No client-side secret markers found."; $global:LASTEXITCODE = 0 }
git diff --check
git status --short
```

Expected: all project tests PASS; targeted lint, TypeScript, build, and both mocked E2E files exit 0; static assets contain no secret markers; whitespace check is clean; pre-existing user-owned changes remain unaltered and unstaged.

- [ ] **Step 6: Perform the minimal real smoke test only with user approval**

After the user explicitly authorizes spending Grsai credits, generate exactly one model candidate and two final images from one garment. Confirm image one is a pure-white flat lay, image two uses the selected model and the image-one reference, both previews/downloads work, and no third image is generated.

- [ ] **Step 7: Commit**

```powershell
git add -- tests/e2e/clothing-studio.spec.ts README.md
git commit -m "test: verify clothing studio workflow"
```
