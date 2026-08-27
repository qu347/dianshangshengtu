# Smart Dimension Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image one a reliable pure-white product main image and make image two a pure-white 3/4 product view with AI-selected, program-rendered black dimension annotations.

**Architecture:** Image one remains the canonical generated product reference. Image two waits for image one, sends its signed source back to the server, generates a clean 3/4 base image, asks a vision model only for normalized product bounds and annotation directions, and signs that trusted layout into the existing render token. Sharp performs white-background normalization and deterministic annotation rendering so preview and download stay identical.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Sharp, Vitest, Testing Library, Playwright, Grsai GPT Image 2 and chat completions.

**Spec:** `docs/superpowers/specs/2026-08-27-smart-dimension-image-design.md`

## Global Constraints

- Image one must remain a complete centered product on a pure-white canvas with no marketing or dimension copy.
- Image two must be a complete centered 3/4 product view on a pure-white canvas with no AI-rendered text, numbers, units, lines, or side panel.
- AI may choose only product bounds, axis, and side; every displayed value must remain program-owned user input.
- Supported placement axes are exactly `horizontal`, `vertical`, and `callout`; supported sides are exactly `top`, `right`, `bottom`, and `left`.
- Normalized coordinates are integers from `0` through `1000`; invalid or incomplete AI layouts fall back deterministically.
- Only border-connected bright neutral pixels may be normalized to `RGB(255,255,255)`.
- Image one and image two must use the same normalization and render path for preview, single download, and ZIP download.
- Existing language, unit conversion, watermark, upload, SSRF, MIME, byte, pixel, polling, and token rules remain in force.
- Do not make a real Grsai request in automated tests.
- Preserve the user-owned untracked `AGENTS.md` and `CLAUDE.md` files.

---

### Task 1: Preserve dimension identity and define trusted layout types

**Files:**
- Create: `lib/dimension-layout.ts`
- Create: `lib/dimension-layout.test.ts`
- Modify: `features/product-studio/model.ts`
- Modify: `features/product-studio/lib/dimensions.ts`
- Modify: `features/product-studio/lib/dimensions.test.ts`
- Modify: `features/product-studio/test-fixtures.ts`
- Modify: `lib/image-render-config.ts`
- Modify: `lib/image-render-config.test.ts`
- Modify: `lib/download-token.ts`
- Modify: `lib/download-token.test.ts`

**Interfaces:**
- Produces: `DimensionAnnotation = { id: string; label: string; displayValue: string }`.
- Produces: `SmartDimensionLayout = { bounds: ProductBounds; placements: DimensionPlacement[] }`.
- Produces: `fallbackDimensionLayout(annotations: DimensionAnnotation[]): SmartDimensionLayout`.
- Produces: `bindDimensionLayout(candidate: unknown, annotations: DimensionAnnotation[]): SmartDimensionLayout` which throws unless IDs match exactly in count and order.
- Produces: optional `dimensionLayout?: SmartDimensionLayout` on `ImageRenderConfig`.

- [ ] **Step 1: Write failing identity and layout tests**

Add tests that require the trusted dimension ID to survive binding and require malformed AI layouts to be rejected:

```ts
expect(bindDimensionAnnotations(
  [{ id: "height", label: "Высота" }],
  [{ id: "height", sourceLabel: "高", displayValue: "5 см" }],
)).toEqual([{ id: "height", label: "Высота", displayValue: "5 см" }]);

expect(bindDimensionLayout({
  bounds: { left: 180, top: 220, right: 820, bottom: 820 },
  placements: [{ id: "height", axis: "vertical", side: "right" }],
}, [{ id: "height", label: "高度", displayValue: "5 cm" }])).toMatchObject({
  placements: [{ id: "height", axis: "vertical", side: "right" }],
});

expect(() => bindDimensionLayout({
  bounds: { left: 180, top: 220, right: 820, bottom: 820 },
  placements: [{ id: "wrong", axis: "vertical", side: "right" }],
}, annotations)).toThrow("尺寸布局 ID");
```

