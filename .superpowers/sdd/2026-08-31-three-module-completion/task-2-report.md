# Task 2 report — product video workflow

## Scope and root causes

- Retry reused the initial-generation action, which replaced unrelated completed tasks and their result URLs/tokens.
- Completion always selected `completed`; cancellation had no separate terminal phase and no retryable conversion for unfinished tasks.
- The product-video browser client and runner accepted signals inconsistently, so cancel could not abort submit/poll fetches.
- Product-video keyframes were signed as MP4 clips and routed through the video-only proxy path.
- The merge route created its workspace and fetched clips before proving that ffmpeg was usable.

## RED → GREEN evidence

- RED: `npx vitest run features/product-video/state.test.ts features/product-video/lib/intro-runner.test.ts features/product-video/lib/client.test.ts --exclude '.worktrees/**'` — 7 expected failures for target-only retry, derived final phases, cancellation, and signal propagation.
- GREEN: same command — 3 files / 7 tests passed.
- RED: `npx vitest run app/api/product-video/generate/route.test.ts app/api/product-video/jobs/[id]/route.test.ts app/api/product-video/download/route.test.ts features/product-video/components/product-video.test.tsx --exclude '.worktrees/**'` — expected keyframe-kind/proxy failures (plus an adjusted pre-existing signal-call assertion and an initially invalid 15-second test fixture).
- GREEN: keyframe routes and component retry test passed after the fixture was corrected.
- RED: `npx vitest run app/api/product-video/merge/route.test.ts --exclude '.worktrees/**'` — 3 expected readiness failures for missing configured path, configured directory, and failed `-version` probe.
- GREEN: same command — 1 file / 10 tests passed with all ffmpeg calls mocked.

## Files changed so far

- Product lifecycle: `features/product-video/state.ts`, page component, client, and batch runner with focused tests.
- Signed media handling: product-video generate/jobs/download routes and tests.
- Merge readiness: merge route and mocked route tests.

## Verification and review

- Complete product-video and shared token/provider regression: 14 files / 83 tests passed.
- Shared video-remake regression: 14 files / 59 tests passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed; the production build includes `/product-video` and all five product-video route handlers.
- Staged dependency closure is limited to `app/product-video`, `app/api/product-video`, `features/product-video`, this report, and the product-video-only AppShell type/navigation/test hunks. Existing product-studio, product API, environment, token-library, archive, and other user files remain unstaged.
- Self-review: target retry maps only the selected task; final task values select completed/partial_failed/failed; cancellation preserves terminal object identities and marks only active tasks retryable; fetch signals reach submit and poll; keyframes use image tokens and normalized image proxying while result clips keep clip tokens; readiness happens before workspace creation and remote clip fetches.
- Per the task instruction not to spawn agents, this review was performed in the current task rather than delegating a reviewer.

## Commit and final diff check

- Commit message: `fix: complete product video workflow`.
- `git diff --check 5b91f8e..HEAD` passed after the final commit amendment.
- No real Grsai/Jimeng/ffmpeg invocation has been performed.
