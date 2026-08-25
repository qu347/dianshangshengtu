# 全品类商品图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地运行的全品类商品图工作台，完成“上传产品图 → Gemini 分析 → 编辑出图规划 → GPT Image 2 批量生成 → 重试与下载”的真实闭环。

**Architecture:** 使用 Next.js App Router 同时承载 React 界面与服务端路由。业务代码放在 `features/product-studio`，Grsai 调用集中在 `lib/grsai`；客户端只保存当前会话状态，并以最多 3 个并发任务驱动生成和轮询。

**Tech Stack:** Next.js、React、TypeScript、Tailwind CSS、Zod、JSZip、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-25-product-studio-design.md`

## Global Constraints

- 当前只实现模块一「全品类商品图」；「服装组图」只保留导航入口。
- 首版本地运行，不包含登录、数据库、历史记录、计费或生产部署。
- 产品图支持 JPG、PNG、WEBP；一次上传 1–6 张。
- 原始单文件上限 15 MB；规范化后最长边不超过 2048 像素、WEBP 质量 0.9、单文件不超过 5 MB。
- 用户可选择生成 1–16 张图片。
- Gemini 负责商品分析与结构化规划；`gpt-image-2` 负责真实生图。
- 同时运行的生图任务不得超过 3 个。
- 自动化测试必须模拟 Grsai，不消耗积分；最终真实冒烟测试只生成 1 张图。
- `GRSAI_API_KEY` 和 `DOWNLOAD_TOKEN_SECRET` 只能存在于服务端环境变量，禁止使用 `NEXT_PUBLIC_` 前缀。
- 不记录 API Key、完整 Base64 图片或完整第三方响应。

---

## Planned File Structure

```text
app/
  api/product/analyze/route.ts
  api/product/download/route.ts
  api/product/generate/route.ts
  api/product/jobs/[id]/route.ts
  product-studio/page.tsx
  globals.css
  layout.tsx
  page.tsx
components/
  app-shell.tsx
features/product-studio/
  components/
    analysis-panel.tsx
    generation-grid.tsx
    generation-settings.tsx
    image-uploader.tsx
    plan-editor.tsx
    product-studio.tsx
    result-card.tsx
  lib/
    client-api.ts
    downloads.ts
    generation-runner.ts
    image-files.ts
  model.ts
  state.ts
  test-fixtures.ts
lib/grsai/
  analysis.ts
  errors.ts
  http.ts
  images.ts
lib/
  download-token.ts
tests/e2e/
  product-studio.spec.ts
.env.example
next.config.ts
playwright.config.ts
postcss.config.mjs
eslint.config.mjs
vitest.config.ts
vitest.setup.ts
```

Each production file has one responsibility: domain contracts in `model.ts`, state transitions in `state.ts`, browser orchestration in feature `lib`, provider normalization in `lib/grsai`, and HTTP translation in `app/api`.

---

### Task 1: Bootstrap the Next.js Application and Shared Shell

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `app/globals.css`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `components/app-shell.tsx`
- Test: `components/app-shell.test.tsx`

**Interfaces:**
- Consumes: none.
- Produces: `AppShell({ active, children }: { active: "product-studio" | "clothing-studio"; children: ReactNode })` and a working Next.js/Vitest toolchain used by every later task.

- [ ] **Step 1: Install the minimal runtime and test dependencies**

Run:

```powershell
npm init -y
npm install next react react-dom zod jszip
npm install --save-dev typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next vitest jsdom @vitejs/plugin-react vite-tsconfig-paths @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
npm pkg set scripts.dev="next dev"
npm pkg set scripts.build="next build"
npm pkg set scripts.start="next start"
npm pkg set scripts.lint="eslint ."
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.test:e2e="playwright test"
```

Expected: `package.json` and `package-lock.json` exist; no application source exists yet.

- [ ] **Step 2: Add TypeScript, Next.js, Tailwind, and Vitest configuration**

Create the files with these essential contents:

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

```ts
// vitest.config.ts
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    restoreMocks: true,
  },
});
```

```ts
// vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

```js
// postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};
export default nextConfig;
```

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);
```

```ts
// next-env.d.ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 3: Write the failing shell test**

```tsx
// components/app-shell.test.tsx
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

it("highlights the product studio and keeps clothing as a future module", () => {
  render(<AppShell active="product-studio"><div>工作区</div></AppShell>);

  expect(screen.getByRole("link", { name: "全品类商品图" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("服装组图")).toBeInTheDocument();
  expect(screen.getByText("工作区")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the test and verify the expected failure**

Run: `npm test -- components/app-shell.test.tsx`

Expected: FAIL because `components/app-shell.tsx` does not exist.

- [ ] **Step 5: Implement the shell and root pages**

```tsx
// components/app-shell.tsx
import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ active, children }: {
  active: "product-studio" | "clothing-studio";
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#17191d]">
      <header className="flex h-14 items-center justify-between border-b border-black/10 bg-white px-5">
        <span className="font-medium">AI 电商视觉</span>
        <span className="text-sm text-black/55">本地模式</span>
      </header>
      <div className="grid min-h-[calc(100vh-3.5rem)] md:grid-cols-[220px_1fr]">
        <nav aria-label="模块导航" className="flex gap-2 border-b border-black/10 bg-white p-3 md:block md:border-r md:border-b-0">
          <Link href="/product-studio" aria-current={active === "product-studio" ? "page" : undefined}
            className={active === "product-studio" ? "block rounded-lg bg-[#17191d] px-3 py-2 text-sm text-white" : "block rounded-lg px-3 py-2 text-sm"}>
            全品类商品图
          </Link>
          <span className="block rounded-lg px-3 py-2 text-sm text-black/55">服装组图</span>
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
```

```tsx
// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "AI 电商视觉", description: "AI 电商商品图生成工作台" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
```

```tsx
// app/page.tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/product-studio"); }
```

```css
/* app/globals.css */
@import "tailwindcss";
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, "Microsoft YaHei", sans-serif; }
button, input, select, textarea { font: inherit; }
```

- [ ] **Step 6: Verify the shell**

Run:

```powershell
npm test -- components/app-shell.test.tsx
npm run lint
```

Expected: test PASS and lint exits 0.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts vitest.setup.ts app components/app-shell.tsx components/app-shell.test.tsx
git commit -m "chore: bootstrap product studio app"
```

---

### Task 2: Define Domain Schemas and State Transitions

**Files:**
- Create: `features/product-studio/model.ts`
- Create: `features/product-studio/model.test.ts`
- Create: `features/product-studio/state.ts`
- Create: `features/product-studio/state.test.ts`
- Create: `features/product-studio/test-fixtures.ts`

**Interfaces:**
- Consumes: Zod installed in Task 1.
- Produces: `GenerationSettings`, `ProductAnalysis`, `PlanItem`, `GenerationTask`, `ProductStudioState`, `productStudioReducer`, `assertPlanCount`, and shared deterministic test fixtures.

- [ ] **Step 1: Write failing schema tests**

```ts
// features/product-studio/model.test.ts
import { describe, expect, it } from "vitest";
import { GenerationSettingsSchema, ProductAnalysisSchema, assertPlanCount } from "./model";

const settings = { platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto" };

it("accepts 1 through 16 images and rejects values outside the range", () => {
  expect(GenerationSettingsSchema.parse(settings).imageCount).toBe(4);
  expect(() => GenerationSettingsSchema.parse({ ...settings, imageCount: 0 })).toThrow();
  expect(() => GenerationSettingsSchema.parse({ ...settings, imageCount: 17 })).toThrow();
});

it("rejects a plan whose length differs from the requested count", () => {
  const analysis = ProductAnalysisSchema.parse({
    category: "杯具",
    productName: "保温杯",
    visualFacts: [{ value: "银色金属杯身", confidence: "observed" }],
    audience: ["通勤人群"],
    sellingPoints: [{ title: "便携", evidence: "用户提供", confidence: "user_provided" }],
    visualDirection: "简洁棚拍",
    plan: [{ id: "1", type: "main", title: "主图", objective: "展示产品", copy: "", scene: "白底", prompt: "白底产品主图" }],
  });
  expect(() => assertPlanCount(analysis, 2)).toThrow("规划数量应为 2，实际为 1");
});
```

- [ ] **Step 2: Run the model tests and verify failure**

Run: `npm test -- features/product-studio/model.test.ts`

Expected: FAIL because `model.ts` does not exist.

- [ ] **Step 3: Implement exact domain schemas**