Add token tests that accept a valid layout and reject a layout with out-of-range bounds or an unknown axis.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run features/product-studio/lib/dimensions.test.ts lib/dimension-layout.test.ts lib/image-render-config.test.ts lib/download-token.test.ts
```

Expected: FAIL because annotation IDs, layout schemas, fallback layout, and token support do not exist.

- [ ] **Step 3: Implement strict shared types**

In `model.ts`, require `id` on `DimensionAnnotationSchema`. In `dimensions.ts`, return the trusted fact ID:

```ts
return { id: fact.id, label: translated.label, displayValue: fact.displayValue };
```

In `lib/dimension-layout.ts`, define strict Zod schemas and deterministic fallback:

```ts
export const ProductBoundsSchema = z.object({
  left: z.number().int().min(0).max(1000),
  top: z.number().int().min(0).max(1000),
  right: z.number().int().min(0).max(1000),
  bottom: z.number().int().min(0).max(1000),
}).strict().superRefine((bounds, context) => {
  if (bounds.right - bounds.left < 80 || bounds.bottom - bounds.top < 80) {
    context.addIssue({ code: "custom", message: "商品边界无效" });
  }
});

export const DimensionPlacementSchema = z.object({
  id: z.string().min(1).max(64),
  axis: z.enum(["horizontal", "vertical", "callout"]),
  side: z.enum(["top", "right", "bottom", "left"]),
}).strict();
```

Use fallback bounds `{ left: 220, top: 250, right: 780, bottom: 780 }` and side order `top`, `right`, `bottom`, `left`, then alternating callouts. Validate exact annotation IDs in order before returning an AI layout.

Extend `ImageRenderConfig`, its factory, and token validation so only image two carries `dimensionLayout`; unknown or unbounded nested fields invalidate the token.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all listed tests PASS.

- [ ] **Step 5: Run affected consumer tests**

Run:

```powershell
npx vitest run features/product-studio/lib/plan-rules.test.ts lib/grsai/analysis.test.ts app/api/product/generate/route.test.ts app/api/product/jobs/[id]/route.test.ts lib/product-image-renderer.test.ts
```

Expected: PASS after adding stable IDs to existing fixtures and assertions without changing displayed labels or values.

- [ ] **Step 6: Commit**

```powershell
git add -- features/product-studio/model.ts features/product-studio/lib/dimensions.ts features/product-studio/lib/dimensions.test.ts features/product-studio/test-fixtures.ts lib/dimension-layout.ts lib/dimension-layout.test.ts lib/image-render-config.ts lib/image-render-config.test.ts lib/download-token.ts lib/download-token.test.ts
git commit -m "feat: define trusted dimension layouts"
```

---

### Task 2: Normalize border-connected white backgrounds

**Files:**
- Modify: `lib/product-image-validation.ts`
- Modify: `lib/product-image-validation.test.ts`
- Modify: `lib/product-image-renderer.ts`
- Modify: `lib/product-image-renderer.test.ts`

**Interfaces:**
- Produces: `normalizeWhiteBackground(input: Buffer): Promise<Buffer>` returning an oriented PNG with only safe border-connected near-white pixels changed to exact white.
- Produces: `hasPureWhiteOuterBand(input: Buffer): Promise<boolean>` for the post-normalization invariant.
- Existing `validateGeneratedImage` validates image one through the new normalizer; Task 5 centralizes image-two preparation after its base image exists.

- [ ] **Step 1: Write failing normalization tests**

Create in-memory images and require the following behavior:

```ts
const normalized = await normalizeWhiteBackground(offWhiteWithCenteredGreyProduct);
expect(await hasPureWhiteOuterBand(normalized)).toBe(true);
expect(await samplePixel(normalized, productCenter)).toEqual([160, 160, 160]);
await expect(normalizeWhiteBackground(woodBackground)).rejects.toThrow("白底背景处理失败");
```

Add a renderer test proving image one and image two both normalize an off-white outer background to exact white while preserving dimensions. Add a validator test proving image one now accepts a safely normalizable off-white result.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run lib/product-image-validation.test.ts lib/product-image-renderer.test.ts
```

Expected: FAIL because `normalizeWhiteBackground` does not exist and the current exact-white check rejects safely normalizable off-white input.

- [ ] **Step 3: Implement edge-connected flood fill**

Decode with Sharp after orientation normalization. Treat a pixel as a candidate only when all channels are at least `225` and `max(r,g,b) - min(r,g,b) <= 18`. Seed a four-neighbour flood fill from all canvas-edge candidate pixels. Set only visited pixels to `255,255,255`; keep every unvisited pixel unchanged. Reject when the resulting outer 8% band contains less than 99.5% exact white.

Return PNG bytes. In `renderProductImage`, normalize images one and two before composing annotations or watermarks. Keep images three and later on the existing normalization-only path.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS, including preservation of the grey product center and internal highlight fixtures.

- [ ] **Step 5: Commit**

```powershell
git add -- lib/product-image-validation.ts lib/product-image-validation.test.ts lib/product-image-renderer.ts lib/product-image-renderer.test.ts
git commit -m "fix: normalize generated white backgrounds"
```

