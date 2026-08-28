import { expect, test } from "@playwright/test";
import type { ClothingGenerationSettings, ClothingPlanItem } from "../../features/clothing-studio/model";
import { makeClothingAnalysis } from "../../features/clothing-studio/test-fixtures";

function multipartText(body: string, field: string) {
  const fieldStart = body.indexOf(`name="${field}"`);
  expect(fieldStart).toBeGreaterThanOrEqual(0);
  const valueStart = body.indexOf("\r\n\r\n", fieldStart);
  const valueEnd = body.indexOf("\r\n--", valueStart + 4);
  expect(valueStart).toBeGreaterThan(fieldStart);
  expect(valueEnd).toBeGreaterThan(valueStart);
  return body.slice(valueStart + 4, valueEnd);
}

function multipartJson<T>(body: string, field: string) {
  return JSON.parse(multipartText(body, field)) as T;
}

test("completes the mocked two-stage clothing workflow without product or Grsai calls", async ({ page }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPj8AAAAASUVORK5CYII=",
    "base64",
  );
  const modelToken = "opaque-model-download-token";
  const mainDownloadToken = "opaque-main-download-token";
  const secondDownloadToken = "opaque-second-download-token";
  const mainJob = "opaque.main/job+token";
  const secondJob = "opaque.second/job+token";
  const analysis = makeClothingAnalysis(2);
  analysis.plan[1] = {
    ...analysis.plan[1],
    title: "同模特场景展示",
    copy: "Естественный образ",
    prompt: "保持同一模特和服装，使用简洁自然光场景，展示完整穿着效果。",
  };
  const editedSecondPrompt = "保持同一模特、脸部和服装不变，在简洁自然光场景中展示完整穿着效果。";
  const submissions: string[] = [];
  let mainSucceeded = false;
  let productApiCalls = 0;
  let nonInlineDownloads = 0;

  await page.route("**/api/product/**", (route) => {
    productApiCalls += 1;
    return route.abort();
  });
  await page.route("**/api/clothing/model-candidates", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(await route.request().postDataJSON()).toMatchObject({ count: 1, gender: "female" });
    const previewUrl = new URL("/api/clothing/download", route.request().url());
    previewUrl.searchParams.set("token", modelToken);
    previewUrl.searchParams.set("inline", "1");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tasks: [{
          planItemId: "model-1",
          status: "succeeded",
          progress: 100,
          resultUrl: previewUrl.toString(),
          downloadToken: modelToken,
        }],
      }),
    });
  });
  await page.route("**/api/clothing/scene-candidates", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "场景接口不应被调用" }),
  }));
  await page.route("**/api/clothing/analyze", (route) => {
    const body = route.request().postData() ?? "";
    const settings = multipartJson<ClothingGenerationSettings>(body, "settings");
    expect(settings).toMatchObject({
      platform: "ozon",
      language: "ru",
      aspectRatio: "1090x1443",
      imageCount: 2,
      watermark: "My Ozon Shop",
    });
    expect(multipartText(body, "modelToken")).toBe(modelToken);
    expect(body).not.toContain('name="sceneToken"');
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    });
  });
  await page.route("**/api/clothing/generate", (route) => {
    const body = route.request().postData() ?? "";
    const item = multipartJson<ClothingPlanItem>(body, "item");
    submissions.push(item.id);
    if (item.id === "1") {
      expect(body).not.toContain('name="modelToken"');
      expect(body).not.toContain('name="sceneToken"');
      expect(body).not.toContain('name="baseImageToken"');
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          task: { planItemId: "1", providerJobId: mainJob, status: "running", progress: 0 },
        }),
      });
    }
    expect(mainSucceeded).toBe(true);
    expect(item.prompt).toBe(editedSecondPrompt);
    expect(multipartText(body, "modelToken")).toBe(modelToken);
    expect(multipartText(body, "baseImageToken")).toBe(mainDownloadToken);
    expect(body).not.toContain('name="sceneToken"');
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: { planItemId: "2", providerJobId: secondJob, status: "running", progress: 0 },
      }),
    });
  });
  await page.route("**/api/clothing/jobs/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    const isMain = path.endsWith(encodeURIComponent(mainJob));
    const isSecond = path.endsWith(encodeURIComponent(secondJob));
    expect(isMain || isSecond).toBe(true);
    if (isMain) mainSucceeded = true;
    const token = isMain ? mainDownloadToken : secondDownloadToken;
    const itemId = isMain ? "1" : "2";
    const previewUrl = new URL("/api/clothing/download", route.request().url());
    previewUrl.searchParams.set("token", token);
    previewUrl.searchParams.set("inline", "1");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          planItemId: itemId,
          providerJobId: isMain ? mainJob : secondJob,
          status: "succeeded",
          progress: 100,
          resultUrl: previewUrl.toString(),
          downloadToken: token,
        },
      }),
    });
  });
  await page.route("**/api/clothing/download?*", (route) => {
    const url = new URL(route.request().url());
    expect([modelToken, mainDownloadToken, secondDownloadToken]).toContain(url.searchParams.get("token"));
    if (url.searchParams.get("inline") !== "1") nonInlineDownloads += 1;
    return route.fulfill({ status: 200, contentType: "image/png", body: png });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/clothing-studio");
  await page.getByLabel("上传服装图").setInputFiles({ name: "top.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "AI 生成模特图" }).click();
  await page.getByRole("button", { name: "立即生成模特候选" }).click();
  await page.getByRole("button", { name: /选择模特候选 model-1/ }).click();
  await page.getByRole("button", { name: "使用选中的模特" }).click();
  await page.getByLabel("平台").selectOption("ozon");
  await expect(page.getByLabel("语言")).toHaveValue("ru");
  await expect(page.getByLabel("语言")).toBeDisabled();
  await page.getByLabel("图片比例").selectOption("1090x1443");
  await page.getByLabel("生成数量").selectOption("2");
  await page.getByLabel("自定义水印").fill("My Ozon Shop");
  await page.getByRole("button", { name: "开始分析服装" }).click();
  await page.getByLabel("第 2 张中文生图提示词").fill(editedSecondPrompt);
  await page.getByRole("button", { name: "确认规划并生成" }).click();

  await expect(page.getByRole("img", { name: "白底立体服装主图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "同模特场景展示" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载全部" })).toBeEnabled();
  await page.getByRole("button", { name: "下载第 1 张" }).click();
  await expect.poll(() => nonInlineDownloads).toBe(1);

  expect(submissions).toEqual(["1", "2"]);
  expect(mainSucceeded).toBe(true);
  expect(productApiCalls).toBe(0);
});