```ts
// features/product-studio/model.ts
import { z } from "zod";

export const GenerationSettingsSchema = z.object({
  platform: z.enum(["general", "taobao", "douyin", "amazon", "shopify"]),
  language: z.enum(["none", "zh-CN", "en"]),
  aspectRatio: z.enum(["1024x1024", "1024x1536", "1536x1024"]),
  imageCount: z.number().int().min(1).max(16),
  quality: z.enum(["auto", "low", "medium", "high"]),
});
export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;

const ConfidenceSchema = z.enum(["observed", "inferred", "user_provided"]);
export const PlanItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["main", "detail"]),
  title: z.string().min(1),
  objective: z.string().min(1),
  copy: z.string(),
  scene: z.string().min(1),
  prompt: z.string().min(1),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const ProductAnalysisSchema = z.object({
  category: z.string().min(1),
  productName: z.string().min(1),
  visualFacts: z.array(z.object({ value: z.string().min(1), confidence: ConfidenceSchema })),
  audience: z.array(z.string().min(1)),
  sellingPoints: z.array(z.object({ title: z.string().min(1), evidence: z.string().min(1), confidence: ConfidenceSchema })),
  visualDirection: z.string().min(1),
  plan: z.array(PlanItemSchema).min(1).max(16),
});
export type ProductAnalysis = z.infer<typeof ProductAnalysisSchema>;

export const GenerationTaskSchema = z.object({
  planItemId: z.string().min(1),
  providerJobId: z.string().min(1).optional(),
  status: z.enum(["queued", "submitting", "running", "succeeded", "failed", "timed_out"]),
  progress: z.number().min(0).max(100),
  resultUrl: z.string().url().optional(),
  downloadToken: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;

export function assertPlanCount(analysis: ProductAnalysis, expected: number) {
  if (analysis.plan.length !== expected) throw new Error(`规划数量应为 ${expected}，实际为 ${analysis.plan.length}`);
  return { ...analysis, plan: analysis.plan.map((item, index) => ({ ...item, id: String(index + 1) })) };
}
```

Create shared fixtures with complete, valid values so later tests do not redefine or drift from the domain contract:

```ts
// features/product-studio/test-fixtures.ts
import type { GenerationSettings, PlanItem, ProductAnalysis } from "./model";

export const defaultSettings: GenerationSettings = {
  platform: "taobao",
  language: "zh-CN",
  aspectRatio: "1024x1536",
  imageCount: 2,
  quality: "auto",
};

export function makePlanItems(count: number): PlanItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    type: index === 0 ? "main" : "detail",
    title: index === 0 ? "白底主图" : `详情图 ${index}`,
    objective: index === 0 ? "完整展示产品" : "展示核心卖点",
    copy: index === 0 ? "" : `卖点 ${index}`,
    scene: index === 0 ? "纯白摄影棚" : "真实使用场景",
    prompt: index === 0 ? "生成纯白背景商品主图" : `生成第 ${index} 张详情图`,
  }));
}

export const analysisWithTwoItems: ProductAnalysis = {
  category: "杯具",
  productName: "保温杯",
  visualFacts: [{ value: "银色金属杯身", confidence: "observed" }],
  audience: ["通勤人群"],
  sellingPoints: [{ title: "便携", evidence: "用户提供", confidence: "user_provided" }],
  visualDirection: "简洁棚拍",
  plan: makePlanItems(2),
};

export function makeImageFile(name = "product.png") {
  return new File(["image"], name, { type: "image/png" });
}
```

- [ ] **Step 4: Write failing reducer tests**

```ts
// features/product-studio/state.test.ts
import { expect, it } from "vitest";
import { initialProductStudioState, productStudioReducer } from "./state";

it("invalidates analysis when a key setting changes", () => {
  const withPlan = { ...initialProductStudioState, phase: "reviewing_plan" as const, analysis: { plan: [{ id: "1" }] } as never };
  const next = productStudioReducer(withPlan, { type: "settings_changed", patch: { imageCount: 2 } });
  expect(next.phase).toBe("input");
  expect(next.analysis).toBeNull();
  expect(next.notice).toBe("关键参数已变化，请重新分析产品");
});

it("invalidates analysis when product facts change", () => {
  const withPlan = { ...initialProductStudioState, phase: "reviewing_plan" as const, productName: "旧名称", analysis: { plan: [{ id: "1" }] } as never };
  const next = productStudioReducer(withPlan, { type: "text_changed", productName: "新名称" });
  expect(next.phase).toBe("input");
  expect(next.analysis).toBeNull();
  expect(next.notice).toBe("产品信息已变化，请重新分析产品");
});

it("updates one task without replacing the remaining tasks", () => {
  const state = { ...initialProductStudioState, tasks: [
    { planItemId: "1", status: "running" as const, progress: 10 },
    { planItemId: "2", status: "queued" as const, progress: 0 },
  ] };
  const next = productStudioReducer(state, { type: "task_changed", task: { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://example.com/1.png", downloadToken: "token" } });
  expect(next.tasks[0].status).toBe("succeeded");
  expect(next.tasks[1].status).toBe("queued");
});
```

- [ ] **Step 5: Implement the reducer**

```ts
// features/product-studio/state.ts
import type { GenerationSettings, GenerationTask, ProductAnalysis } from "./model";

export type ProductStudioPhase = "input" | "analyzing" | "reviewing_plan" | "submitting" | "generating" | "completed";
export type ProductStudioState = {
  phase: ProductStudioPhase;
  files: File[];
  settings: GenerationSettings;
  productName: string;
  requirements: string;
  analysis: ProductAnalysis | null;
  tasks: GenerationTask[];
  notice: string | null;
};

export const initialProductStudioState: ProductStudioState = {
  phase: "input",
  files: [],
  settings: { platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto" },
  productName: "",
  requirements: "",
  analysis: null,
  tasks: [],
  notice: null,
};

export type ProductStudioAction =
  | { type: "files_changed"; files: File[] }
  | { type: "settings_changed"; patch: Partial<GenerationSettings> }
  | { type: "text_changed"; productName?: string; requirements?: string }
  | { type: "analysis_started" }
  | { type: "analysis_succeeded"; analysis: ProductAnalysis }
  | { type: "analysis_failed"; message: string }
  | { type: "plan_changed"; analysis: ProductAnalysis }
  | { type: "generation_started"; tasks: GenerationTask[] }
  | { type: "task_changed"; task: GenerationTask }
  | { type: "generation_completed" };

export function productStudioReducer(state: ProductStudioState, action: ProductStudioAction): ProductStudioState {
  if (action.type === "files_changed") return { ...state, files: action.files, phase: "input", analysis: null, tasks: [], notice: state.analysis ? "产品图片已变化，请重新分析产品" : null };
  if (action.type === "settings_changed") return { ...state, settings: { ...state.settings, ...action.patch }, phase: "input", analysis: null, tasks: [], notice: state.analysis ? "关键参数已变化，请重新分析产品" : null };
  if (action.type === "text_changed") return {
    ...state,
    productName: action.productName ?? state.productName,
    requirements: action.requirements ?? state.requirements,
    phase: state.analysis ? "input" : state.phase,
    analysis: state.analysis ? null : state.analysis,
    tasks: state.analysis ? [] : state.tasks,
    notice: state.analysis ? "产品信息已变化，请重新分析产品" : state.notice,
  };
  if (action.type === "analysis_started") return { ...state, phase: "analyzing", notice: null };
  if (action.type === "analysis_succeeded") return { ...state, phase: "reviewing_plan", analysis: action.analysis, tasks: [], notice: null };
  if (action.type === "analysis_failed") return { ...state, phase: state.analysis ? "reviewing_plan" : "input", notice: action.message };
  if (action.type === "plan_changed") return { ...state, analysis: action.analysis };
  if (action.type === "generation_started") return { ...state, phase: "submitting", tasks: action.tasks, notice: null };
  if (action.type === "task_changed") return { ...state, phase: "generating", tasks: state.tasks.map((task) => task.planItemId === action.task.planItemId ? action.task : task) };
  if (action.type === "generation_completed") return { ...state, phase: "completed" };
  return state;
}
```

- [ ] **Step 6: Verify domain behavior**

Run: `npm test -- features/product-studio/model.test.ts features/product-studio/state.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add features/product-studio/model.ts features/product-studio/model.test.ts features/product-studio/state.ts features/product-studio/state.test.ts features/product-studio/test-fixtures.ts
git commit -m "feat: define product studio domain model"
```

---

### Task 3: Validate, Normalize, and Select Product Images

**Files:**
- Create: `features/product-studio/lib/image-files.ts`
- Create: `features/product-studio/lib/image-files.test.ts`
- Create: `features/product-studio/components/image-uploader.tsx`
- Create: `features/product-studio/components/image-uploader.test.tsx`
- Create: `features/product-studio/components/generation-settings.tsx`
- Create: `features/product-studio/components/generation-settings.test.tsx`

**Interfaces:**
- Consumes: `GenerationSettings` from Task 2.
- Produces: `validateProductFiles(files)`, `preprocessProductImage(file)`, `ImageUploader`, `GenerationSettingsForm`.

- [ ] **Step 1: Write failing file validation tests**

```ts
// features/product-studio/lib/image-files.test.ts
import { expect, it } from "vitest";
import { validateProductFiles } from "./image-files";

const image = (name: string, type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });

it("accepts one through six supported images", () => {
  expect(validateProductFiles([image("a.png")])).toEqual([]);
  expect(validateProductFiles(Array.from({ length: 6 }, (_, index) => image(`${index}.png`)))).toEqual([]);
});

it("reports count, type, and 15 MB original size errors", () => {
  expect(validateProductFiles([])).toContain("请至少上传 1 张产品图");
  expect(validateProductFiles(Array.from({ length: 7 }, (_, i) => image(`${i}.png`)))).toContain("最多上传 6 张产品图");
  expect(validateProductFiles([image("a.gif", "image/gif")])).toContain("仅支持 JPG、PNG、WEBP 图片");
  expect(validateProductFiles([image("large.png", "image/png", 15 * 1024 * 1024 + 1)])).toContain("单张原图不能超过 15 MB");
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- features/product-studio/lib/image-files.test.ts`

