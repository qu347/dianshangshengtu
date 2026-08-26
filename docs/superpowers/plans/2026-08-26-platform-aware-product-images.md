# Platform-Aware Product Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flexible product dimensions, deterministic first/second image plans, platform-specific language and units, native 1090×1443 output, Ozon, and secure server-rendered text watermarks.

**Architecture:** Keep Grsai responsible for product understanding and base-image generation, then apply deterministic business rules after analysis and deterministic overlays after generation. Carry render options through signed asynchronous job and download tokens so previews and downloads use identical pixels without a database.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest, Testing Library, Playwright, Sharp, HMAC-SHA256 tokens.

**Spec:** `docs/superpowers/specs/2026-08-26-platform-aware-product-images-design.md`

## Global Constraints

- Before Task 1, use `superpowers:using-git-worktrees` and create an isolated `codex/` feature branch; do not edit the user-owned untracked `AGENTS.md` or `CLAUDE.md`.
- Do not call the real Grsai API during automated or manual verification.
- Editor-facing titles, objectives, scenes, and generation prompts are Chinese; proprietary product names may remain unchanged.
- Fixed language mapping: Taobao/Tmall and Douyin use `zh-CN`; Amazon and Shopify use `en`; Ozon uses `ru`; only General is manually selectable.
- General `none` means “no marketing copy”; dimension labels still use Chinese and watermark rules still apply.
- Native 3:4 is exactly `1090x1443`; do not crop or stretch it after generation.
- Image 1 is always the white-background main image. When present, image 2 is always the dimension-annotation image.
- Amazon image 1 has no watermark. Amazon images 2–16 and every non-Amazon image use the non-empty watermark.
- Standard dimensions convert deterministically; custom units retain their numeric value and unit text.
- Preview, single download, and ZIP download must use the same rendered bytes.
- Preserve the existing 1–16 image count, retry, polling-resume, temporary-link, and download behavior.

## File Structure

- `features/product-studio/model.ts`: trusted schemas and shared domain types.
- `features/product-studio/lib/platform-rules.ts`: fixed language and watermark decisions.
- `features/product-studio/lib/dimensions.ts`: dimension validation, conversion, and display formatting.
- `features/product-studio/lib/plan-rules.ts`: deterministic first/second plan correction.
- `features/product-studio/components/dimension-editor.tsx`: dynamic dimension rows.
- `lib/image-render-config.ts`: signed render configuration construction and inline URL creation.
- `lib/download-token.ts`: HMAC download and job token encoding/verification.
- `lib/product-image-renderer.ts`: Sharp-based annotation and watermark rendering.
- Existing client, routes, runner, and UI components continue to own their current responsibilities.

---

### Task 1: Extend the trusted domain model and platform rules

**Files:**
- Modify: `features/product-studio/model.ts`
- Modify: `features/product-studio/model.test.ts`
- Modify: `features/product-studio/test-fixtures.ts`
- Create: `features/product-studio/lib/platform-rules.ts`
- Create: `features/product-studio/lib/platform-rules.test.ts`

**Interfaces:**
- Produces: `DimensionItemSchema`, `DimensionItemsSchema`, `DimensionItem`, `DimensionAnnotationSchema`.
- Produces: expanded `GenerationSettings` with `ozon`, `ru`, `1090x1443`, and `watermark`.
- Produces: `fixedPlatformLanguage(platform)`, `settingsPatchForPlatform(platform, currentLanguage)`, and `shouldApplyWatermark(platform, imageIndex, watermark)`.

- [ ] **Step 1: Write failing schema and platform-rule tests**

```ts
import { describe, expect, it } from "vitest";
import { DimensionItemsSchema, GenerationSettingsSchema } from "./model";

const settings = {
  platform: "ozon",
  language: "ru",
  aspectRatio: "1090x1443",
  imageCount: 2,
  quality: "auto",
  watermark: "My Shop",
};

it("accepts Ozon, Russian, native 3:4, and a text watermark", () => {
  expect(GenerationSettingsSchema.parse(settings)).toEqual(settings);
});

it("rejects a fixed platform with the wrong language", () => {
  expect(() => GenerationSettingsSchema.parse({ ...settings, platform: "amazon", language: "zh-CN" })).toThrow();
});

it("requires dimensions for a multi-image request", () => {
  expect(() => DimensionItemsSchema(2).parse([])).toThrow("至少填写 1 个产品尺寸");
  expect(DimensionItemsSchema(1).parse([])).toEqual([]);
});
```