---

### Task 3: Replace the side-panel prompt with a clean 3/4 base-image prompt

**Files:**
- Modify: `features/product-studio/lib/plan-rules.ts`
- Modify: `features/product-studio/lib/plan-rules.test.ts`
- Modify: `features/product-studio/test-fixtures.ts`
- Modify: `lib/grsai/analysis.ts`
- Modify: `lib/grsai/analysis.test.ts`
- Modify: `lib/grsai/images.ts`
- Modify: `lib/grsai/images.test.ts`

**Interfaces:**
- Image-one prompt requires an unclipped centered product, edge-to-edge pure-white canvas, no texture/gradient, and no generated text.
- Image-two prompt requires a complete centered 3/4 product view, pure-white canvas, generous margins, and no generated text, values, units, dimension lines, arrows, or side panel.

- [ ] **Step 1: Write failing prompt and plan-rule tests**

Require the trusted second plan to contain `3/4 立体视角`, `纯白背景`, `四周留出标注空间`, and `不生成任何文字、数字、单位、尺寸线、箭头或侧边面板`. Assert it no longer contains `左侧约 65%` or `右侧约 35%`.

Require `buildGenerationPrompt` to add:

```text
第 2 张以第一张参考图中的商品为准，生成完整的 3/4 立体视角商品底图。整张画布保持纯白，不得生成文字或尺寸图形。
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run features/product-studio/lib/plan-rules.test.ts lib/grsai/analysis.test.ts lib/grsai/images.test.ts
```

Expected: FAIL because the current plan and prompt still require the 65/35 side-panel layout.

- [ ] **Step 3: Implement the new fixed templates and validators**

Replace the second fixed template with the approved 3/4 white-base wording. Update `GenerationPlanItemSchema` so image two is valid only when both scene and prompt contain the 3/4, pure-white, no-AI-annotation invariants. Update analysis planning requirements to request labels and stable IDs while explicitly forbidding image-model annotations.

Do not alter plans for image three and later.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- features/product-studio/lib/plan-rules.ts features/product-studio/lib/plan-rules.test.ts features/product-studio/test-fixtures.ts lib/grsai/analysis.ts lib/grsai/analysis.test.ts lib/grsai/images.ts lib/grsai/images.test.ts
git commit -m "fix: generate a clean three-quarter dimension base"
```

---

### Task 4: Add fail-safe AI dimension placement analysis

**Files:**
- Create: `lib/grsai/dimension-layout.ts`
- Create: `lib/grsai/dimension-layout.test.ts`

**Interfaces:**
- Produces: `analyzeDimensionLayout(input: { image: string; annotations: DimensionAnnotation[] }, fetchImpl?: typeof fetch): Promise<SmartDimensionLayout>`.
- Consumes: `bindDimensionLayout` and `fallbackDimensionLayout` from Task 1.
- Returns fallback layout for transport failure, invalid JSON after one repair, invalid bounds, or any ID mismatch.

- [ ] **Step 1: Write failing AI boundary tests**

Mock chat completions and assert:

```ts
expect(await analyzeDimensionLayout({ image: pngDataUrl, annotations }, fetchImpl))
  .toEqual(validBoundLayout);
expect(JSON.stringify(JSON.parse(fetchImpl.mock.calls[0][1].body))).not.toContain("5 cm");
```

Add cases for duplicate IDs, reordered IDs, missing IDs, bounds outside `0..1000`, invalid axis, a first invalid response repaired by the second response, two invalid responses falling back, and a network error falling back. Assert no path performs more than two AI calls.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run lib/grsai/dimension-layout.test.ts
```

Expected: FAIL because the placement analyzer does not exist.

- [ ] **Step 3: Implement the strict two-attempt analyzer**

Use `gemini-3.1-flash-lite` and the existing `/v1/chat/completions` helper. Send the normalized PNG data URL plus only `{ id, label }` facts. Require strict JSON with `bounds` and `placements`; state that coordinates use `0..1000`, the product alone defines the bounds, and values must not be returned.

Parse and bind the first response. On parse/bind failure, send one repair request containing the invalid content and the same image/facts. Catch all second-attempt and transport failures and return `fallbackDimensionLayout(annotations)`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS and call counts are one or two exactly as asserted.

- [ ] **Step 5: Commit**

```powershell
git add -- lib/grsai/dimension-layout.ts lib/grsai/dimension-layout.test.ts
git commit -m "feat: analyze smart dimension placement"
```

---

### Task 5: Prepare generated results and render black annotations around the product