Expected: FAIL because `image-files.ts` does not exist.

- [ ] **Step 3: Implement validation and browser preprocessing**

```ts
// features/product-studio/lib/image-files.ts
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ORIGINAL_MAX_BYTES = 15 * 1024 * 1024;
const NORMALIZED_MAX_BYTES = 5 * 1024 * 1024;

export function validateProductFiles(files: File[]) {
  const errors: string[] = [];
  if (files.length === 0) errors.push("请至少上传 1 张产品图");
  if (files.length > 6) errors.push("最多上传 6 张产品图");
  if (files.some((file) => !ACCEPTED_TYPES.has(file.type))) errors.push("仅支持 JPG、PNG、WEBP 图片");
  if (files.some((file) => file.size > ORIGINAL_MAX_BYTES)) errors.push("单张原图不能超过 15 MB");
  return errors;
}

export async function preprocessProductImage(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片压缩失败")), "image/webp", 0.9));
  if (blob.size > NORMALIZED_MAX_BYTES) throw new Error("压缩后的图片仍超过 5 MB，请使用尺寸更小的原图");
  return new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
}
```

Add this concrete preprocessing test:

```ts
it("scales a 3000 by 1500 image to 2048 by 1024 and returns WEBP", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 3000, height: 1500, close }));
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["webp"], { type: "image/webp" })));
  const result = await preprocessProductImage(image("large.png"));
  const canvas = document.querySelector("canvas");
  expect(canvas).toBeNull();
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1024);
  expect(result.type).toBe("image/webp");
  expect(close).toHaveBeenCalled();
});
```

Because the implementation creates an unattached canvas, assert the dimensions through `drawImage` rather than querying the document.

- [ ] **Step 4: Write failing uploader and settings component tests**

```tsx
// features/product-studio/components/image-uploader.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ImageUploader } from "./image-uploader";

it("reports too many files without calling onFilesChanged", async () => {
  const onFilesChanged = vi.fn();
  render(<ImageUploader files={[]} onFilesChanged={onFilesChanged} />);
  const files = Array.from({ length: 7 }, (_, i) => new File(["x"], `${i}.png`, { type: "image/png" }));
  await userEvent.upload(screen.getByLabelText("上传产品图"), files);
  expect(screen.getByRole("alert")).toHaveTextContent("最多上传 6 张");
  expect(onFilesChanged).not.toHaveBeenCalled();
});
```

```tsx
// features/product-studio/components/generation-settings.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { GenerationSettingsForm } from "./generation-settings";

it("allows selecting 1 through 16 images", async () => {
  const onChange = vi.fn();
  render(<GenerationSettingsForm value={{ platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto" }} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "16");
  expect(onChange).toHaveBeenCalledWith({ imageCount: 16 });
});
```

- [ ] **Step 5: Implement accessible upload and settings controls**

`ImageUploader` uses a native multi-file input with `accept="image/jpeg,image/png,image/webp"`, shows thumbnails via `URL.createObjectURL`, allows removing one image, and calls `preprocessProductImage` before `onFilesChanged`. Its change handler is:

```tsx
async function handleFiles(selected: File[]) {
  const errors = validateProductFiles(selected);
  if (errors.length) { setError(errors[0]); return; }
  try {
    const processed = await Promise.all(selected.map(preprocessProductImage));
    setError(null);
    onFilesChanged(processed);
  } catch (error) {
    setError(error instanceof Error ? error.message : "图片处理失败");
  }
}

<input
  aria-label="上传产品图"
  type="file"
  multiple
  accept="image/jpeg,image/png,image/webp"
  onChange={(event) => void handleFiles(Array.from(event.currentTarget.files ?? []))}
/>
```

`GenerationSettingsForm` must render these exact options:

```ts
export const PLATFORM_OPTIONS = [
  ["general", "通用电商"], ["taobao", "淘宝 / 天猫"], ["douyin", "抖音商城"], ["amazon", "Amazon"], ["shopify", "Shopify"],
] as const;
export const LANGUAGE_OPTIONS = [["none", "无文字"], ["zh-CN", "中文"], ["en", "英文"]] as const;
export const RATIO_OPTIONS = [["1024x1024", "1:1 正方形"], ["1024x1536", "2:3 竖版"], ["1536x1024", "3:2 横版"]] as const;
```

Each native `<select>` calls `onChange` with one typed patch. The quantity handler is exactly:

```tsx
<select aria-label="生成数量" value={value.imageCount} onChange={(event) => onChange({ imageCount: Number(event.currentTarget.value) })}>
  {Array.from({ length: 16 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 张</option>)}
</select>
```

The quantity select is generated from `Array.from({ length: 16 }, (_, index) => index + 1)`; quality remains an internal default of `auto` and is not shown as a redundant single-option control.

- [ ] **Step 6: Verify image controls**

Run:

```powershell
npm test -- features/product-studio/lib/image-files.test.ts features/product-studio/components/image-uploader.test.tsx features/product-studio/components/generation-settings.test.tsx
npm run lint
```

Expected: all tests PASS and lint exits 0.

- [ ] **Step 7: Commit**

```powershell
git add features/product-studio/lib/image-files.ts features/product-studio/lib/image-files.test.ts features/product-studio/components/image-uploader.tsx features/product-studio/components/image-uploader.test.tsx features/product-studio/components/generation-settings.tsx features/product-studio/components/generation-settings.test.tsx
git commit -m "feat: add product image inputs"
```

---

### Task 4: Implement Grsai Product Analysis and the Analyze Route

**Files:**
- Create: `lib/grsai/errors.ts`
- Create: `lib/grsai/http.ts`
- Create: `lib/grsai/http.test.ts`
- Create: `lib/grsai/analysis.ts`
- Create: `lib/grsai/analysis.test.ts`
- Create: `app/api/product/analyze/route.ts`
- Create: `app/api/product/analyze/route.test.ts`

**Interfaces:**
- Consumes: `GenerationSettings`, `ProductAnalysisSchema`, `assertPlanCount` from Task 2.
- Produces: `grsaiFetch<T>()`, `analyzeProduct()`, `POST /api/product/analyze`.

- [ ] **Step 1: Write failing provider tests**

```ts
// lib/grsai/analysis.test.ts
import { beforeEach, expect, it, vi } from "vitest";
import { analyzeProduct, buildAnalysisPrompt } from "./analysis";
import { analysisWithTwoItems, defaultSettings } from "@/features/product-studio/test-fixtures";

const validInput = {
  images: ["data:image/png;base64,iVBORw0KGgo="],
  settings: defaultSettings,
  productName: "保温杯",
  requirements: "突出便携性",
};

beforeEach(() => { process.env.GRSAI_API_KEY = "test-key"; });

it("requires the exact requested plan count and forbids invented claims", () => {
  const prompt = buildAnalysisPrompt({ productName: "水杯", requirements: "", imageCount: 6, platform: "taobao", language: "zh-CN" });
  expect(prompt).toContain("恰好 6 个规划项");
  expect(prompt).toContain("不得臆造认证、功效、成分、规格或价格");
});

it("repairs malformed JSON once and returns a validated analysis", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisWithTwoItems) } }] }), { status: 200 }));
  const result = await analyzeProduct(validInput, fetchImpl);
  expect(result.plan).toHaveLength(validInput.settings.imageCount);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
```

The test uses the complete Task 2 fixture and does not mock schema validation.

- [ ] **Step 2: Run the provider tests and verify failure**

Run: `npm test -- lib/grsai/analysis.test.ts`

Expected: FAIL because the Grsai files do not exist.

- [ ] **Step 3: Implement normalized Grsai HTTP errors**

```ts
// lib/grsai/errors.ts
export type GrsaiErrorCode = "auth" | "balance" | "moderation" | "invalid_request" | "upstream" | "timeout";
export class GrsaiError extends Error {
  constructor(public code: GrsaiErrorCode, message: string, public status = 502) { super(message); }
}
```

