# Task 4 report — four-module verification

## Scope and isolation

- Changed Vitest collection only: root and nested `.worktrees/**` plus every `**/tests/e2e/**` path are excluded. The test environment, worker behavior, and defaults remain unchanged.
- `npx vitest list` in Vitest 4 remains in watch mode unless `--run` is provided. The reproducible RED command was `npx vitest list --run --filesOnly`: with the old exclusion it collected both `.worktrees/clothing-studio/tests/e2e/*.spec.ts` files and many other `.worktrees/**` tests.
- GREEN: with the new exclusion, the same command listed 86 current-repository test files and no `.worktrees` or nested `tests/e2e` path.
- ESLint initially traversed generated files inside the preserved old worktrees (1,205 unrelated errors). The minimal matching root/nested worktree ignores were added to `eslint.config.mjs`; source lint rules and active-module files are unchanged.

## Mock route matrix

| Browser workflow | Fail-closed fallback | Explicit mocked routes | Assertions |
| --- | --- | --- | --- |
| Product studio | `**/api/**` | product analyze/generate/jobs/download | Existing two-image workflow, signed download tokens, no real API. |
| Clothing studio | `**/api/**` | clothing candidates/analyze/generate/jobs/download; product namespace remains rejected | Existing two-stage candidate and generation workflow. |
| Video remake | `**/api/**` | video-remake analyze/generate/jobs/download | Local browser media/paint doubles produce 5-second reference frames; model image multipart field, two 5-second scenes, one failed scene, target-only retry, first result URL preservation, and ZIP downloads. |
| Product video | `**/api/**` | product-video analyze/generate/jobs/download/merge | 5-second shot boundary, mixed result, target-only retry, first preview preservation, ZIP downloads, and merge body token order. |

The generic fallback is registered before exact routes, so Playwright processes the explicit mock first and throws immediately for any unknown page API request. The tests only fulfill same-origin mock responses. They do not start ffmpeg or contact Grsai/video providers.

## RED → GREEN and verification evidence

- New E2E RED: first run exposed the Next route announcer as a second `role=alert` match; selectors were narrowed to the actual failure text. The next run showed that `video preload=metadata` also requests inline clips, so ZIP assertions were correctly narrowed to download requests without `inline=1`.
- New E2E GREEN: `PLAYWRIGHT_CHANNEL=msedge; npm run test:e2e -- tests/e2e/video-remake.spec.ts tests/e2e/product-video.spec.ts` passed 2/2.
- Decoded >90-second boundary: coverage GREEN adds `shows the decoded over-90-second error without starting analysis or generation` at the `VideoRemake` component boundary. It mocks decoded-frame extraction rejecting with `参考视频不能超过 90 秒`, asserts the visible error, and confirms neither analysis nor generation begins. The existing frames test still covers the underlying decoded-duration rejection. The callback-only `execFile` mock also runs without `[DEP0174]`.
- Targeted video-remake/component/merge verification: 3 files, 17 tests passed.
- `npm test`: 86 files, 548 tests passed.
- `npm run lint`: exit 0; two pre-existing warnings remain (`product-video.test.tsx` unused callback argument and `product-video/lib/client.ts` unused import), with zero errors.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run build`: passed and listed all four pages plus clothing/product/video-remake/product-video API routes.
- `PLAYWRIGHT_CHANNEL=msedge; npm run test:e2e` passed 4/4; the environment variable was cleared in the same PowerShell command.
- `git diff --check b3422c9..HEAD`: clean. A separate whole-working-tree `git diff --check` still reports a pre-existing blank EOF line in user-owned `app/api/product/analyze/route.test.ts`; it was not changed by Task 4.

## Files changed by Task 4

- `vitest.config.ts`
- `eslint.config.mjs`
- `tests/e2e/product-studio.spec.ts`
- `tests/e2e/clothing-studio.spec.ts`
- `tests/e2e/video-remake.spec.ts`
- `tests/e2e/product-video.spec.ts`
- `app/api/product-video/merge/route.test.ts`
- `README.md`
- this report

## Self-review

- No production API route, external-provider client, media credential, or ffmpeg implementation was changed.
- No secret or upstream URL was added; test tokens and media bytes are local opaque fixtures.
- Existing user dirty changes, untracked archives, old worktrees, and `stash@{0}` were neither altered nor applied.
- Remaining concern: the lint command is now clean only after excluding intentionally preserved worktrees; the two active-tree warnings are pre-existing and non-fatal.
