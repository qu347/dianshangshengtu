# Three Module Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the clothing studio, video remake, and product intro video modules without changing the completed all-category product-image workflow.

**Architecture:** Keep the three feature directories and API namespaces independent. Repair video task lifecycle semantics inside each module, then integrate the already-implemented clothing branch and resolve only shared-shell/security-library conflicts. Mock every upstream image/video call in automated tests; real smoke tests remain approval-gated.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Zod 4, Vitest, Testing Library, Playwright, Sharp, JSZip, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-08-29-video-remake-design.md`, `docs/superpowers/plans/2026-08-29-product-intro-video-prompt.md`, `docs/superpowers/specs/2026-08-28-clothing-studio-design.md`, and the provider contract at `https://www.jimengvip.online/docs/api-guide.html` (authoritative when provider limits differ from older local prose).

## Global Constraints

- Do not modify the intended behavior of `features/product-studio` or `/api/product/*`.
- Do not call Grsai or the video provider from automated tests.
- Do not put API keys, upstream URLs, uploaded image bytes, or signed tokens in logs or committed fixtures.
- Preserve all user-owned untracked ZIP files, old worktrees, environment files, and unrelated dirty changes.
- A single-scene or single-shot retry must preserve every other task, preview URL, and download token.
- Video remake accepts MP4/WEBM up to 150 MB and rejects durations above 90 seconds instead of silently truncating.
- The selectable `nd-seedance-2.0-480p` and `nd-seedance-2.0-720p` models support 5..15 seconds per generated clip; their resolution is fixed by model code.
- Video remake and product-intro settings therefore use a 5-second minimum while those selectable models remain active.
- Initial generation, retry, cancellation, partial failure, and completed states must be distinguishable.
- Run real smoke tests only after explicit approval to spend external API credits.

---

### Task 1: Complete video-remake inputs and task lifecycle

**Files:**
- Modify: `features/video-remake/model.ts`
- Modify: `features/video-remake/state.ts`
- Create: `features/video-remake/state.test.ts`
- Modify: `features/video-remake/model.test.ts`
- Modify: `features/video-remake/components/video-remake.tsx`
- Create: `features/video-remake/components/video-remake.test.tsx`
- Modify: `features/video-remake/lib/frames.ts`
- Modify: `features/video-remake/lib/frames.test.ts`
- Modify: `app/api/video-remake/analyze/route.ts`
- Modify: `app/api/video-remake/analyze/route.test.ts`
- Modify: `lib/grsai/video-script.ts`
- Modify: `lib/grsai/video-script.test.ts`

**Interfaces:**
- Produces: one selected `modelImage: File | null` in page state.
- Produces: `scene_retry_started` and cancellation-aware task transitions that preserve unrelated tasks.
- Consumes: the existing `runSceneBatch({ modelImage, signal, ... })` interface.

- [ ] **Step 1: Write failing reducer/component tests for retry preservation and model input**