```ts
// lib/grsai/http.ts
import { GrsaiError } from "./errors";

const BASE_URL = process.env.GRSAI_BASE_URL ?? "https://grsai.dakka.com.cn";

export async function grsaiFetch<T>(path: string, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<T> {
  const apiKey = process.env.GRSAI_API_KEY;
  if (!apiKey) throw new GrsaiError("auth", "服务端尚未配置 GRSAI_API_KEY", 503);
  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new GrsaiError("timeout", "Grsai 请求超时，请重试", 504);
    throw new GrsaiError("upstream", "无法连接 Grsai 服务", 502);
  }
  if (!response.ok) {
    const body = await response.text();
    const lower = body.toLowerCase();
    if (response.status === 401 || response.status === 403) throw new GrsaiError("auth", "Grsai API Key 无效或无权限", response.status);
    if (lower.includes("balance") || lower.includes("积分")) throw new GrsaiError("balance", "Grsai 积分或余额不足", 402);
    throw new GrsaiError("upstream", "Grsai 服务暂时不可用", response.status);
  }
  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Implement multimodal analysis and one repair attempt**

`analyzeProduct` uses `POST /v1/chat/completions`, model `gemini-3.1-flash`, `stream: false`, and OpenAI-compatible content parts:

```ts
export function buildAnalysisPrompt(input: { productName: string; requirements: string; imageCount: number; platform: string; language: string }) {
  return [
    `分析这些产品图片。产品名称：${input.productName || "未提供"}。`,
    `用户补充信息：${input.requirements || "无"}。目标平台：${input.platform}。目标语言：${input.language}。`,
    `必须返回恰好 ${input.imageCount} 个规划项。`,
    "不得臆造认证、功效、成分、规格或价格；无法从图片确认的内容标记为 inferred，用户提供的内容标记为 user_provided。",
    "只输出 JSON，字段为 category、productName、visualFacts[{value,confidence}]、audience[]、sellingPoints[{title,evidence,confidence}]、visualDirection、plan[{id,type,title,objective,copy,scene,prompt}]。",
    "plan.type 只能是 main 或 detail；所有标题、文案、场景和提示词必须适用于当前产品。",
  ].join("\n");
}

const messages = [
  { role: "system", content: "你是电商视觉分析师。只输出符合要求的 JSON，不使用 Markdown。" },
  { role: "user", content: [
    { type: "text", text: buildAnalysisPrompt(input) },
    ...input.images.map((url) => ({ type: "image_url", image_url: { url } })),
  ] },
];

function parseAnalysisContent(content: string, expectedCount: number) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return assertPlanCount(ProductAnalysisSchema.parse(JSON.parse(unfenced)), expectedCount);
}
```

Parse `choices[0].message.content`, strip one surrounding Markdown code fence if present, run `ProductAnalysisSchema.parse`, then `assertPlanCount`. On failure, call the same endpoint exactly once with the invalid content plus the Zod-required field list and requested count. If the second response still fails, throw `GrsaiError("invalid_request", "AI 分析结果格式异常，请重新分析", 502)`.

Add focused HTTP error tests:

```ts
// lib/grsai/http.test.ts
import { beforeEach, expect, it, vi } from "vitest";
import { grsaiFetch } from "./http";

beforeEach(() => { process.env.GRSAI_API_KEY = "test-key"; });

it("maps balance responses without exposing the upstream body", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("积分不足: internal account 123", { status: 402 }));
  await expect(grsaiFetch("/test", { method: "POST", body: "{}" }, fetchImpl)).rejects.toMatchObject({ code: "balance", message: "Grsai 积分或余额不足" });
});

it("maps network and timeout failures", async () => {
  await expect(grsaiFetch("/test", {}, vi.fn().mockRejectedValue(new TypeError("socket detail")))).rejects.toMatchObject({ code: "upstream" });
  await expect(grsaiFetch("/test", {}, vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")))).rejects.toMatchObject({ code: "timeout" });
});
```

- [ ] **Step 5: Write the failing analyze route test**

```ts
// app/api/product/analyze/route.test.ts
import { expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/grsai/analysis", () => ({ analyzeProduct: vi.fn() }));

it("rejects more than six images before calling Grsai", async () => {
  const form = new FormData();
  for (let index = 0; index < 7; index++) form.append("images", new File(["x"], `${index}.png`, { type: "image/png" }));
  form.append("settings", JSON.stringify({ platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto" }));
  const response = await POST(new Request("http://localhost/api/product/analyze", { method: "POST", body: form }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "最多上传 6 张产品图" });
});
```

- [ ] **Step 6: Implement `POST /api/product/analyze`**

The route must:

1. Parse multipart form data.
2. Require 1–6 `File` entries named `images`.
3. Require each normalized file to be JPG/PNG/WEBP and no larger than 5 MB.
4. Parse `settings` with `GenerationSettingsSchema`.
5. Convert each file to a `data:${type};base64,...` URL.
6. Call `analyzeProduct` with `productName` and `requirements` strings.
7. Return `{ analysis }` on success.
8. Map `GrsaiError` to its safe message and status; map all other errors to status 500 and `分析失败，请稍后重试`.

```ts
// app/api/product/analyze/route.ts
import { GenerationSettingsSchema } from "@/features/product-studio/model";
import { analyzeProduct } from "@/lib/grsai/analysis";
import { GrsaiError } from "@/lib/grsai/errors";
import { ZodError } from "zod";

const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const images = form.getAll("images").filter((value): value is File => value instanceof File);
    if (images.length === 0) return Response.json({ error: "请至少上传 1 张产品图" }, { status: 400 });
    if (images.length > 6) return Response.json({ error: "最多上传 6 张产品图" }, { status: 400 });
    if (images.some((file) => !allowed.has(file.type) || file.size > 5 * 1024 * 1024)) return Response.json({ error: "图片格式或大小不符合要求" }, { status: 400 });
    const settings = GenerationSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
    const dataUrls = await Promise.all(images.map(async (file) => `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`));
    const analysis = await analyzeProduct({ images: dataUrls, settings, productName: String(form.get("productName") ?? ""), requirements: String(form.get("requirements") ?? "") });
    return Response.json({ analysis });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "生成参数无效" }, { status: 400 });
    if (error instanceof GrsaiError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "分析失败，请稍后重试" }, { status: 500 });
  }
}
```

- [ ] **Step 7: Verify analysis tests**

Run:

```powershell
npm test -- lib/grsai/http.test.ts lib/grsai/analysis.test.ts app/api/product/analyze/route.test.ts
npm run lint
```

Expected: all tests PASS; no network calls occur.

- [ ] **Step 8: Commit**

```powershell
git add lib/grsai app/api/product/analyze
git commit -m "feat: add AI product analysis"
```

---

### Task 5: Build the Double-Column Studio and Analysis Flow

**Files:**
- Create: `features/product-studio/lib/client-api.ts`
- Create: `features/product-studio/components/analysis-panel.tsx`
- Create: `features/product-studio/components/product-studio.tsx`
- Create: `features/product-studio/components/product-studio.test.tsx`
- Create: `app/product-studio/page.tsx`

**Interfaces:**
- Consumes: `AppShell`, Task 2 state/model, Task 3 controls, `POST /api/product/analyze`.
- Produces: `analyzeProductClient(formData)`, `AnalysisPanel`, `ProductStudio`.

- [ ] **Step 1: Write the failing analysis-flow component test**

```tsx
// features/product-studio/components/product-studio.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ProductStudio } from "./product-studio";
import { analysisWithTwoItems } from "../test-fixtures";

vi.mock("../lib/image-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/image-files")>();
  return { ...actual, preprocessProductImage: vi.fn(async (file: File) => file) };
});

