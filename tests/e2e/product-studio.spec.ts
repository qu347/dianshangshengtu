import { expect, test } from "@playwright/test";
import { analysisWithTwoItems } from "../../features/product-studio/test-fixtures";

test("completes a two-image product workflow without real API calls", async ({ page }) => {
  const productPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPj8AAAAASUVORK5CYII=", "base64");
  const workflowAnalysis = {
    ...analysisWithTwoItems,
    plan: [
      { ...analysisWithTwoItems.plan[0], title: "白底商品主图" },
      {
        ...analysisWithTwoItems.plan[1],
        title: "尺寸标注图",
        objective: "展示产品尺寸",
        scene: "白底尺寸信息版式",
        prompt: "生成带俄文尺寸标注的商品详情图",
        annotations: [{ label: "Высота чашки", displayValue: "12 см" }],
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
    const itemId = route.request().postData()?.match(/"id":"([^"]+)"/)?.[1];
    expect(itemId).toBeTruthy();
    const providerJobId = opaqueJobTokens[submitted];
    const downloadToken = opaqueDownloadTokens[submitted];
    expect(providerJobId).toBeTruthy();
    expect(downloadToken).toBeTruthy();
    submitted += 1;
    jobs.set(providerJobId, { planItemId: itemId!, downloadToken });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ task: { planItemId: itemId, providerJobId, status: "running", progress: 0 } }),
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
    expect(url.origin).toBe("http://127.0.0.1:3000");
    expect(url.pathname).toBe("/api/product/download");
    expect(url.searchParams.get("inline")).toBe("1");
    expect(opaqueDownloadTokens).toContain(url.searchParams.get("token"));
    renderedResultUrls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: productPng });
  });

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
  const desktopPanel = await page.locator('aside[aria-labelledby="project-config-title"]').boundingBox();
  const desktopDimensionRow = await page.getByText("尺寸项 1", { exact: true }).locator("..").boundingBox();
  expect(desktopPanel).not.toBeNull();
  expect(desktopDimensionRow).not.toBeNull();
  expect(desktopPanel!.width).toBeLessThanOrEqual(361);
  expect(desktopDimensionRow!.x + desktopDimensionRow!.width).toBeLessThanOrEqual(desktopPanel!.x + desktopPanel!.width);

  await page.getByRole("button", { name: "开始分析产品" }).click();
  await expect(page.getByRole("button", { name: "确认规划并生成" })).toBeEnabled();
  await expect(page.getByLabel("标题").nth(0)).toHaveValue("白底商品主图");
  await expect(page.getByLabel("标题").nth(1)).toHaveValue("尺寸标注图");
  await expect(page.getByText("Высота чашки")).toBeVisible();
  await expect(page.getByText("12 см")).toBeVisible();
  await page.getByLabel("第 1 张中文生图提示词").fill("调整后的白底主图提示词");
  await page.getByRole("button", { name: "确认规划并生成" }).click();
  await expect(page.getByRole("img", { name: /生成结果/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "下载全部" })).toBeEnabled();

  const resultSources = await page.getByRole("img", { name: /生成结果/ }).evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  for (const [index, source] of resultSources.entries()) {
    const url = new URL(source);
    expect(url.origin).toBe("http://127.0.0.1:3000");
    expect(url.pathname).toBe("/api/product/download");
    expect(url.searchParams.get("token")).toBe(opaqueDownloadTokens[index]);
    expect(url.searchParams.get("inline")).toBe("1");
  }

  await page.setViewportSize({ width: 768, height: 900 });
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrowOverflow).toBeLessThanOrEqual(1);
  const narrowPanel = await page.locator('aside[aria-labelledby="project-config-title"]').boundingBox();
  const narrowWorkspace = await page.getByRole("region", { name: "创作工作台" }).boundingBox();
  expect(narrowPanel).not.toBeNull();
  expect(narrowWorkspace).not.toBeNull();
  expect(narrowWorkspace!.y).toBeGreaterThanOrEqual(narrowPanel!.y + narrowPanel!.height);

  expect(submitted).toBe(2);
  expect(polledTokens).toEqual(new Set(opaqueJobTokens));
  expect(renderedResultUrls).toHaveLength(2);
});