**Files:**
- Create: `lib/product-image-result.ts`
- Create: `lib/product-image-result.test.ts`
- Modify: `lib/product-image-renderer.ts`
- Modify: `lib/product-image-renderer.test.ts`
- Modify: `app/api/product/generate/route.ts`
- Modify: `app/api/product/generate/route.test.ts`
- Modify: `app/api/product/jobs/[id]/route.ts`
- Modify: `app/api/product/jobs/[id]/route.test.ts`

**Interfaces:**
- Produces: `prepareGeneratedImageResult(input: { url: string; render: ImageRenderConfig; fetchImage?: (url: string) => Promise<Buffer>; analyzeLayout?: typeof analyzeDimensionLayout }): Promise<{ ok: true; render: ImageRenderConfig } | { ok: false; error: string }>`.
- Consumes: white normalizer from Task 2 and placement analyzer from Task 4.
- Routes sign only the prepared render config.

- [ ] **Step 1: Write failing result-preparation tests**

Require image one to normalize successfully, image one with non-white background to return `白底商品主图背景处理失败，请重试此图`, image two to call the layout analyzer with a PNG data URL, and image three to skip both fetch and layout analysis.

Add route tests proving immediate and polled image-two success sign a render config containing the prepared layout. Add a renderer fixture with a uniform off-white base and assert:

```ts
expect(await pixel(output, 10, 10)).toEqual([255, 255, 255]);
expect(await pixel(output, width - 10, height / 2)).toEqual([255, 255, 255]);
expect(darkPixelsIn(topBracketRegion)).toBeGreaterThan(50);
expect(darkPixelsIn(rightBracketRegion)).toBeGreaterThan(50);
```

The left and right blank background samples must be identical, proving the 35% overlay is gone.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run lib/product-image-result.test.ts lib/product-image-renderer.test.ts app/api/product/generate/route.test.ts app/api/product/jobs/[id]/route.test.ts
```

Expected: FAIL because result preparation and bracket rendering do not exist and the renderer still paints the right-side panel.

- [ ] **Step 3: Implement centralized result preparation**

For image one and two, fetch through the injected/default safe image fetcher and normalize. For image one, return the unchanged render config after successful normalization. For image two, encode the normalized PNG as `data:image/png;base64,...`, analyze placement, and return `{ ...render, dimensionLayout: layout }`. Return the approved retry messages when normalization fails. Skip fetching images three and later.

Replace duplicated route validation with this helper before signing immediate or polled results.

- [ ] **Step 4: Implement deterministic SVG brackets**

Remove the `rect` side-panel overlay. Convert normalized bounds to output pixels and clamp them to a 10% safe margin. Render:

- horizontal top/bottom: one black main line, two perpendicular end ticks, centered label/value block;
- vertical left/right: one black main line, two perpendicular end ticks, adjacent label/value block;
- callout: a black two-segment polyline from the nearest product edge into the selected margin.

Use black `#111111`, opaque strokes, and fixed outward offsets for multiple annotations on the same side. Keep existing XML escaping and text fitting. Apply watermark after annotations.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS with no panel-color difference and with black pixels in bracket regions.

- [ ] **Step 6: Commit**

```powershell
git add -- lib/product-image-result.ts lib/product-image-result.test.ts lib/product-image-renderer.ts lib/product-image-renderer.test.ts app/api/product/generate/route.ts app/api/product/generate/route.test.ts app/api/product/jobs/[id]/route.ts app/api/product/jobs/[id]/route.test.ts
git commit -m "feat: render smart black dimension brackets"
```

---

### Task 6: Make image two depend on the signed image-one result

**Files:**
- Modify: `features/product-studio/lib/client-api.ts`
- Modify: `features/product-studio/lib/generation-runner.ts`
- Modify: `features/product-studio/lib/generation-runner.test.ts`
- Modify: `features/product-studio/components/product-studio.tsx`
- Modify: `features/product-studio/components/product-studio.test.tsx`
- Modify: `app/api/product/generate/route.ts`
- Modify: `app/api/product/generate/route.test.ts`

**Interfaces:**
- `ProductStudioApi.submit` accepts `{ files, settings, item, baseImageToken?: string }`.
- `runGenerationBatch` accepts optional `baseImageToken?: string` for single-item image-two retries.
- Image-two form data contains `baseImageToken`; no raw remote URL is accepted from the client.

- [ ] **Step 1: Write failing sequencing tests**

In runner tests, use deferred submissions and require:

```ts
expect(api.submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ item: items[0] }));
expect(imageTwoWasSubmittedBeforeImageOneResolved).toBe(false);
expect(imageTwoSubmitInput.baseImageToken).toBe("image-one-download-token");
```