it("uploads a product and shows the analysis", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  render(<ProductStudio api={{ analyze }} />);
  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  expect(await screen.findByText(analysisWithTwoItems.visualDirection)).toBeInTheDocument();
  expect(screen.getByText("银色金属杯身")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- features/product-studio/components/product-studio.test.tsx`

Expected: FAIL because the studio components do not exist.

- [ ] **Step 3: Implement the typed browser API**

```ts
// features/product-studio/lib/client-api.ts
import { ProductAnalysisSchema, assertPlanCount, type GenerationSettings } from "../model";

export async function analyzeProductClient(input: { files: File[]; settings: GenerationSettings; productName: string; requirements: string }) {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("productName", input.productName);
  form.append("requirements", input.requirements);
  const response = await fetch("/api/product/analyze", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "分析失败，请稍后重试");
  return assertPlanCount(ProductAnalysisSchema.parse(body.analysis), input.settings.imageCount);
}

export type ProductStudioAnalysisApi = {
  analyze: typeof analyzeProductClient;
};
```

- [ ] **Step 4: Implement the A-layout studio**

`ProductStudio` is a client component using `useReducer(productStudioReducer, initialProductStudioState)`. It renders:

The file begins with `"use client";` because it owns files, reducer state, and browser API calls.

- A five-step progress row: 上传、AI 分析、确认规划、生成、完成.
- A desktop two-column grid that stacks on narrow screens.
- Left: `ImageUploader`, product name input, requirements textarea, `GenerationSettingsForm`, analyze button.
- Right: empty instructions, loading state, `AnalysisPanel`, or later generation results based on `state.phase`.

The analyze handler must validate that at least one processed file exists, dispatch `analysis_started`, call `api.analyze`, dispatch `analysis_succeeded`, and preserve inputs on `analysis_failed`.

```tsx
export function ProductStudio({ api = { analyze: analyzeProductClient } }: { api?: ProductStudioAnalysisApi }) {
  const [state, dispatch] = useReducer(productStudioReducer, initialProductStudioState);
  const activeStep = { input: 0, analyzing: 1, reviewing_plan: 2, submitting: 3, generating: 3, completed: 4 }[state.phase];

  async function handleAnalyze() {
    if (state.files.length === 0) { dispatch({ type: "analysis_failed", message: "请至少上传 1 张产品图" }); return; }
    dispatch({ type: "analysis_started" });
    try {
      const analysis = await api.analyze({ files: state.files, settings: state.settings, productName: state.productName, requirements: state.requirements });
      dispatch({ type: "analysis_succeeded", analysis });
    } catch (error) {
      dispatch({ type: "analysis_failed", message: error instanceof Error ? error.message : "分析失败，请稍后重试" });
    }
  }

  return (
    <section className="p-4 md:p-6" aria-labelledby="studio-title">
      <h1 id="studio-title" className="text-2xl font-medium">一键生成主图与详情图组</h1>
      <ol aria-label="任务进度" className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">{["上传", "AI 分析", "确认规划", "生成", "完成"].map((label, index) => <li key={label} aria-current={index === activeStep ? "step" : undefined} className={index === activeStep ? "rounded-lg bg-violet-100 p-2 text-violet-700" : "rounded-lg bg-white p-2 text-black/55"}>{label}</li>)}</ol>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl bg-white p-4">
          <ImageUploader files={state.files} onFilesChanged={(files) => dispatch({ type: "files_changed", files })} />
          <label>产品名称<input value={state.productName} onChange={(event) => dispatch({ type: "text_changed", productName: event.currentTarget.value })} /></label>
          <label>补充要求<textarea value={state.requirements} onChange={(event) => dispatch({ type: "text_changed", requirements: event.currentTarget.value })} /></label>
          <GenerationSettingsForm value={state.settings} onChange={(patch) => dispatch({ type: "settings_changed", patch })} />
          <button type="button" onClick={() => void handleAnalyze()} disabled={state.phase === "analyzing"}>开始分析产品</button>
          {state.notice && <p role="alert">{state.notice}</p>}
        </div>
        <div className="rounded-xl bg-white p-4" aria-live="polite">
          {state.phase === "analyzing" ? <p>AI 正在分析产品…</p> : state.analysis ? <AnalysisPanel analysis={state.analysis} /> : <p>上传产品图并点击“开始分析产品”</p>}
        </div>
      </div>
    </section>
  );
}
```

```tsx
// app/product-studio/page.tsx
import { AppShell } from "@/components/app-shell";
import { ProductStudio } from "@/features/product-studio/components/product-studio";

export default function ProductStudioPage() {
  return <AppShell active="product-studio"><ProductStudio /></AppShell>;
}
```

`AnalysisPanel` displays category, product name, visual facts with their confidence labels, target audience, selling points with evidence, and visual direction. It must never relabel inferred content as observed fact.

- [ ] **Step 5: Verify analysis flow and responsive shell**

Run:

```powershell
npm test -- features/product-studio/components/product-studio.test.tsx
npm run lint
npm run build
```

Expected: test PASS, lint exits 0, and Next build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add features/product-studio/lib/client-api.ts features/product-studio/components/analysis-panel.tsx features/product-studio/components/product-studio.tsx features/product-studio/components/product-studio.test.tsx app/product-studio/page.tsx
git commit -m "feat: add product analysis workbench"
```

---

### Task 6: Add Editable Planning and Invalidation

**Files:**
- Create: `features/product-studio/components/plan-editor.tsx`
- Create: `features/product-studio/components/plan-editor.test.tsx`
- Modify: `features/product-studio/components/product-studio.tsx`
- Modify: `features/product-studio/components/product-studio.test.tsx`

**Interfaces:**
- Consumes: `ProductAnalysis`, `PlanItem`, and `plan_changed`/invalidation reducer actions.
- Produces: `PlanEditor({ analysis, onChange, onReplan, onConfirm })`.

- [ ] **Step 1: Write failing plan editor tests**

```tsx
// features/product-studio/components/plan-editor.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { PlanEditor } from "./plan-editor";
import { analysisWithTwoItems } from "../test-fixtures";

it("edits one prompt without changing the remaining plan items", async () => {
  const onChange = vi.fn();
  render(<PlanEditor analysis={analysisWithTwoItems} onChange={onChange} onReplan={vi.fn()} onConfirm={vi.fn()} />);
  const prompts = screen.getAllByLabelText(/生图提示词/);
  await userEvent.clear(prompts[0]);
  await userEvent.type(prompts[0], "新的白底主图提示词");
  const latest = onChange.mock.calls.at(-1)?.[0];
  expect(latest.plan[0].prompt).toBe("新的白底主图提示词");
  expect(latest.plan[1]).toEqual(analysisWithTwoItems.plan[1]);
});

it("does not confirm while any required plan field is blank", async () => {
  const onConfirm = vi.fn();
  render(<PlanEditor analysis={{ ...analysisWithTwoItems, plan: [{ ...analysisWithTwoItems.plan[0], prompt: "" }] }} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={onConfirm} />);
  expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeDisabled();
});

it("requests a complete new plan", async () => {
  const onReplan = vi.fn();
  render(<PlanEditor analysis={analysisWithTwoItems} onChange={vi.fn()} onReplan={onReplan} onConfirm={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "重新规划" }));
  expect(onReplan).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- features/product-studio/components/plan-editor.test.tsx`

Expected: FAIL because `PlanEditor` does not exist.

- [ ] **Step 3: Implement the plan editor**

Render one semantic article per plan item with labeled controls for type, title, objective, copy, scene, and prompt. Prompt labels use the exact accessible form `第 1 张生图提示词`, `第 2 张生图提示词`, and so on. `onChange` receives a complete new `ProductAnalysis`; do not mutate the input object. Render a `重新规划` button that calls `onReplan`; `ProductStudio` passes `handleAnalyze`, so the existing inputs are reanalyzed and the full plan is replaced. Disable confirmation unless every item passes `PlanItemSchema.safeParse`.

Use this immutable update:

```ts
function updateItem(index: number, patch: Partial<PlanItem>) {
  onChange({ ...analysis, plan: analysis.plan.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
}
```

In `ProductStudio`, render `PlanEditor` only during `reviewing_plan`, and dispatch `plan_changed` for edits. Changes to files, platform, language, ratio, or count must clear the analysis through the existing reducer and show its re-analysis notice.

- [ ] **Step 4: Add and run the invalidation UI test**

Extend `product-studio.test.tsx`: analyze successfully, change `生成数量`, then assert the plan editor disappears and `关键参数已变化，请重新分析产品` appears.

Run:

```powershell
npm test -- features/product-studio/components/plan-editor.test.tsx features/product-studio/components/product-studio.test.tsx
npm run lint
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add features/product-studio/components/plan-editor.tsx features/product-studio/components/plan-editor.test.tsx features/product-studio/components/product-studio.tsx features/product-studio/components/product-studio.test.tsx
git commit -m "feat: add editable generation plans"
```

---

### Task 7: Implement GPT Image Jobs and Secure Downloads

**Files:**
- Create: `lib/grsai/images.ts`
- Create: `lib/grsai/images.test.ts`
- Create: `lib/download-token.ts`
- Create: `lib/download-token.test.ts`
- Create: `app/api/product/generate/route.ts`
- Create: `app/api/product/generate/route.test.ts`
- Create: `app/api/product/jobs/[id]/route.ts`
- Create: `app/api/product/jobs/[id]/route.test.ts`
- Create: `app/api/product/download/route.ts`
- Create: `app/api/product/download/route.test.ts`

**Interfaces:**
- Consumes: `grsaiFetch`, `GenerationSettings`, `PlanItem`.
- Produces: `buildGenerationPrompt`, `submitImageGeneration`, `getImageGenerationResult`, `signDownloadUrl`, `verifyDownloadToken`, and three API routes.

- [ ] **Step 1: Write failing Grsai image normalization tests**

```ts
// lib/grsai/images.test.ts
import { beforeEach, expect, it, vi } from "vitest";
import { buildGenerationPrompt, getImageGenerationResult, submitImageGeneration } from "./images";
import { defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";

beforeEach(() => { process.env.GRSAI_API_KEY = "test-key"; });

it("adds product fidelity and text constraints to the confirmed plan", () => {
  const prompt = buildGenerationPrompt(makePlanItems(1)[0], { ...defaultSettings, language: "none" });
  expect(prompt).toContain("严格保持参考图中的产品结构、颜色、材质细节和 Logo");
  expect(prompt).toContain("画面中不要生成任何文字");
});

it("submits gpt-image-2 with reference images and JSON reply mode", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "job-1", status: "running" }), { status: 200 }));
  const job = await submitImageGeneration({ images: ["data:image/webp;base64,AA=="], prompt: "白底主图", aspectRatio: "1024x1024", quality: "auto" }, fetchImpl);
  const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(request).toMatchObject({ model: "gpt-image-2", images: ["data:image/webp;base64,AA=="], replyType: "json" });
  expect(job).toEqual({ id: "job-1", status: "running", progress: 0, results: [] });
});

it("normalizes a successful result query", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "job-1", status: "succeeded", results: [{ url: "https://cdn.example/result.png" }] }), { status: 200 }));
  expect(await getImageGenerationResult("job-1", fetchImpl)).toMatchObject({ status: "succeeded", progress: 100, results: [{ url: "https://cdn.example/result.png" }] });
});

it("maps provider moderation failure to a safe error", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "job-1", status: "failed", failure_reason: "input_moderation", error: "raw provider detail" }), { status: 200 }));
  await expect(getImageGenerationResult("job-1", fetchImpl)).rejects.toMatchObject({ code: "moderation", message: "图片未通过内容审核" });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- lib/grsai/images.test.ts`

Expected: FAIL because `images.ts` does not exist.

- [ ] **Step 3: Implement provider submission and status mapping**

Build the final prompt before calling the provider:

```ts
export function buildGenerationPrompt(item: PlanItem, settings: GenerationSettings) {
  return [
    "严格保持参考图中的产品结构、颜色、材质细节和 Logo，不改变 SKU 本体。",
    `图片类型：${item.type === "main" ? "商品主图" : "商品详情图"}。`,
    `任务目标：${item.objective}。场景：${item.scene}。`,
    item.copy ? `展示文案：${item.copy}。` : "",
    `用户确认的提示词：${item.prompt}。`,
    settings.language === "none" ? "画面中不要生成任何文字。" : `文案语言必须为 ${settings.language === "zh-CN" ? "中文" : "英文"}。`,
  ].filter(Boolean).join("\n");
}
```

Use `POST /v1/api/generate` with `{ model: "gpt-image-2", prompt, images, aspectRatio, quality, replyType: "json" }` and `GET /v1/api/result?id=${encodeURIComponent(id)}`.

Normalize both immediate and asynchronous responses to:

```ts
export type ProviderImageJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  progress: number;
  results: Array<{ url: string }>;
  error?: string;
};
```

Each plan item represents exactly one output image. If Grsai returns more than one `results` entry for a task, the job route uses the first entry and does not create extra unplanned cards.

Map `failure_reason: "input_moderation" | "output_moderation"` to `GrsaiError("moderation", "图片未通过内容审核", 422)`; preserve no raw upstream body.

- [ ] **Step 4: Write failing download token tests**

```ts
// lib/download-token.test.ts
import { expect, it } from "vitest";
import { signDownloadUrl, verifyDownloadToken } from "./download-token";

it("round trips an HTTPS result URL and rejects expiry or tampering", () => {
  const token = signDownloadUrl("https://cdn.example/result.png", "secret", 1_000, 60);
  expect(verifyDownloadToken(token, "secret", 1_030)).toBe("https://cdn.example/result.png");
  expect(() => verifyDownloadToken(`${token}x`, "secret", 1_030)).toThrow("下载令牌无效");
  expect(() => verifyDownloadToken(token, "secret", 1_061)).toThrow("下载令牌已过期");
});

it("refuses non-HTTPS URLs", () => {
  expect(() => signDownloadUrl("http://127.0.0.1/private", "secret", 1_000, 60)).toThrow("仅允许 HTTPS 图片地址");
});
```

- [ ] **Step 5: Implement stateless HMAC download tokens**

Use Node `crypto` and this token format:

```ts
type DownloadPayload = { url: string; exp: number };
// token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart))
```

`verifyDownloadToken` must split exactly two parts, compare signatures with `timingSafeEqual` only after checking equal byte lengths, parse the payload, require `https:`, and reject `exp < nowSeconds`. Default TTL is 15 minutes.

- [ ] **Step 6: Write failing route tests**

Use mocked provider functions and these concrete route tests:

```ts
// app/api/product/generate/route.test.ts
import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";
import { submitImageGeneration } from "@/lib/grsai/images";

vi.mock("@/lib/grsai/images", () => ({ submitImageGeneration: vi.fn() }));

function generationForm(imageCount: number) {
  const form = new FormData();
  for (let index = 0; index < imageCount; index++) form.append("images", new File(["x"], `${index}.webp`, { type: "image/webp" }));
  form.append("settings", JSON.stringify(defaultSettings));
  form.append("item", JSON.stringify(makePlanItems(1)[0]));
  return form;
}

it("rejects zero and more than six normalized images", async () => {
  expect((await POST(new Request("http://localhost/api/product/generate", { method: "POST", body: generationForm(0) }))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/product/generate", { method: "POST", body: generationForm(7) }))).status).toBe(400);
});

it("returns a normalized task with the caller plan item id", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({ id: "job-1", status: "running", progress: 0, results: [] });
  const response = await POST(new Request("http://localhost/api/product/generate", { method: "POST", body: generationForm(1) }));
  expect(await response.json()).toEqual({ task: { planItemId: "1", providerJobId: "job-1", status: "running", progress: 0 } });
});
```

```ts
// app/api/product/jobs/[id]/route.test.ts
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getImageGenerationResult } from "@/lib/grsai/images";
import { signDownloadUrl } from "@/lib/download-token";

vi.mock("@/lib/grsai/images", () => ({ getImageGenerationResult: vi.fn() }));
vi.mock("@/lib/download-token", () => ({ signDownloadUrl: vi.fn(() => "signed-token") }));
beforeEach(() => { process.env.DOWNLOAD_TOKEN_SECRET = "test-secret"; });

it("signs only successful result URLs", async () => {
  vi.mocked(getImageGenerationResult).mockResolvedValue({ id: "job-1", status: "succeeded", progress: 100, results: [{ url: "https://cdn.example/result.png" }] });
  const response = await GET(new Request("http://localhost/api/product/jobs/job-1"), { params: Promise.resolve({ id: "job-1" }) });
  expect(signDownloadUrl).toHaveBeenCalledWith("https://cdn.example/result.png", expect.any(String));
  expect(await response.json()).toMatchObject({ task: { providerJobId: "job-1", status: "succeeded", downloadToken: "signed-token" } });
});
```

```ts
// app/api/product/download/route.test.ts
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { verifyDownloadToken } from "@/lib/download-token";

vi.mock("@/lib/download-token", () => ({ verifyDownloadToken: vi.fn() }));
beforeEach(() => { process.env.DOWNLOAD_TOKEN_SECRET = "test-secret"; });

it("rejects an invalid token", async () => {
  vi.mocked(verifyDownloadToken).mockImplementation(() => { throw new Error("下载令牌无效"); });
  const response = await GET(new Request("http://localhost/api/product/download?token=bad"));
  expect(response.status).toBe(400);
});

it("downloads the signed image without following redirects", async () => {
  vi.mocked(verifyDownloadToken).mockReturnValue("https://cdn.example/result.png");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } }));
  const response = await GET(new Request("http://localhost/api/product/download?token=good"));
  expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/result.png", expect.objectContaining({ redirect: "error" }));
  expect(response.headers.get("Content-Disposition")).toContain("attachment");
});
```

- [ ] **Step 7: Implement the three routes**

`POST /api/product/generate` accepts multipart fields `images`, `settings`, and `item`. Validate with `GenerationSettingsSchema` and `PlanItemSchema`, convert files to data URLs, call `buildGenerationPrompt(item, settings)`, and pass that final prompt to `submitImageGeneration`.

`GET /api/product/jobs/[id]` calls `getImageGenerationResult`. For each successful result URL, return:

```ts
{
  url,
  downloadToken: signDownloadUrl(url, process.env.DOWNLOAD_TOKEN_SECRET!),
}
```

Return status 503 with a safe message when either required secret is absent.

`GET /api/product/download?token=...` verifies the token, fetches the exact HTTPS URL with a 30-second timeout and `redirect: "error"`, requires an `image/*` response type, and streams the bytes with a sanitized filename.

- [ ] **Step 8: Verify provider and route tests**

Run:

```powershell
npm test -- lib/grsai/images.test.ts lib/download-token.test.ts app/api/product/generate/route.test.ts 'app/api/product/jobs/[id]/route.test.ts' app/api/product/download/route.test.ts
npm run lint
```

Expected: all tests PASS; no network calls occur.

- [ ] **Step 9: Commit**

```powershell
git add lib/grsai/images.ts lib/grsai/images.test.ts lib/download-token.ts lib/download-token.test.ts app/api/product/generate app/api/product/jobs app/api/product/download
git commit -m "feat: add image generation jobs"
```

---

### Task 8: Add the Three-Job Generation Runner

**Files:**
- Create: `features/product-studio/lib/generation-runner.ts`
- Create: `features/product-studio/lib/generation-runner.test.ts`
- Modify: `features/product-studio/lib/client-api.ts`

**Interfaces:**
- Consumes: `GenerationSettings`, `PlanItem`, `GenerationTask`, generation/status API routes.
- Produces: `submitGenerationClient`, `getGenerationStatusClient`, `pollGenerationJob`, `runGenerationBatch`.

- [ ] **Step 1: Write failing concurrency and polling tests**

```ts
// features/product-studio/lib/generation-runner.test.ts
import { expect, it, vi } from "vitest";
import { runGenerationBatch } from "./generation-runner";
import { defaultSettings, makeImageFile, makePlanItems } from "../test-fixtures";
import type { PlanItem } from "../model";

const file = makeImageFile();
const settings = { ...defaultSettings, imageCount: 6 };
const sixPlanItems = makePlanItems(6);
const onePlanItem = makePlanItems(1)[0];

it("never runs more than three provider jobs at once", async () => {
  let active = 0;
  let maximum = 0;
  const api = {
    submit: vi.fn(async ({ item }: { item: PlanItem }) => ({ planItemId: item.id, providerJobId: `job-${item.id}`, status: "running" as const, progress: 0 })),
    status: vi.fn(async (jobId: string, planItemId: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: `https://cdn/${jobId}.png`, downloadToken: "token" };
    }),
  };
  await runGenerationBatch({ items: sixPlanItems, files: [file], settings, api, onTaskChange: vi.fn(), sleep: vi.fn() });
  expect(maximum).toBeLessThanOrEqual(3);
});

