# 全品类商品图重试与 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复失败图片重试缺少反馈的问题，并把全品类商品图页面升级为紧凑的浅色双栏工作台。

**Architecture:** 保留现有 Next.js、React reducer、Grsai 适配和单次生成锁，只在现有组件边界内补充重试状态与视觉结构。先用 Figma 建立两张桌面状态稿并验证，再以同一布局和设计变量修改 Tailwind 类名；上传逻辑不变，只调整呈现为缩略图。

**Tech Stack:** Next.js App Router、React、TypeScript、Tailwind CSS、Vitest、Testing Library、Playwright、Figma。

**Spec:** `docs/superpowers/specs/2026-08-26-product-studio-ui-refresh-design.md`

## Global Constraints

- 保留单次生成操作锁，禁止并行重复重试。
- 不修改 Grsai 请求契约、生成并发上限或下载逻辑。
- 首版只实现浅色主题。
- 不新增账户、积分、商城、历史任务、保存进度或服装组图功能。
- 上传仍支持 1–6 张 JPG、PNG、WEBP，现有预处理和校验不变。
- 图片数量仍为 1–16。
- 使用项目现有字体栈，不引入网络字体或额外 UI 依赖。
- 不改动用户未跟踪的 `AGENTS.md`、`CLAUDE.md`。

---

### Task 1: 修复失败卡片的重试反馈

**Files:**
- Modify: `features/product-studio/components/product-studio.tsx`
- Modify: `features/product-studio/components/generation-grid.tsx`
- Modify: `features/product-studio/components/result-card.tsx`
- Test: `features/product-studio/components/product-studio.test.tsx`
- Test: `features/product-studio/components/result-card.test.tsx`

**Interfaces:**
- Consumes: `GenerationTask`, `PlanItem`, `runGenerationBatch` 和现有页面级 `generationBusy` 锁。
- Produces: `ResultCard` 新增 `retrying?: boolean`；`GenerationGrid` 新增 `retryingItemId?: string | null`，只影响展示文案。

- [ ] **Step 1: 写出失败测试**

在 `result-card.test.tsx` 增加忙碌原因断言：

```tsx
it("explains why retry is unavailable while another generation operation is busy", () => {
  render(
    <ResultCard
      item={item}
      task={{ planItemId: item.id, status: "failed", progress: 0, error: "网络失败" }}
      {...handlers}
      busy
    />,
  );
  expect(screen.getByRole("button", { name: "重试此图" })).toBeDisabled();
  expect(screen.getByText("当前批次生成中，完成后可重试")).toBeInTheDocument();
});
```

在 `product-studio.test.tsx` 的延迟重试场景中，点击后断言卡片立即显示 `正在重新提交…`，并保持 `submit` 只增加一次。

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```powershell
npm test -- features/product-studio/components/result-card.test.tsx features/product-studio/components/product-studio.test.tsx
```

Expected: FAIL，因为忙碌原因和重试专用文案尚不存在。

- [ ] **Step 3: 实现最小重试状态**

在 `ProductStudio` 增加：

```tsx
const [retryingItemId, setRetryingItemId] = useState<string | null>(null);

async function handleRetry(item: PlanItem) {
  await runGenerationOperation(async (operationId) => {
    setRetryingItemId(item.id);
    try {
      await runGenerationBatch({
        items: [item],
        files: state.files,
        settings: state.settings,
        api,
        onTaskChange: (task) => {
          if (operationId === generationEpochRef.current) dispatch({ type: "task_changed", task });
        },
      });
    } finally {
      setRetryingItemId(null);
    }
  });
}
```

将 ID 传入 `GenerationGrid`，再传给对应 `ResultCard`。`ResultCard` 在 `retrying && task.status === "submitting"` 时显示「正在重新提交…」，并在失败且 `busy` 时显示「当前批次生成中，完成后可重试」。不删除 `disabled={busy}`。

- [ ] **Step 4: 运行重试相关测试并确认绿灯**

Run:

```powershell
npm test -- features/product-studio/components/result-card.test.tsx features/product-studio/components/generation-grid.test.tsx features/product-studio/components/product-studio.test.tsx
```

Expected: PASS，延迟重试只产生一次提交，按钮禁用原因可见。

- [ ] **Step 5: 提交重试修复**

```powershell
git add features/product-studio/components/product-studio.tsx features/product-studio/components/generation-grid.tsx features/product-studio/components/result-card.tsx features/product-studio/components/product-studio.test.tsx features/product-studio/components/result-card.test.tsx
git commit -m "fix: clarify image retry progress"
```

---

### Task 2: 创建并验证 Figma 浅色工作台

**Files:**
- External artifact: Figma file `电商生图工作台 UI`
- Reference: running page `http://127.0.0.1:3000/product-studio`

**Interfaces:**
- Consumes: 已确认规格、两张用户参考截图和当前本地页面。
- Produces: 两个 1440 像素桌面画板「上传与分析」「生成结果」，供 Task 4 对照实现。

- [ ] **Step 1: 建立 Figma 文件并检查现有设计资源**

先调用 `figma_whoami` 确定工作区，再新建设计文件「电商生图工作台 UI」。检查新文件页面、组件、变量和已发布设计系统；空文件不臆造已有组件。

- [ ] **Step 2: 捕获当前网页作为同文件参考**

使用 Figma 网页捕获能力把本地 `/product-studio` 放入同一文件的参考区域。捕获内容仅用于对照，最终交付前删除或移动到明确命名的参考页。

- [ ] **Step 3: 分段建立浅色工作台**

按以下固定尺寸和结构建立画板：

```text
画板：1440 × 1024
页面背景：#F5F6F8
顶栏：64px，高亮文字 #17191D
内容最大宽度：1320px
左栏：360px
栏间距：20px
面板：白色，12px 圆角，#E4E7EC 边框
主按钮：#17191D，白字
强调色：#6D5CE7，仅用于当前步骤和小面积状态
上传缩略图：96 × 96px
```

先建外壳和标题区，再建左栏上传/输入组件，最后建右栏状态区和结果卡片。每个 Figma 写入调用最多完成一个区域，并返回全部节点 ID。

- [ ] **Step 4: 验证两个画板**

逐张截图检查：无裁切文本、无重叠、左右栏宽度正确、上传缩略图不超过 96 像素、结果区同时展示成功/失败/生成中状态。修正后保留最终节点 ID 与文件链接。

---

### Task 3: 将上传预览改为紧凑缩略图

**Files:**
- Modify: `features/product-studio/components/image-uploader.tsx`
- Test: `features/product-studio/components/image-uploader.test.tsx`

**Interfaces:**
- Consumes: 现有 `files`, `onFilesChanged`, `disabled`, `preprocessProductImage`。
- Produces: 相同组件 API；新增可访问的「已选产品图」列表和 96 像素预览。

- [ ] **Step 1: 写出失败测试**

```tsx
it("renders selected files as compact thumbnails that can be removed", async () => {
  const onFilesChanged = vi.fn();
  const file = new File(["x"], "cup.png", { type: "image/png" });
  render(<ImageUploader files={[file]} onFilesChanged={onFilesChanged} />);

  expect(screen.getByRole("list", { name: "已选产品图" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "cup.png" })).toHaveClass("size-24");
  await userEvent.click(screen.getByRole("button", { name: "移除 cup.png" }));
  expect(onFilesChanged).toHaveBeenCalledWith([]);
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npm test -- features/product-studio/components/image-uploader.test.tsx`

Expected: FAIL，因为现有预览没有列表语义和固定尺寸。

- [ ] **Step 3: 实现紧凑上传卡**

保留文件输入和预处理函数，只调整标记与类名：文件输入视觉隐藏并由上传卡标签触发；已选文件使用 `role="list"` 的网格；预览图片使用 `size-24 rounded-xl object-cover`；删除按钮位于缩略图右上角；文件名和大小放在缩略图下方并单行省略。

- [ ] **Step 4: 运行上传测试并提交**

Run: `npm test -- features/product-studio/components/image-uploader.test.tsx`