```ts
import { expect, it } from "vitest";
import { settingsPatchForPlatform, shouldApplyWatermark } from "./platform-rules";

it("maps Ozon to Russian and keeps General manual", () => {
  expect(settingsPatchForPlatform("ozon", "zh-CN")).toEqual({ platform: "ozon", language: "ru" });
  expect(settingsPatchForPlatform("general", "en")).toEqual({ platform: "general", language: "en" });
});

it("omits only the Amazon first-image watermark", () => {
  expect(shouldApplyWatermark("amazon", 1, "Brand")).toBe(false);
  expect(shouldApplyWatermark("amazon", 2, "Brand")).toBe(true);
  expect(shouldApplyWatermark("ozon", 1, "Brand")).toBe(true);
  expect(shouldApplyWatermark("taobao", 1, "")).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- features/product-studio/model.test.ts features/product-studio/lib/platform-rules.test.ts
```

Expected: FAIL because the new schemas, values, watermark field, and platform-rule module do not exist.

- [ ] **Step 3: Implement the minimal schemas and rules**

Use these exact domain shapes:

```ts
export const DimensionUnitSchema = z.enum(["mm", "cm", "m", "in", "ml", "l", "custom"]);
export const DimensionItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(24),
  value: z.number().finite().positive(),
  unit: DimensionUnitSchema,
  customUnit: z.string().trim().max(12).optional(),
}).superRefine((item, context) => {
  if (item.unit === "custom" && !item.customUnit) {
    context.addIssue({ code: "custom", path: ["customUnit"], message: "请填写自定义单位" });
  }
});

export const DimensionItemsSchema = (imageCount: number) => z.array(DimensionItemSchema)
  .max(6, "最多填写 6 个产品尺寸")
  .superRefine((items, context) => {
    if (imageCount >= 2 && items.length === 0) {
      context.addIssue({ code: "custom", message: "生成 2 张及以上时至少填写 1 个产品尺寸" });
    }
  });

export const DimensionAnnotationSchema = z.object({
  label: z.string().trim().min(1).max(40),
  displayValue: z.string().trim().min(1).max(40),
});
```

Add `annotations: z.array(DimensionAnnotationSchema).max(6).default([])` to `PlanItemSchema`. Add the new settings values and a `superRefine` that enforces the fixed language mapping. Update every fixture to include `watermark: ""` and every plan fixture to include `annotations: []` or rely on the schema default only at parse boundaries.

Implement platform helpers with 1-based `imageIndex`:

```ts
const fixedLanguages = {
  taobao: "zh-CN",
  douyin: "zh-CN",
  amazon: "en",
  shopify: "en",
  ozon: "ru",
} as const;

export function shouldApplyWatermark(platform: GenerationSettings["platform"], imageIndex: number, watermark: string) {
  return Boolean(watermark.trim()) && !(platform === "amazon" && imageIndex === 1);
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- features/product-studio/model.test.ts features/product-studio/lib/platform-rules.test.ts
```

Expected: both test files PASS.

- [ ] **Step 5: Run all model consumers**

Run:

```powershell
npm test -- features/product-studio app/api/product
```

Expected: PASS after updating test settings/fixtures for `watermark` and plan annotations.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- features/product-studio/model.ts features/product-studio/model.test.ts features/product-studio/test-fixtures.ts features/product-studio/lib/platform-rules.ts features/product-studio/lib/platform-rules.test.ts
git commit -m "feat: add platform-aware product settings"
```

---

### Task 2: Add deterministic dimension conversion

**Files:**
- Create: `features/product-studio/lib/dimensions.ts`
- Create: `features/product-studio/lib/dimensions.test.ts`

**Interfaces:**
- Consumes: `DimensionItem`, `GenerationSettings["language"]` from Task 1.
- Produces: `dimensionLanguage(language): "zh-CN" | "en" | "ru"`.
- Produces: `prepareDimensionFacts(items, language): PreparedDimensionFact[]` where each result is `{ id, sourceLabel, displayValue }`.

- [ ] **Step 1: Write failing conversion tests**

```ts
import { expect, it } from "vitest";
import { prepareDimensionFacts } from "./dimensions";