it("marks a job timed_out without resubmitting it", async () => {
  const api = { submit: vi.fn().mockResolvedValue({ planItemId: "1", providerJobId: "job-1", status: "running" as const, progress: 0 }), status: vi.fn().mockResolvedValue({ planItemId: "1", providerJobId: "job-1", status: "running" as const, progress: 50 }) };
  const changes: unknown[] = [];
  await runGenerationBatch({ items: [onePlanItem], files: [file], settings, api, onTaskChange: (task) => changes.push(task), sleep: vi.fn(), timeoutMs: 1, now: (() => { let value = 0; return () => value += 2; })() });
  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(changes.at(-1)).toMatchObject({ status: "timed_out", providerJobId: "job-1" });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- features/product-studio/lib/generation-runner.test.ts`

Expected: FAIL because `generation-runner.ts` does not exist.

- [ ] **Step 3: Implement typed generation/status clients**

`submitGenerationClient` builds multipart form data and returns a `GenerationTask`. `getGenerationStatusClient(jobId, planItemId)` fetches `/api/product/jobs/${encodeURIComponent(jobId)}`, parses the provider task fields with Zod, and adds the caller-owned `planItemId` before returning. The job route never needs to know the plan item ID.

```ts
// Add to features/product-studio/lib/client-api.ts
import { GenerationTaskSchema, type GenerationTask, type PlanItem } from "../model";

export type ProductStudioApi = ProductStudioAnalysisApi & {
  submit: (input: { files: File[]; settings: GenerationSettings; item: PlanItem }) => Promise<GenerationTask>;
  status: (jobId: string, planItemId: string) => Promise<GenerationTask>;
};

export async function submitGenerationClient(input: { files: File[]; settings: GenerationSettings; item: PlanItem }) {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("item", JSON.stringify(input.item));
  const response = await fetch("/api/product/generate", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "提交生图任务失败");
  return GenerationTaskSchema.parse(body.task);
}

export async function getGenerationStatusClient(jobId: string, planItemId: string) {
  const response = await fetch(`/api/product/jobs/${encodeURIComponent(jobId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "查询生图任务失败");
  return GenerationTaskSchema.parse({ ...body.task, planItemId });
}
```

- [ ] **Step 4: Implement the batch runner**

Use a shared worker index and exactly three workers:

```ts
const workerCount = Math.min(3, items.length);
let nextIndex = 0;
async function worker() {
  while (nextIndex < items.length && !signal?.aborted) {
    const item = items[nextIndex++];
    await runOne(item);
  }
}
await Promise.all(Array.from({ length: workerCount }, worker));
```

`runOne` emits `submitting`, calls `api.submit` exactly once, then calls `api.status(providerJobId, item.id)` at least once even if submission reports immediate success, because only the status route signs download tokens. While status remains `running`, poll with delays `2000, 4000, 8000, 8000...` milliseconds. Emit each normalized state. On 10-minute timeout emit `timed_out` while retaining `providerJobId`; never automatically submit a replacement job. An exception emits `failed` only for that item and lets other workers continue.

Export the polling portion separately with this interface so a timed-out task can resume without a second submission:

```ts
export async function pollGenerationJob(input: {
  providerJobId: string;
  planItemId: string;
  api: Pick<ProductStudioApi, "status">;
  onTaskChange: (task: GenerationTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<GenerationTask>;
```

- [ ] **Step 5: Verify runner behavior**

Run:

```powershell
npm test -- features/product-studio/lib/generation-runner.test.ts
npm run lint
```

Expected: maximum concurrency is 3, timeout preserves the provider ID, and all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add features/product-studio/lib/generation-runner.ts features/product-studio/lib/generation-runner.test.ts features/product-studio/lib/client-api.ts
git commit -m "feat: add bounded image generation runner"
```

---

### Task 9: Display Results, Retry Failures, and Download ZIPs

**Files:**
- Create: `features/product-studio/lib/downloads.ts`
- Create: `features/product-studio/lib/downloads.test.ts`
- Create: `features/product-studio/components/result-card.tsx`
- Create: `features/product-studio/components/result-card.test.tsx`
- Create: `features/product-studio/components/generation-grid.tsx`
- Create: `features/product-studio/components/generation-grid.test.tsx`
- Modify: `features/product-studio/components/product-studio.tsx`
- Modify: `features/product-studio/components/product-studio.test.tsx`

**Interfaces:**
- Consumes: `GenerationTask`, `PlanItem`, `runGenerationBatch`, download route.
- Produces: `downloadResult`, `createResultsZip`, `ResultCard`, `GenerationGrid`, retry and download behavior in `ProductStudio`.

- [ ] **Step 1: Write failing ZIP tests**

```ts
// features/product-studio/lib/downloads.test.ts
import JSZip from "jszip";
import { expect, it, vi } from "vitest";
import { createResultsZip } from "./downloads";

it("adds only successful results to the ZIP", async () => {
  const fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
  const blob = await createResultsZip([
    { planItemId: "1", status: "succeeded", progress: 100, downloadToken: "a" },
    { planItemId: "2", status: "failed", progress: 0, error: "failed" },
  ], fetchBlob);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(["product-01.png"]);
  expect(fetchBlob).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- features/product-studio/lib/downloads.test.ts`

Expected: FAIL because `downloads.ts` does not exist.

- [ ] **Step 3: Implement secure browser downloads**

```ts
// features/product-studio/lib/downloads.ts
import JSZip from "jszip";
import type { GenerationTask } from "../model";

export async function fetchResultBlob(token: string) {
  const response = await fetch(`/api/product/download?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("图片下载失败，请重试");
  return response.blob();
}

export async function createResultsZip(tasks: GenerationTask[], fetchBlob = fetchResultBlob) {
  const zip = new JSZip();
  const successful = tasks.filter((task) => task.status === "succeeded" && task.downloadToken);
  await Promise.all(successful.map(async (task, index) => zip.file(`product-${String(index + 1).padStart(2, "0")}.png`, await fetchBlob(task.downloadToken!))));
  return zip.generateAsync({ type: "blob" });
}
```

Add `downloadResult(token, filename)` and `downloadAllResults(tasks)` helpers that create an object URL, click a temporary `<a download>`, then revoke the URL.

- [ ] **Step 4: Write failing result component tests**

Use these concrete component tests:

```tsx
// features/product-studio/components/result-card.test.tsx
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { makePlanItems } from "../test-fixtures";
import { ResultCard } from "./result-card";

const item = makePlanItems(1)[0];
const handlers = { onRetry: vi.fn(), onContinuePolling: vi.fn(), onDownload: vi.fn() };

it.each([
  ["queued", "等待生成"],
  ["submitting", "正在提交"],
  ["running", "生成中"],
] as const)("shows %s task status", (status, label) => {
  render(<ResultCard item={item} task={{ planItemId: item.id, status, progress: 40 }} {...handlers} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});

it("shows the result and download after success", () => {
  render(<ResultCard item={item} task={{ planItemId: item.id, status: "succeeded", progress: 100, resultUrl: "https://cdn.example/result.png", downloadToken: "token" }} {...handlers} />);
  expect(screen.getByRole("img", { name: "生成结果：白底主图" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看大图" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "下载" })).toBeEnabled();
});

it("offers retry for failure and continuing lookup for timeout", () => {
  const { rerender } = render(<ResultCard item={item} task={{ planItemId: item.id, status: "failed", progress: 0, error: "积分不足" }} {...handlers} />);
  expect(screen.getByRole("alert")).toHaveTextContent("积分不足");
  expect(screen.getByRole("button", { name: "重试此图" })).toBeEnabled();
  rerender(<ResultCard item={item} task={{ planItemId: item.id, providerJobId: "job-1", status: "timed_out", progress: 50 }} {...handlers} />);
  expect(screen.getByRole("button", { name: "继续查询" })).toBeEnabled();
  expect(screen.queryByText("生成失败")).not.toBeInTheDocument();
});
```

```tsx
// features/product-studio/components/generation-grid.test.tsx
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { analysisWithTwoItems } from "../test-fixtures";
import { GenerationGrid } from "./generation-grid";

it("enables bulk download when at least one task succeeded", () => {
  render(<GenerationGrid items={analysisWithTwoItems.plan} tasks={[
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/1.png", downloadToken: "token" },
    { planItemId: "2", status: "failed", progress: 0, error: "失败" },
  ]} onRetry={vi.fn()} onContinuePolling={vi.fn()} onDownload={vi.fn()} onDownloadAll={vi.fn()} />);
  expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
});
```

- [ ] **Step 5: Implement result components and studio orchestration**

`ResultCard` receives `{ item, task, onRetry, onContinuePolling, onDownload }`. Use an actual `<progress max={100} value={task.progress}>` while running, an `<img>` only after success, and a visible error message with `role="alert"` after failure. The successful state also has a `查看大图` button that opens a native `<dialog>` containing the same result at full available size; closing the dialog returns focus to the trigger.

`GenerationGrid` joins tasks to plan items by `planItemId` and exposes one bulk-download button.

In `ProductStudio`, confirmation creates one queued task per plan item, dispatches `generation_started`, calls `runGenerationBatch`, dispatches every `task_changed`, then dispatches `generation_completed`. Retry passes only the failed plan item to `runGenerationBatch`. Continue-polling calls `pollGenerationJob` with the retained provider job ID and never calls `api.submit`.

Replace the analysis-only default API from Task 5 with the completed client API:

```ts
const defaultProductStudioApi: ProductStudioApi = {
  analyze: analyzeProductClient,
  submit: submitGenerationClient,
  status: getGenerationStatusClient,
};
```

Change the existing `ProductStudio` parameter to `{ api = defaultProductStudioApi }: { api?: ProductStudioApi }` and add these handlers:

```ts
async function handleGenerate() {
  if (!state.analysis) return;
  dispatch({ type: "generation_started", tasks: state.analysis.plan.map((item) => ({ planItemId: item.id, status: "queued", progress: 0 })) });
  await runGenerationBatch({ items: state.analysis.plan, files: state.files, settings: state.settings, api, onTaskChange: (task) => dispatch({ type: "task_changed", task }) });
  dispatch({ type: "generation_completed" });
}

async function handleRetry(item: PlanItem) {
  await runGenerationBatch({ items: [item], files: state.files, settings: state.settings, api, onTaskChange: (task) => dispatch({ type: "task_changed", task }) });
  dispatch({ type: "generation_completed" });
}

async function handleContinuePolling(task: GenerationTask) {
  if (!task.providerJobId) return;
  await pollGenerationJob({ providerJobId: task.providerJobId, planItemId: task.planItemId, api, onTaskChange: (next) => dispatch({ type: "task_changed", task: next }) });
  dispatch({ type: "generation_completed" });
}
```

Wire `PlanEditor.onConfirm` to `handleGenerate`, `GenerationGrid.onRetry` to `handleRetry`, and `GenerationGrid.onContinuePolling` to `handleContinuePolling`. The Task 5 analysis handler remains unchanged.

- [ ] **Step 6: Add the full mocked component flow test**

Extend `product-studio.test.tsx` with this two-item flow:

```tsx
it("keeps successful images and retries only the failed plan item", async () => {
  let submission = 0;
  const submit = vi.fn(async ({ item }: { item: PlanItem }) => ({ planItemId: item.id, providerJobId: `job-${++submission}`, status: "running" as const, progress: 0 }));
  const status = vi.fn(async (jobId: string, planItemId: string) => {
    if (jobId === "job-2") return { planItemId, providerJobId: jobId, status: "failed" as const, progress: 0, error: "上游生成失败" };
    return { planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: `https://cdn.example/${jobId}.png`, downloadToken: `token-${jobId}` };
  });
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(analysisWithTwoItems), submit, status }} />);
  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await userEvent.click(await screen.findByRole("button", { name: "重试此图" }));
  expect(await screen.findAllByRole("img", { name: /生成结果/ })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
  expect(submit).toHaveBeenCalledTimes(3);
});
```

Import `PlanItem` and `analysisWithTwoItems` from the Task 2 files. The existing image-preprocessing mock remains active, so this test performs no canvas work and no network request.

- [ ] **Step 7: Verify result behavior**

Run:

```powershell
npm test -- features/product-studio/lib/downloads.test.ts features/product-studio/components/result-card.test.tsx features/product-studio/components/generation-grid.test.tsx features/product-studio/components/product-studio.test.tsx
npm run lint
npm run build
```

Expected: all tests PASS, lint exits 0, build succeeds.

- [ ] **Step 8: Commit**

```powershell
git add features/product-studio
git commit -m "feat: add generation results and downloads"
```

---

### Task 10: Add Browser Flow Coverage and Local Setup Documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/product-studio.spec.ts`
- Create: `.env.example`
- Create: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: completed product studio and all local API endpoints.
- Produces: a two-image mocked browser test and exact local/real-smoke instructions.

- [ ] **Step 1: Add Playwright configuration**

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Run once: `npx playwright install chromium`

Expected: Chromium installs successfully.

- [ ] **Step 2: Write the failing mocked browser test**

```ts
// tests/e2e/product-studio.spec.ts
import { expect, test } from "@playwright/test";
import { analysisWithTwoItems } from "../../features/product-studio/test-fixtures";

test("completes a two-image product workflow without real API calls", async ({ page }) => {
  await page.route("**/api/product/analyze", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analysis: analysisWithTwoItems }) }));
  let submitted = 0;
  await page.route("**/api/product/generate", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task: { planItemId: String(++submitted), providerJobId: `job-${submitted}`, status: "running", progress: 0 } }) }));
  await page.route("**/api/product/jobs/*", (route) => {
    const id = route.request().url().split("/").at(-1)!;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task: { planItemId: id.replace("job-", ""), providerJobId: id, status: "succeeded", progress: 100, resultUrl: `data:image/png;base64,iVBORw0KGgo=`, downloadToken: `token-${id}` } }) });
  });

  await page.goto("/product-studio");
  await page.getByLabel("上传产品图").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPj8AAAAASUVORK5CYII=", "base64") });
  await page.getByLabel("生成数量").selectOption("2");
  await page.getByRole("button", { name: "开始分析产品" }).click();
  await expect(page.getByRole("button", { name: "确认规划并生成" })).toBeEnabled();
  await page.getByLabel("第 1 张生图提示词").fill("调整后的白底主图提示词");
  await page.getByRole("button", { name: "确认规划并生成" }).click();
  await expect(page.getByRole("img", { name: /生成结果/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "下载全部" })).toBeEnabled();
  expect(submitted).toBe(2);
});
```

The imported Task 2 fixture supplies both valid plan items and keeps the browser test aligned with `ProductAnalysisSchema`.

- [ ] **Step 3: Run the browser test and fix only product code defects**

Run: `npm run test:e2e -- tests/e2e/product-studio.spec.ts`

Expected initially: FAIL on the first missing/incorrect accessible contract. Make the smallest product-code correction required, rerun, and stop when PASS. Do not weaken selectors or bypass image-count behavior.

- [ ] **Step 4: Add safe environment documentation**

```dotenv
# .env.example
GRSAI_BASE_URL=https://grsai.dakka.com.cn
GRSAI_API_KEY=
DOWNLOAD_TOKEN_SECRET=
```

Ensure `.gitignore` contains `.env`, `.env.local`, `.env.*.local`, `playwright-report/`, and `test-results/` while allowing `.env.example`.

`README.md` must include these exact workflows:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

It must tell the user to edit `.env.local` locally, never paste keys into chat or commit them, open `http://localhost:3000/product-studio`, and use one image with generation count `1` for the real smoke test.

- [ ] **Step 5: Run the complete automated verification suite**

Run:

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: all Vitest tests PASS, lint exits 0, Next build succeeds, and the two-image mocked Playwright flow PASSes without any Grsai network request.

- [ ] **Step 6: Verify secrets are absent from client assets**

After `npm run build`, run:

```powershell
rg -n "GRSAI_API_KEY|DOWNLOAD_TOKEN_SECRET|Bearer sk-" .next/static
```

Expected: no matches.

- [ ] **Step 7: Run the one-image real smoke test**

Prerequisite: the user has populated `.env.local` with their own Grsai API Key and a random `DOWNLOAD_TOKEN_SECRET` on their machine.

Run `npm run dev`, open `/product-studio`, upload one valid product image, set `生成数量` to `1`, analyze, review the single plan, generate, and download the result.

Expected:

- Gemini analysis returns one valid plan item.
- Exactly one GPT Image 2 job is submitted.
- The job reaches `succeeded`.
- The result previews and downloads successfully.
- No second real generation is performed.

- [ ] **Step 8: Commit**

```powershell
git add playwright.config.ts tests/e2e/product-studio.spec.ts .env.example README.md .gitignore
git commit -m "test: verify product studio workflow"
```

---

## Final Acceptance Check

- [ ] `npm test` passes with mocked provider calls only.
- [ ] `npm run lint` exits 0.
- [ ] `npm run build` succeeds.
- [ ] `npm run test:e2e` passes with two mocked generated images.
- [ ] A manual real smoke test generates and downloads exactly one image.
- [ ] Upload accepts 1–6 JPG/PNG/WEBP images and rejects invalid inputs visibly.
- [ ] Analysis returns exactly the selected count from 1–16 and the plan is editable.
- [ ] Key input changes invalidate the existing analysis and plan.
- [ ] Generation concurrency never exceeds 3.
- [ ] Failure and timeout states can retry or continue querying without resubmitting successful jobs.
- [ ] Individual and ZIP downloads use signed short-lived tokens.
- [ ] Client assets contain neither secret name/value nor a Bearer API key.