Add a failure case: image one fails, image two is never submitted and receives a failed task with `请先生成或重试白底商品主图`. Add a retry case where a single image-two item succeeds only when `baseImageToken` is supplied.

In component tests, require image-two retry to use the current successful image-one task token.

In route tests, require item two without a token, an invalid token, an expired token, or a token whose render config is not image one to return 400 without calling GPT Image. Require a valid token to be fetched through `fetchPublicImage`, normalized, converted to PNG data URL, and prepended to the reference images.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run features/product-studio/lib/generation-runner.test.ts features/product-studio/components/product-studio.test.tsx app/api/product/generate/route.test.ts
```

Expected: FAIL because all items currently submit independently and the route ignores a base image token.

- [ ] **Step 3: Implement trusted reference submission**

Update the client to append `baseImageToken` only when present. In the route, for image two:

1. require and verify the download token with `DOWNLOAD_TOKEN_SECRET`;
2. require `verified.render.imageIndex === 1`;
3. fetch `verified.url` through `fetchPublicImage`;
4. normalize it with `normalizeWhiteBackground`;
5. prepend `data:image/png;base64,...` to the existing uploaded reference data URLs.

Return `生成参数或规划项无效` with status 400 for every invalid reference-token case and never expose the signed payload or source URL.

- [ ] **Step 4: Implement dependent batch and retry behavior**

Generate image one first. When it succeeds, retain its `downloadToken` and run remaining items with the existing maximum of three workers; pass the token only to image two. If image one is not successful, publish the explicit failed image-two task and continue generating items three and later.

For `handleRetry`, when `item.id === "2"`, read the successful image-one task from state and pass its token to `runGenerationBatch`. If absent, let the runner publish the same explicit failure without calling the API.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS, image two waits, retries reuse the token, and invalid tokens never reach GPT Image.

- [ ] **Step 6: Commit**

```powershell
git add -- features/product-studio/lib/client-api.ts features/product-studio/lib/generation-runner.ts features/product-studio/lib/generation-runner.test.ts features/product-studio/components/product-studio.tsx features/product-studio/components/product-studio.test.tsx app/api/product/generate/route.ts app/api/product/generate/route.test.ts
git commit -m "feat: derive dimension image from main image"
```

---

### Task 7: Complete the mocked workflow and final verification

**Files:**
- Modify: `tests/e2e/product-studio.spec.ts`
- Modify: `README.md`

**Interfaces:**
- The E2E fixture mocks analysis, image-one generation, image-two 3/4 generation, image-two placement analysis, preview, download, retry, and responsive layout without real Grsai access.

- [ ] **Step 1: Write the failing E2E expectations**

Update request interception to record call order and assert image-one success precedes image-two submission. Mock a valid placement response with the first annotation on top and the second on the right. Assert both generated cards succeed, preview URLs load PNG, and download actions receive signed tokens.

- [ ] **Step 2: Run E2E and verify RED**

Run:

```powershell
$env:PLAYWRIGHT_CHANNEL='chromium'; npm run test:e2e
```

Expected: FAIL until mocks understand the new image-two reference token and placement-analysis call.

- [ ] **Step 3: Complete the mocked fixture and documentation**

Return an exact-white in-memory PNG for protected result fetches, keep every Grsai request intercepted, and document that image two is a two-stage 3/4 generation plus deterministic annotation process.

- [ ] **Step 4: Run focused E2E and verify GREEN**

Run the Step 2 command. Expected: one complete mocked workflow PASS and zero real Grsai requests.

- [ ] **Step 5: Run the full verification matrix**

Run:

```powershell
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
$env:PLAYWRIGHT_CHANNEL='chromium'; npm run test:e2e
$matches = rg -n "Bearer sk-|sk-[A-Za-z0-9]{20,}|GRSAI_API_KEY|DOWNLOAD_TOKEN_SECRET" .next/static
if ($LASTEXITCODE -eq 1) { Write-Output "No client-side secret markers found."; $global:LASTEXITCODE = 0 }
git diff --check
git status --short
```

Expected: all unit/integration tests PASS; lint, TypeScript, build, and E2E exit 0; the static scan prints `No client-side secret markers found.`; `git diff --check` reports no whitespace errors; only the pre-existing untracked `AGENTS.md` and `CLAUDE.md` may remain.

- [ ] **Step 6: Commit**

```powershell
git add -- tests/e2e/product-studio.spec.ts README.md
git commit -m "test: verify smart dimension image workflow"
```