Add a reducer test whose initial state has two successful scenes and one failed scene. Dispatch retry-start for only the failed scene and assert that the first two `resultUrl` and `downloadToken` values remain literal, unchanged values. Add a component test that selects one model image, generates a scene, and observes that the API receives that real normalized file rather than `null`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run features/video-remake/state.test.ts features/video-remake/components/video-remake.test.tsx --exclude '.worktrees/**'
```

Expected: retry preservation and model-file assertions fail against the current implementation.

- [ ] **Step 3: Implement the minimal model input and retry transition**

Add one model-image uploader using the existing product-image preprocessing path. Initial generation may create all default tasks; retry must dispatch a target-only action before calling `runSceneBatch([scene])`. The reducer maps only the matching `sceneId` to a queued task and leaves every other object unchanged.

- [ ] **Step 4: Write failing provider-duration and decoded-frame validation tests**

Cover an actual decoded duration of `90.01` seconds and assert a visible `参考视频不能超过 90 秒` failure before any analysis request. Assert the selected nd model workflow accepts 5 seconds and rejects 4 seconds, and its analysis prompt requires each scene to be 5–15 seconds. Add an analyze-route test whose JPEG MIME body is not decodable and assert HTTP 400 with the normalized image validation error.

- [ ] **Step 5: Run validation tests and verify RED**

Run:

```powershell
npx vitest run features/video-remake/model.test.ts features/video-remake/lib/frames.test.ts app/api/video-remake/analyze/route.test.ts lib/grsai/video-script.test.ts --exclude '.worktrees/**'
```

- [ ] **Step 6: Enforce the real 90-second and decoded-image boundaries**

Reject after metadata is available and before frame extraction; do not use `Math.min(duration, 90)` as acceptance. Decode every submitted frame through the existing bounded Sharp validation before calling the paid analysis provider.

- [ ] **Step 7: Add cancellation with the existing AbortSignal**

Create one `AbortController` per generation run, pass its signal to `runSceneBatch`, expose a generating-state cancel button, abort on unmount, and leave completed scene results intact when cancellation occurs.

- [ ] **Step 8: Run the complete video-remake test set**

Run:

```powershell
npx vitest run features/video-remake app/api/video-remake lib/grsai/video-script.test.ts lib/jimeng/video.test.ts --exclude '.worktrees/**'
```

Expected: all tests pass without an external request.

---

### Task 2: Complete product-video lifecycle, timing, and merge readiness

**Files:**
- Modify: `features/product-video/model.ts`
- Modify: `features/product-video/model.test.ts`
- Modify: `features/product-video/state.ts`
- Create: `features/product-video/state.test.ts`
- Modify: `features/product-video/components/product-video.tsx`
- Modify: `features/product-video/components/product-video.test.tsx`
- Modify: `features/product-video/lib/script.ts`
- Modify: `features/product-video/lib/script.test.ts`
- Modify: `app/api/product-video/merge/route.ts`
- Modify: `app/api/product-video/merge/route.test.ts`
- Modify: `lib/jimeng/video.ts`
- Modify: `lib/jimeng/video.test.ts`

**Interfaces:**
- Produces: target-only `shot_retry_started` transitions.
- Produces: `completed`, `partial_failed`, `failed`, and cancellation-aware phase derivation from final tasks.
- Preserves: existing signed clip-token and merge download request formats.

- [ ] **Step 1: Write failing retry-preservation and final-phase tests**

Use three literal tasks: two succeeded with distinct tokens and one failed. Retry the failed shot and assert both successful tokens remain. Feed mixed final results and assert `partial_failed`; feed all failed results and assert `failed`; only all succeeded may assert `completed`.

- [ ] **Step 2: Run the lifecycle tests and verify RED**

Run:

```powershell
npx vitest run features/product-video/state.test.ts features/product-video/model.test.ts features/product-video/components/product-video.test.tsx --exclude '.worktrees/**'
```

- [ ] **Step 3: Implement target-only retry and derived completion**

Do not dispatch the full `generation_started` action from `handleRetry`. Return final tasks from the batch or derive them from reducer updates, then dispatch a completion action carrying the task outcomes so the reducer selects the correct phase.

- [ ] **Step 4: Write failing provider-contract tests**

Assert that the two selectable nd models accept clip durations 5 and 15 and reject 4 and 16 before fetch. Preserve the provider's flat `task_id` submission response, `GET /tasks/{id}`, `completed`/`success` terminal states, and `result`/`result_url`/`video_url` URL fallbacks.

- [ ] **Step 5: Run timing tests and verify RED**

Run:

```powershell
npx vitest run features/product-video/model.test.ts features/product-video/lib/script.test.ts lib/jimeng/video.test.ts --exclude '.worktrees/**'
```

- [ ] **Step 6: Align the shared provider client with model limits**

Keep the product-video schema/UI/prompt at 5..15 seconds for selectable nd models. Add minimal model-aware validation in `submitVideoTask`; do not apply the nd limit to other documented models such as `dvc-seedance-2.5`.

- [ ] **Step 7: Write failing ffmpeg-readiness tests**

Cover missing configured executable, configured directory, and non-zero `-version` exit. The route must return a specific configuration error before downloading any clips or creating a temporary directory.

- [ ] **Step 8: Implement explicit ffmpeg readiness and cancellation**

Resolve `FFMPEG_PATH` or the PATH fallback, verify it is executable, and return the normalized configuration message. Add an `AbortController` to the page using the same lifecycle as video remake.

- [ ] **Step 9: Run the complete product-video test set**

Run:

```powershell
npx vitest run features/product-video app/api/product-video lib/jimeng/video.test.ts --exclude '.worktrees/**'
```

Expected: all tests pass without an external request or real ffmpeg process outside controlled test doubles.

---

### Task 3: Integrate the clothing-studio implementation

**Files:**
- Integrate: `codex/clothing-studio` commits into `codex/complete-three-modules`
- Resolve: `components/app-shell.tsx`
- Resolve: `components/app-shell.test.tsx`
- Resolve: `lib/download-token.ts`
- Resolve: `lib/product-image-validation.ts`
- Resolve: `lib/remote-image.ts`
- Preserve: all current video module files and API routes.

**Interfaces:**
- Produces: `/clothing-studio`, `/api/clothing/*`, and `features/clothing-studio/*` on the integration branch.
- Consumes: current shared upload, signed-token, remote-fetch, image-render, and application-shell behavior.

- [ ] **Step 1: Record the exact branch overlap before integration**

Run `git diff --name-only main...codex/clothing-studio` and compare it with the current dirty-file list. Record every overlapping file before any merge or patch operation.

- [ ] **Step 2: Integrate without discarding current changes**

Use a recoverable local operation. Never reset, clean, or delete the existing working tree. Resolve conflicts by preserving both video token kinds/routes and clothing token/reference additions; keep all four navigation entries as links.

- [ ] **Step 3: Run focused clothing tests**

Run:

```powershell
npx vitest run features/clothing-studio app/api/clothing lib/clothing-upload.test.ts lib/clothing-reference.test.ts lib/clothing-candidate-jobs.test.ts lib/clothing-render-config.test.ts lib/grsai/clothing-analysis.test.ts lib/grsai/clothing-candidates.test.ts lib/grsai/clothing-images.test.ts --exclude '.worktrees/**'
```

- [ ] **Step 4: Run product and video regression tests**

Run all three existing feature/API suites to prove shared-file conflict resolution did not remove earlier behavior.

---

### Task 4: Make repository verification reflect the four active modules

**Files:**
- Modify: `vitest.config.ts`
- Create: `tests/e2e/video-remake.spec.ts`
- Create: `tests/e2e/product-video.spec.ts`
- Integrate: `tests/e2e/clothing-studio.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Vitest never collects any file below `.worktrees/**` or any nested `tests/e2e/**` path.
- Playwright mocks all product, clothing, video-remake, and product-video API requests.

- [ ] **Step 1: Write a failing test-list verification for nested worktrees**

Run `npx vitest list` and preserve the current failure as RED: nested worktree Playwright specs are collected.

- [ ] **Step 2: Fix Vitest exclusion minimally**

Use glob patterns that exclude `.worktrees/**` and `**/tests/e2e/**`. Do not change test environments or worker behavior.

- [ ] **Step 3: Add mocked browser workflows**

Video remake must cover model upload, a rejected over-90-second path at component level, the 5-second provider boundary, two-scene generation, one failure, retry, and preserved first result. Product video must cover the 5-second boundary, mixed result state, retry preservation, ZIP, and merge request. Clothing uses its existing two-stage mocked workflow.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```powershell
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e
git diff --check
```

Expected: zero test/build/type/lint errors; all four page routes appear in the build; every browser test uses mocked APIs; no real upstream request occurs.

- [ ] **Step 5: Document remaining environment prerequisites**

README must state that real video generation requires `VIDEO_API_KEY`, merged product-video output requires a working `FFMPEG_PATH` or PATH-installed ffmpeg, and real smoke tests spend external credits.