Expected: PASS，原有超限错误测试保持通过。

```powershell
git add features/product-studio/components/image-uploader.tsx features/product-studio/components/image-uploader.test.tsx
git commit -m "feat: compact product image previews"
```

---

### Task 4: 按 Figma 稿落地浅色双栏工作台

**Files:**
- Modify: `components/app-shell.tsx`
- Modify: `components/app-shell.test.tsx`
- Modify: `app/globals.css`
- Modify: `features/product-studio/components/product-studio.tsx`
- Modify: `features/product-studio/components/generation-settings.tsx`
- Modify: `features/product-studio/components/analysis-panel.tsx`
- Modify: `features/product-studio/components/plan-editor.tsx`
- Modify: `features/product-studio/components/generation-grid.tsx`
- Modify: `features/product-studio/components/result-card.tsx`
- Test: existing component tests

**Interfaces:**
- Consumes: Task 2 Figma 尺寸、Task 3 紧凑上传组件、现有 reducer/API handlers。
- Produces: 视觉更新后的现有页面；组件 props、业务状态和可访问名称保持兼容。

- [ ] **Step 1: 增加结构性页面断言**

在现有组件测试中断言「商品视觉工作台」「项目配置」「创作工作台」三个区域存在；`AppShell` 继续高亮「全品类商品图」并显示「本地模式」。

- [ ] **Step 2: 运行相关测试并确认红灯**

Run:

```powershell
npm test -- components/app-shell.test.tsx features/product-studio/components/product-studio.test.tsx
```

Expected: FAIL，因为新区域标题尚未落地。

- [ ] **Step 3: 实现应用外壳和工作台骨架**

`AppShell` 使用 64 像素白色顶栏、紧凑模块导航和满宽浅灰内容区。`ProductStudio` 使用 `mx-auto max-w-[1320px]` 容器、标题/副标题、紧凑步骤条和 `xl:grid-cols-[360px_minmax(0,1fr)]` 双栏。

- [ ] **Step 4: 统一表单、分析、规划和结果样式**

所有表单控件使用统一 40 像素高度、浅灰边框和可见焦点；文本域保持自适应高度。分析信息使用浅灰分组卡；规划条目使用细边框卡；结果卡使用一致标题、状态、操作和图片比例。主按钮统一近黑底，紫色仅用于步骤点和轻量状态。

- [ ] **Step 5: 运行组件测试并修复回归**

Run:

```powershell
npm test -- components/app-shell.test.tsx features/product-studio/components
```

Expected: PASS，所有既有可访问名称和流程保持不变。

- [ ] **Step 6: 提交 UI 落地**

```powershell
git add app/globals.css components/app-shell.tsx components/app-shell.test.tsx features/product-studio/components
git commit -m "feat: refresh product studio workspace UI"
```

---

### Task 5: 完整验证与本地视觉检查

**Files:**
- Modify only if verification exposes a scoped defect.

**Interfaces:**
- Consumes: Tasks 1–4 完整实现。
- Produces: 可重复的自动化通过记录和本地桌面/窄屏视觉确认。

- [ ] **Step 1: 运行完整自动化验证**

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

Expected: 全部命令退出码为 0；自动化请求均为模拟请求，不消耗 Grsai 积分。

- [ ] **Step 2: 检查敏感信息未进入客户端**

```powershell
rg -n "GRSAI_API_KEY|DOWNLOAD_TOKEN_SECRET|Bearer sk-" .next/static
```

Expected: 无匹配。

- [ ] **Step 3: 本地浏览器视觉验证**

在 `http://127.0.0.1:3000/product-studio` 检查 1440 像素桌面宽度和约 768 像素窄屏：上传预览保持 96 像素；桌面双栏、窄屏单栏；重试按钮禁用原因可见；无横向溢出、遮挡或裁切。

- [ ] **Step 4: 检查最终工作区**

Run: `git status --short`

Expected: 只保留用户原有未跟踪文件 `AGENTS.md`、`CLAUDE.md`，没有测试或构建产生的意外文件。