const height = { id: "height", label: "杯高", value: 12, unit: "cm" as const };
const capacity = { id: "capacity", label: "容量", value: 350, unit: "ml" as const };

it("formats Chinese, English, and Russian standard units", () => {
  expect(prepareDimensionFacts([height], "zh-CN")[0].displayValue).toBe("12 cm");
  expect(prepareDimensionFacts([height], "en")[0].displayValue).toBe("4.72 in");
  expect(prepareDimensionFacts([height], "ru")[0].displayValue).toBe("12 см");
  expect(prepareDimensionFacts([capacity], "en")[0].displayValue).toBe("11.83 fl oz");
  expect(prepareDimensionFacts([{ ...capacity, value: 1500 }], "ru")[0].displayValue).toBe("1.5 л");
});

it("uses Chinese dimension units for no-marketing-copy mode", () => {
  expect(prepareDimensionFacts([height], "none")[0].displayValue).toBe("12 cm");
});

it("preserves a custom unit", () => {
  const result = prepareDimensionFacts([{ id: "size", label: "规格", value: 2, unit: "custom", customUnit: "号" }], "en");
  expect(result[0].displayValue).toBe("2 号");
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- features/product-studio/lib/dimensions.test.ts
```

Expected: FAIL because `dimensions.ts` does not exist.

- [ ] **Step 3: Implement conversion and formatting**

Implement conversions through canonical base units (`cm` for length and `mL` for volume). Use `29.5735 mL` per US fluid ounce. For Chinese/Russian volume, switch to `L`/`л` at `1000 mL`. Format with at most two decimals:

```ts
function compactNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function dimensionLanguage(language: GenerationSettings["language"]) {
  return language === "none" ? "zh-CN" : language;
}

export function prepareDimensionFacts(items: DimensionItem[], language: GenerationSettings["language"]) {
  return items.map((item) => ({
    id: item.id,
    sourceLabel: item.label,
    displayValue: formatDimensionValue(item, dimensionLanguage(language)),
  }));
}
```

Reject non-finite conversion output even though the route schema already rejects it; this keeps the pure function safe when called directly.

- [ ] **Step 4: Run and verify GREEN**

Run:

```powershell
npm test -- features/product-studio/lib/dimensions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- features/product-studio/lib/dimensions.ts features/product-studio/lib/dimensions.test.ts
git commit -m "feat: localize product dimensions"
```

---

### Task 3: Enforce the first and second plan items

**Files:**
- Create: `features/product-studio/lib/plan-rules.ts`
- Create: `features/product-studio/lib/plan-rules.test.ts`

**Interfaces:**
- Consumes: `ProductAnalysis`, `PreparedDimensionFact[]`.
- Produces: `applyPlanRules(analysis, dimensionFacts): ProductAnalysis`.
- Produces: `assertChinesePlanningFields(analysis): ProductAnalysis`.

- [ ] **Step 1: Write failing deterministic-plan tests**

```ts
import { expect, it } from "vitest";
import { analysisWithTwoItems } from "../test-fixtures";
import { applyPlanRules, assertChinesePlanningFields } from "./plan-rules";

it("forces image one to white background and image two to dimensions", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[1].annotations = [
    { label: "Height", displayValue: "wrong" },
    { label: "Capacity", displayValue: "wrong" },
  ];
  const result = applyPlanRules(analysis, [
    { id: "height", sourceLabel: "杯高", displayValue: "4.72 in" },
    { id: "capacity", sourceLabel: "容量", displayValue: "11.83 fl oz" },
  ]);

  expect(result.plan[0]).toMatchObject({ type: "main", copy: "", scene: expect.stringContaining("纯白") });
  expect(result.plan[0].prompt).toContain("纯白背景");
  expect(result.plan[1].annotations).toEqual([
    { label: "Height", displayValue: "4.72 in" },
    { label: "Capacity", displayValue: "11.83 fl oz" },
  ]);
  expect(result.plan[1].prompt).toContain("右侧尺寸标注区");
});

it("rejects non-Chinese editor planning text", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[0].prompt = "Professional product photography";
  expect(() => assertChinesePlanningFields(analysis)).toThrow("规划内容必须使用中文");
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- features/product-studio/lib/plan-rules.test.ts
```

Expected: FAIL because `plan-rules.ts` does not exist.

- [ ] **Step 3: Implement fixed Chinese templates and annotation merge**

Use fixed Chinese values for image 1 and image 2. Keep AI-translated annotation labels, but replace every `displayValue` by index from `dimensionFacts`. Require the AI annotation count to equal the dimension count; throw a parse/repair error otherwise.

`assertChinesePlanningFields` must require at least one Han character in each plan `title`, `objective`, `scene`, and `prompt`; allow Latin SKU names within otherwise Chinese text.

- [ ] **Step 4: Run and verify GREEN**

Run:

```powershell
npm test -- features/product-studio/lib/plan-rules.test.ts features/product-studio/model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- features/product-studio/lib/plan-rules.ts features/product-studio/lib/plan-rules.test.ts
git commit -m "feat: enforce core product image plans"
```

---

### Task 4: Add dimension and platform controls to the workbench

**Files:**
- Create: `features/product-studio/components/dimension-editor.tsx`
- Create: `features/product-studio/components/dimension-editor.test.tsx`
- Modify: `features/product-studio/components/generation-settings.tsx`
- Modify: `features/product-studio/components/generation-settings.test.tsx`
- Modify: `features/product-studio/components/product-studio.tsx`
- Modify: `features/product-studio/components/product-studio.test.tsx`
- Modify: `features/product-studio/state.ts`
- Modify: `features/product-studio/state.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and platform helpers.
- Produces: `DimensionEditor({ value, imageCount, disabled, onChange })`.
- Produces: `ProductStudioState.dimensions: DimensionItem[]` and `dimensions_changed` reducer action.

- [ ] **Step 1: Write failing component and reducer tests**

```tsx
it("adds flexible product dimensions and a custom unit", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<DimensionEditor value={[]} imageCount={2} onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "添加尺寸项" }));
  expect(onChange).toHaveBeenCalledWith([
    expect.objectContaining({ label: "", value: 0, unit: "cm" }),
  ]);
});
```

```tsx
it("maps Ozon to Russian and exposes native 3:4", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<GenerationSettingsForm value={defaultSettings} onChange={onChange} />);
  await user.selectOptions(screen.getByLabelText("平台"), "ozon");
  expect(onChange).toHaveBeenLastCalledWith({ platform: "ozon", language: "ru" });
  expect(screen.getByRole("option", { name: "3:4 竖版（1090×1443）" })).toBeInTheDocument();
});
```

Add a `ProductStudio` test that fills a dimension and watermark, then verifies the analysis API receives both. Add a reducer test proving `dimensions_changed` invalidates an existing analysis.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- features/product-studio/components/dimension-editor.test.tsx features/product-studio/components/generation-settings.test.tsx features/product-studio/components/product-studio.test.tsx features/product-studio/state.test.ts
```

Expected: FAIL because the editor, new options, state, and watermark input do not exist.

- [ ] **Step 3: Implement the dynamic dimension editor**

Render 1–6 rows with accessible labels `尺寸名称 N`, `尺寸数值 N`, and `尺寸单位 N`. Selecting `custom` reveals `自定义单位 N`. Use `crypto.randomUUID()` only when the user adds a row; keep IDs stable during edits. Display row-specific errors before analysis instead of mutating the schema.

- [ ] **Step 4: Implement platform, language, ratio, and watermark controls**

Add Ozon and Russian options. Rename “无文字” to “无营销文案”. Disable the language select for fixed platforms. On platform change call `settingsPatchForPlatform`. Add `1090x1443` and a 40-character watermark input.

- [ ] **Step 5: Wire ProductStudio state and validation**

Place “产品尺寸” between product name and supplementary requirements. Validate dimensions using `DimensionItemsSchema(state.settings.imageCount)` before the analysis request. Include dimensions in invalidation and `inputsDisabled` behavior.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- features/product-studio/components/dimension-editor.test.tsx features/product-studio/components/generation-settings.test.tsx features/product-studio/components/product-studio.test.tsx features/product-studio/state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- features/product-studio/components/dimension-editor.tsx features/product-studio/components/dimension-editor.test.tsx features/product-studio/components/generation-settings.tsx features/product-studio/components/generation-settings.test.tsx features/product-studio/components/product-studio.tsx features/product-studio/components/product-studio.test.tsx features/product-studio/state.ts features/product-studio/state.test.ts
git commit -m "feat: collect dimensions and platform settings"
```

---

### Task 5: Send dimensions through analysis and return Chinese planning text

**Files:**
- Modify: `features/product-studio/lib/client-api.ts`
- Modify: `features/product-studio/lib/generation-runner.test.ts`
- Modify: `app/api/product/analyze/route.ts`
- Modify: `app/api/product/analyze/route.test.ts`
- Modify: `lib/grsai/analysis.ts`
- Modify: `lib/grsai/analysis.test.ts`

**Interfaces:**
- Consumes: `DimensionItem[]`, `prepareDimensionFacts`, `applyPlanRules`, and `assertChinesePlanningFields`.
- Updates: `analyzeProductClient(input)` and `analyzeProduct(input)` to require `dimensions`.

- [ ] **Step 1: Write failing prompt, repair, and route tests**

Add an analysis prompt assertion:

```ts
expect(buildAnalysisPrompt({
  productName: "玻璃杯",
  requirements: "",
  imageCount: 2,
  platform: "amazon",
  language: "en",
  dimensions: [
    { id: "height", sourceLabel: "杯高", displayValue: "4.72 in" },
  ],
})).toContain("所有标题、目标、场景和生图提示词必须使用中文");
```

Assert that image 1 is requested as white background, image 2 requests an English translation for `杯高` without changing `4.72 in`, and the route rejects missing dimensions when `imageCount` is 2.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- lib/grsai/analysis.test.ts app/api/product/analyze/route.test.ts features/product-studio/lib/generation-runner.test.ts
```

Expected: FAIL because dimensions are not sent or parsed and the analysis prompt has no fixed-plan rules.

- [ ] **Step 3: Pass dimensions through the client and route**

Append `dimensions` JSON to the analysis `FormData`. Parse it at the route boundary with `DimensionItemsSchema(settings.imageCount)`. Return a 400 response with `产品尺寸无效` for malformed or missing multi-image dimensions.

- [ ] **Step 4: Extend the analysis prompt and normalization**

Build deterministic dimension facts before calling Grsai. Tell the model:

- all editor planning fields must be Chinese;
- plan 1 and plan 2 follow the fixed rules;
- plan 2 returns exactly one translated annotation label per input fact, in the same order;
- annotation numeric strings must not be modified;
- marketing `copy` follows the platform language and is empty for `none`.

After parsing, call `assertChinesePlanningFields` and `applyPlanRules`. The existing single repair call must receive the same dimension facts and Chinese-field constraints.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- lib/grsai/analysis.test.ts app/api/product/analyze/route.test.ts features/product-studio/lib/generation-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add -- features/product-studio/lib/client-api.ts features/product-studio/lib/generation-runner.test.ts app/api/product/analyze/route.ts app/api/product/analyze/route.test.ts lib/grsai/analysis.ts lib/grsai/analysis.test.ts
git commit -m "feat: plan localized dimension images"
```

---

### Task 6: Build native generation and render configuration

**Files:**
- Modify: `lib/grsai/images.ts`
- Modify: `lib/grsai/images.test.ts`
- Create: `lib/image-render-config.ts`
- Create: `lib/image-render-config.test.ts`

**Interfaces:**
- Produces: `ImageRenderConfig` with `{ imageIndex, annotations, watermark, applyWatermark }`.
- Produces: `createImageRenderConfig(item, settings): ImageRenderConfig`.
- Produces: `inlineResultUrl(requestUrl, token): string`.

- [ ] **Step 1: Write failing generation and render-config tests**

```ts
it("passes native 1090x1443 directly to gpt-image-2", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: "job-1", status: "running", progress: 0, results: [],
  }), { status: 200 }));
  await submitImageGeneration({ images: [], prompt: "中文提示词", aspectRatio: "1090x1443", quality: "auto" }, fetchImpl as never);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ aspectRatio: "1090x1443" });
});
```

```ts
it("creates the Amazon first-image watermark exception", () => {
  expect(createImageRenderConfig({ ...onePlanItem, id: "1" }, { ...defaultSettings, platform: "amazon", language: "en", watermark: "Brand" })).toMatchObject({
    imageIndex: 1,
    watermark: "Brand",
    applyWatermark: false,
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- lib/grsai/images.test.ts lib/image-render-config.test.ts
```

Expected: FAIL because the new ratio and render config are missing.

- [ ] **Step 3: Keep generation prompts Chinese and pass 1090x1443 unchanged**

Update `buildGenerationPrompt` so every instruction line is Chinese and it explicitly tells Grsai not to add dimension text for image 2 because the server will overlay it. Do not map `1090x1443` to another size.

- [ ] **Step 4: Implement render configuration**

Parse the normalized numeric `PlanItem.id` as the 1-based image index. Copy only validated annotations and the trimmed watermark. Set `applyWatermark` through Task 1’s platform rule. `inlineResultUrl` must construct an absolute same-origin `/api/product/download?token=...&inline=1` URL with `new URL()`.

- [ ] **Step 5: Run and verify GREEN**

Run:

```powershell
npm test -- lib/grsai/images.test.ts lib/image-render-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- lib/grsai/images.ts lib/grsai/images.test.ts lib/image-render-config.ts lib/image-render-config.test.ts
git commit -m "feat: configure native platform image rendering"
```

---

### Task 7: Sign asynchronous job and rendered-image tokens

**Files:**
- Modify: `lib/download-token.ts`
- Modify: `lib/download-token.test.ts`

**Interfaces:**
- Consumes: `ImageRenderConfig` from Task 6.
- Produces: `signDownloadUrl(url, render, secret, nowSeconds?, ttlSeconds?)`.
- Produces: `verifyDownloadToken(token, secret, nowSeconds?): { url, render }`.
- Produces: `signJobToken(providerJobId, render, secret, nowSeconds?, ttlSeconds?)`.
- Produces: `verifyJobToken(token, secret, nowSeconds?): { providerJobId, render }`.

- [ ] **Step 1: Write failing signed-context tests**

```ts
const render = { imageIndex: 2, annotations: [{ label: "Height", displayValue: "4.72 in" }], watermark: "Brand", applyWatermark: true };

it("round-trips signed download and job render context", () => {
  const download = signDownloadUrl("https://cdn.example/image.png", render, "secret", 100, 60);
  expect(verifyDownloadToken(download, "secret", 120)).toEqual({ url: "https://cdn.example/image.png", render });
  const job = signJobToken("provider-job", render, "secret", 100, 60);
  expect(verifyJobToken(job, "secret", 120)).toEqual({ providerJobId: "provider-job", render });
});

it("rejects a render-context mutation", () => {
  const token = signJobToken("provider-job", render, "secret", 100, 60);
  const [payload, signature] = token.split(".");
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), render: { ...render, applyWatermark: false } })).toString("base64url");
  expect(() => verifyJobToken(`${changed}.${signature}`, "secret", 120)).toThrow("任务令牌无效");
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- lib/download-token.test.ts
```

Expected: FAIL because signed render/job context is unsupported.

- [ ] **Step 3: Implement typed payloads with shared canonical HMAC logic**

Use discriminated payloads `{ kind: "download", url, render, exp }` and `{ kind: "job", providerJobId, render, exp }`. Validate every nested render field, maximum annotation count, string length, finite image index, HTTPS source URL, canonical base64url, signature length, signature equality, and expiration before returning typed values. Use the same generic “令牌无效” message for malformed payloads.

- [ ] **Step 4: Run and verify GREEN**

Run:

```powershell
npm test -- lib/download-token.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```powershell
git add -- lib/download-token.ts lib/download-token.test.ts
git commit -m "feat: sign product image render context"
```

---

### Task 8: Render annotations and watermarks through the download proxy

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/product-image-renderer.ts`
- Create: `lib/product-image-renderer.test.ts`
- Modify: `app/api/product/download/route.ts`
- Modify: `app/api/product/download/route.test.ts`

**Interfaces:**
- Consumes: verified `{ url, render }` from Task 7.
- Produces: `renderProductImage(input: Buffer, config: ImageRenderConfig): Promise<Buffer>`.
- Produces: `readImageResponse(response, maxBytes): Promise<Buffer>`.

- [ ] **Step 1: Install Sharp as a direct runtime dependency**

Run:

```powershell
npm install sharp
```

Expected: `sharp` is added to `dependencies`; only `package.json` and `package-lock.json` change.

- [ ] **Step 2: Write failing renderer tests**

Create a 1090×1443 solid fixture in memory with Sharp. Assert output metadata stays 1090×1443 and PNG. Assert output bytes differ when either one annotation or a watermark is applied. Add an XML-escaping test using `</text><script>` and verify rendering succeeds without injecting an extra SVG node.

```ts
const input = await sharp({ create: { width: 864, height: 1152, channels: 3, background: "#eeeeee" } }).png().toBuffer();
const output = await renderProductImage(input, {
  imageIndex: 2,
  annotations: [{ label: "Height", displayValue: "4.72 in" }],
  watermark: "Brand",
  applyWatermark: true,
});
expect(await sharp(output).metadata()).toMatchObject({ width: 864, height: 1152, format: "png" });
expect(output.equals(input)).toBe(false);
```

- [ ] **Step 3: Run renderer tests and verify RED**

Run:

```powershell
npm test -- lib/product-image-renderer.test.ts
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 4: Implement Sharp composition**

Call `sharp(input).rotate()` and read metadata. For image 2, draw a right-side annotation area that uses approximately 35% of the canvas, lays out 1–6 labels vertically, and draws leader lines toward the left product region. Draw the watermark at bottom-right with an SVG-safe escaped string, proportional font size, translucent fill, outline/shadow, and edge padding. Return PNG bytes. If neither annotations nor watermark apply, still normalize to PNG so preview and download content types remain stable.

- [ ] **Step 5: Update the download route and tests**

The route must:

- verify the signed download token;
- fetch HTTPS with `redirect: "error"` and a 30-second signal;
- require a supported `image/*` response;
- read at most 25 MiB, aborting on overflow;
- call `renderProductImage`;
- return `Content-Type: image/png`;
- return `inline` disposition only when `inline=1`, otherwise attachment;
- use `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

Test tampered tokens, redirect responses, oversized streams, non-images, renderer failure, inline disposition, and attachment disposition.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- lib/product-image-renderer.test.ts app/api/product/download/route.test.ts lib/download-token.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```powershell
git add -- package.json package-lock.json lib/product-image-renderer.ts lib/product-image-renderer.test.ts app/api/product/download/route.ts app/api/product/download/route.test.ts
git commit -m "feat: render product annotations and watermarks"
```

---

### Task 9: Carry render configuration through submission and polling

**Files:**
- Modify: `app/api/product/generate/route.ts`
- Modify: `app/api/product/generate/route.test.ts`
- Modify: `app/api/product/jobs/[id]/route.ts`
- Modify: `app/api/product/jobs/[id]/route.test.ts`
- Modify: `features/product-studio/lib/client-api.ts`
- Modify: `features/product-studio/lib/generation-runner.ts`
- Modify: `features/product-studio/lib/generation-runner.test.ts`
- Modify: `features/product-studio/components/result-card.tsx`
- Modify: `features/product-studio/components/result-card.test.tsx`

**Interfaces:**
- Consumes: Task 6 render config, Task 7 job/download tokens, Task 8 inline render route.
- Preserves: `GenerationTask.providerJobId` as an opaque string; clients must never parse it.

- [ ] **Step 1: Write failing immediate and asynchronous API tests**

For immediate success, assert `resultUrl` uses the same-origin download route with `inline=1`, and verify `downloadToken` contains the expected render config. For a running provider job, assert `providerJobId` is a signed job token rather than the raw Grsai ID. For polling, pass that token and assert the route queries the raw provider ID internally and returns a signed rendered result.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```powershell
npm test -- app/api/product/generate/route.test.ts app/api/product/jobs/[id]/route.test.ts
```

Expected: FAIL because routes still expose raw provider URLs and IDs.

- [ ] **Step 3: Implement submission token flow**

After parsing `settings` and `item`, call `createImageRenderConfig`. On provider success, sign a download token and return `inlineResultUrl(request.url, token)`. On pending status, return `signJobToken(job.id, render, secret)` as `providerJobId`. Never send the raw job ID to the client.

- [ ] **Step 4: Implement polling token flow**

Verify the path `id` as a job token, query Grsai with the contained raw provider ID, and preserve the same opaque token while pending/failed/timed out. On success, sign a download token from the returned source URL and the render config, then return the inline result URL.

- [ ] **Step 5: Preserve the client runner and retry behavior**

Treat `providerJobId` as opaque in the client. Keep the existing global generation lock and per-card retry state. Update result-card copy to identify image 1 as “白底商品主图” and image 2 as “尺寸标注图” only when those titles are present; do not add a new client status machine.

- [ ] **Step 6: Run API and runner tests and verify GREEN**

Run:

```powershell
npm test -- app/api/product/generate/route.test.ts app/api/product/jobs/[id]/route.test.ts features/product-studio/lib/generation-runner.test.ts features/product-studio/components/result-card.test.tsx
```

Expected: PASS, including retry and timeout-resume tests.

- [ ] **Step 7: Commit Task 9**

```powershell
git add -- app/api/product/generate/route.ts app/api/product/generate/route.test.ts 'app/api/product/jobs/[id]/route.ts' 'app/api/product/jobs/[id]/route.test.ts' features/product-studio/lib/client-api.ts features/product-studio/lib/generation-runner.ts features/product-studio/lib/generation-runner.test.ts features/product-studio/components/result-card.tsx features/product-studio/components/result-card.test.tsx
git commit -m "feat: preserve rendered images through polling"
```

---

### Task 10: Complete the editable plan UI and workflow verification

**Files:**
- Modify: `features/product-studio/components/plan-editor.tsx`
- Modify: `features/product-studio/components/plan-editor.test.tsx`
- Modify: `features/product-studio/components/analysis-panel.tsx`
- Modify: `features/product-studio/components/product-studio.test.tsx`
- Modify: `tests/e2e/product-studio.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: localized annotations and rendered-result URLs from earlier tasks.
- Produces: final user-facing labels and regression coverage.

- [ ] **Step 1: Write failing plan-editor and workflow tests**

Assert the plan editor shows `中文生图提示词`, displays image 2 annotations read-only, and keeps title/objective/scene/copy/prompt editable. Extend the mocked E2E flow to:

1. choose Ozon;
2. verify Russian is selected and disabled;
3. add `杯高 12 cm`;
4. choose `3:4 竖版（1090×1443）`;
5. enter a watermark;
6. analyze two images;
7. verify image 1 is the white-background plan and image 2 is the dimensions plan;
8. complete mocked polling and verify rendered result links.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- features/product-studio/components/plan-editor.test.tsx features/product-studio/components/product-studio.test.tsx
$env:PLAYWRIGHT_CHANNEL='chromium'; npm run test:e2e
```

Expected: FAIL because the final labels/annotations and E2E controls are not present.

- [ ] **Step 3: Implement final plan and analysis presentation**

Rename the prompt field label to `第 N 张中文生图提示词`. Under image 2, render a compact read-only `尺寸标注` list containing each localized label and display value. Keep existing edit callbacks unchanged for editable fields.

- [ ] **Step 4: Update README**

Document Ozon, platform language mapping, flexible dimensions, native 1090×1443, fixed image order, and text-watermark exceptions. Keep `.env.local` examples secret-free.

- [ ] **Step 5: Run the full verification matrix**

Run:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
$env:PLAYWRIGHT_CHANNEL='chromium'; npm run test:e2e
```

Expected:

- all Vitest files PASS;
- ESLint exits 0;
- TypeScript exits 0;
- Next.js production build succeeds;
- Playwright mocked workflow passes without a Grsai network call.

- [ ] **Step 6: Run security and responsive checks**

Run:

```powershell
$matches = rg -n "Bearer sk-|sk-[A-Za-z0-9]{20,}|GRSAI_API_KEY|DOWNLOAD_TOKEN_SECRET" .next/static
if ($LASTEXITCODE -eq 1) { Write-Output "No client-side secret markers found."; $global:LASTEXITCODE = 0 }
```

Use Playwright at 1440×900 and 768×900. Assert `document.documentElement.scrollWidth <= clientWidth + 1`; verify the dynamic dimension rows do not widen the 360px desktop configuration panel and stack cleanly on the narrow viewport.

- [ ] **Step 7: Commit Task 10**

```powershell
git add -- features/product-studio/components/plan-editor.tsx features/product-studio/components/plan-editor.test.tsx features/product-studio/components/analysis-panel.tsx features/product-studio/components/product-studio.test.tsx tests/e2e/product-studio.spec.ts README.md
git commit -m "test: verify platform-aware product workflow"
```

- [ ] **Step 8: Review the completed branch before integration**

Use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review` where permitted by the active collaboration rules, and finally `superpowers:finishing-a-development-branch`. Do not merge, push, or delete the worktree without the user’s explicit integration choice.
