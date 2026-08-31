import { expect, test } from "@playwright/test";
import { analysisWithTwoItems } from "../../features/product-studio/test-fixtures";
import type { GenerationSettings, PlanItem } from "../../features/product-studio/model";

const testOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`;

function parseMultipartJsonField<T>(body: string, fieldName: string): T {
  return JSON.parse(parseMultipartTextField(body, fieldName)) as T;
}

function parseMultipartTextField(body: string, fieldName: string): string {
  const fieldStart = body.indexOf(`name="${fieldName}"`);
  expect(fieldStart).toBeGreaterThanOrEqual(0);
  const valueStart = body.indexOf("\r\n\r\n", fieldStart);
  expect(valueStart).toBeGreaterThan(fieldStart);
  const valueEnd = body.indexOf("\r\n--", valueStart + 4);
  expect(valueEnd).toBeGreaterThan(valueStart);
  return body.slice(valueStart + 4, valueEnd);
}

test("completes a two-image product workflow without real API calls", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
  });
  const productPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPj8AAAAASUVORK5CYII=", "base64");
  const workflowAnalysis = {
    ...analysisWithTwoItems,
    plan: [
      { ...analysisWithTwoItems.plan[0], title: "白底商品主图" },
      {
        ...analysisWithTwoItems.plan[1],
        title: "尺寸标注图",
        objective: "展示产品尺寸",
        scene: "纯白背景摄影棚，商品以 3/4 立体视角完整居中展示，四周留出标注空间",
        prompt: "生成完整的 3/4 立体视角商品底图，整张画布使用纯白背景，商品居中且四周留出标注空间；不生成任何文字、数字、单位、尺寸线、箭头或侧边面板。",
        annotations: [{ id: "height", label: "Высота чашки", displayValue: "12 см" }],
      },
    ],
  };
  const opaqueJobTokens = [
    "v1.b3BhcXVlLW5vbmNlLWFscGhh.sig+blue/opaque==",
    "v1.b3BhcXVlLW5vbmNlLWJyYXZv.sig+green/opaque==",
  ];
  const opaqueDownloadTokens = [
    "v1.cmVuZGVyLW5vbmNlLWFscGhh.sig+download/alpha==",
    "v1.cmVuZGVyLW5vbmNlLWJyYXZv.sig+download/bravo==",
  ];
  const jobs = new Map<string, { planItemId: string; downloadToken: string }>();
  const polledTokens = new Set<string>();
  const editedPrompts = new Map([
    ["1", "调整后的中文提示词：商品完整居中，使用纯白背景。"],
    ["2", "调整后的中文提示词：生成完整的 3/4 立体视角商品底图，整张画布使用纯白背景，商品完整居中且四周留出标注空间；不生成任何文字、数字、单位、尺寸线、箭头或侧边面板。"],
  ]);

  await page.route("**/api/product/analyze", (route) => {
    const requestBody = route.request().postData() ?? "";
    expect(requestBody).toContain('"platform":"ozon"');
    expect(requestBody).toContain('"language":"ru"');
    expect(requestBody).toContain('"aspectRatio":"1090x1443"');
    expect(requestBody).toContain('"imageCount":2');
    expect(requestBody).toContain('"watermark":"My Ozon Shop"');
    expect(requestBody).toContain('"label":"杯高"');
    expect(requestBody).toContain('"value":12');
    expect(requestBody).toContain('"unit":"cm"');
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analysis: workflowAnalysis }) });
  });
  let submitted = 0;
  await page.route("**/api/product/generate", (route) => {
    const requestBody = route.request().postData() ?? "";
    const item = parseMultipartJsonField<PlanItem>(requestBody, "item");
    const settings = parseMultipartJsonField<GenerationSettings>(requestBody, "settings");
    expect(item.prompt).toBe(editedPrompts.get(item.id));
    expect(settings).toMatchObject({
      platform: "ozon",
      language: "ru",
      aspectRatio: "1090x1443",
      imageCount: 2,
      watermark: "My Ozon Shop",
    });
    expect(item.id).toBe(String(submitted + 1));
    if (item.id === "1") {
      expect(requestBody).not.toContain('name="baseImageToken"');
    } else {
      expect(parseMultipartTextField(requestBody, "baseImageToken"))
        .toBe(opaqueDownloadTokens[0]);
    }
    const providerJobId = opaqueJobTokens[submitted];
    const downloadToken = opaqueDownloadTokens[submitted];
    expect(providerJobId).toBeTruthy();
    expect(downloadToken).toBeTruthy();
    submitted += 1;
    jobs.set(providerJobId, { planItemId: item.id, downloadToken });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ task: { planItemId: item.id, providerJobId, status: "running", progress: 0 } }),
    });
  });
  await page.route("**/api/product/jobs/*", (route) => {
    const requestUrl = new URL(route.request().url());
    const matchedJob = [...jobs.entries()].find(([providerJobId]) => (
      requestUrl.pathname === `/api/product/jobs/${encodeURIComponent(providerJobId)}`
    ));
    expect(matchedJob).toBeTruthy();
    const [providerJobId, job] = matchedJob!;
    expect(route.request().url()).toContain(encodeURIComponent(providerJobId));
    polledTokens.add(providerJobId);
    const resultUrl = new URL("/api/product/download", route.request().url());
    resultUrl.searchParams.set("token", job.downloadToken);
    resultUrl.searchParams.set("inline", "1");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          planItemId: job.planItemId,
          providerJobId,
          status: "succeeded",
          progress: 100,
          resultUrl: resultUrl.toString(),
          downloadToken: job.downloadToken,
        },
      }),
    });
  });
  const renderedResultUrls: string[] = [];
  await page.route("**/api/product/download?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe(testOrigin);
    expect(url.pathname).toBe("/api/product/download");
    expect(url.searchParams.get("inline")).toBe("1");
    expect(opaqueDownloadTokens).toContain(url.searchParams.get("token"));
    renderedResultUrls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: productPng });
  });

  async function expectDimensionControlsInsidePanel() {
    const panel = await page.locator('aside[aria-labelledby="project-config-title"]').boundingBox();
    expect(panel).not.toBeNull();
    for (const label of ["尺寸名称 1", "尺寸数值 1", "尺寸单位 1"]) {
      const control = page.getByLabel(label);
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(panel!.x - 1);
      expect(bounds!.y).toBeGreaterThanOrEqual(panel!.y - 1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
    }
    return panel!;
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/product-studio");
  await page.getByLabel("平台").selectOption("ozon");
  await expect(page.getByLabel("语言")).toHaveValue("ru");
  await expect(page.getByLabel("语言")).toBeDisabled();
  await page.getByLabel("尺寸名称 1").fill("杯高");
  await page.getByLabel("尺寸数值 1").fill("12");
  await page.getByLabel("图片比例").selectOption("1090x1443");
  await expect(page.getByLabel("图片比例")).toHaveValue("1090x1443");
  await page.getByLabel("文字水印").fill("My Ozon Shop");
  await page.getByLabel("上传产品图").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: productPng });
  await page.getByLabel("生成数量").selectOption("2");

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desktopOverflow).toBeLessThanOrEqual(1);
  const desktopPanel = await expectDimensionControlsInsidePanel();
  expect(desktopPanel.width).toBeLessThanOrEqual(361);

  await page.getByRole("button", { name: "开始分析产品" }).click();
  await expect(page.getByRole("button", { name: "确认规划并生成" })).toBeEnabled();
  await expect(page.getByLabel("标题").nth(0)).toHaveValue("白底商品主图");
  await expect(page.getByLabel("标题").nth(1)).toHaveValue("尺寸标注图");
  await expect(page.getByText("Высота чашки")).toBeVisible();
  await expect(page.getByText("12 см")).toBeVisible();
  await page.getByLabel("第 1 张中文生图提示词").fill(editedPrompts.get("1")!);
  await page.getByLabel("第 2 张中文生图提示词").fill(editedPrompts.get("2")!);
  await page.getByRole("button", { name: "确认规划并生成" }).click();
  await expect(page.getByRole("img", { name: /生成结果/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "下载全部" })).toBeEnabled();

  const resultSources = await page.getByRole("img", { name: /生成结果/ }).evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  for (const [index, source] of resultSources.entries()) {
    const url = new URL(source);
    expect(url.origin).toBe(testOrigin);
    expect(url.pathname).toBe("/api/product/download");
    expect(url.searchParams.get("token")).toBe(opaqueDownloadTokens[index]);
    expect(url.searchParams.get("inline")).toBe("1");
  }

  await page.setViewportSize({ width: 768, height: 900 });
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrowOverflow).toBeLessThanOrEqual(1);
  const narrowPanel = await expectDimensionControlsInsidePanel();
  const narrowWorkspace = await page.getByRole("region", { name: "创作工作台" }).boundingBox();
  expect(narrowWorkspace).not.toBeNull();
  expect(narrowWorkspace!.y).toBeGreaterThanOrEqual(narrowPanel.y + narrowPanel.height);

  expect(submitted).toBe(2);
  expect(polledTokens).toEqual(new Set(opaqueJobTokens));
  expect(renderedResultUrls).toHaveLength(2);
});
