import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPj8AAAAASUVORK5CYII=",
  "base64",
);

function multipartField(body: string, field: string) {
  const fieldStart = body.indexOf(`name="${field}"`);
  expect(fieldStart).toBeGreaterThanOrEqual(0);
  const valueStart = body.indexOf("\r\n\r\n", fieldStart);
  const valueEnd = body.indexOf("\r\n--", valueStart + 4);
  expect(valueStart).toBeGreaterThan(fieldStart);
  expect(valueEnd).toBeGreaterThan(valueStart);
  return body.slice(valueStart + 4, valueEnd);
}

test("retries only the failed five-second product-video shot and mocks ZIP and merge downloads", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
  });

  const resultTokens = ["intro-first", "intro-second"];
  const submittedShotIds: string[] = [];
  let secondAttempts = 0;
  let mergeTokens: string[] | null = null;
  const downloadedTokens: string[] = [];

  await page.route("**/api/product-video/analyze", (route) => {
    const body = route.request().postData() ?? "";
    expect(multipartField(body, "settings")).toContain('"durationSec":10');
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        script: {
          styleNotes: "黑金商品特写",
          shots: [
            { id: "1", title: "开镜", description: "商品特写", onScreenText: "新品", durationSec: 5 },
            { id: "2", title: "卖点", description: "旋转展示", onScreenText: "轻盈", durationSec: 5 },
          ],
        },
      }),
    });
  });
  await page.route("**/api/product-video/generate", (route) => {
    const body = route.request().postData() ?? "";
    const shot = JSON.parse(multipartField(body, "shot")) as { id: string; durationSec: number };
    expect(shot.durationSec).toBe(5);
    submittedShotIds.push(shot.id);
    if (shot.id === "2" && secondAttempts++ === 0) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ task: { shotId: "2", status: "failed", progress: 0, error: "模拟失败" } }),
      });
    }
    const index = shot.id === "1" ? 0 : 1;
    const resultUrl = new URL("/api/product-video/download", route.request().url());
    resultUrl.searchParams.set("token", resultTokens[index]);
    resultUrl.searchParams.set("inline", "1");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          shotId: shot.id,
          status: "succeeded",
          progress: 100,
          resultUrl: resultUrl.toString(),
          downloadToken: resultTokens[index],
        },
      }),
    });
  });
  await page.route("**/api/product-video/jobs/**", (route) => route.fulfill({ status: 500, body: "unexpected polling" }));
  await page.route("**/api/product-video/download?*", (route) => {
    const token = new URL(route.request().url()).searchParams.get("token");
    expect(resultTokens).toContain(token);
    if (new URL(route.request().url()).searchParams.get("inline") !== "1") downloadedTokens.push(token!);
    return route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from("mock-video") });
  });
  await page.route("**/api/product-video/merge", (route) => {
    mergeTokens = (route.request().postDataJSON() as { tokens: string[] }).tokens;
    return route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from("merged-video") });
  });

  await page.goto("/product-video");
  await page.getByLabel("视频总时长").fill("5");
  await expect(page.getByLabel("视频总时长")).toHaveValue("5");
  await page.getByLabel("视频总时长").fill("10");
  await page.getByLabel("上传商品图").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "开始生成脚本" }).click();
  await page.getByRole("button", { name: "确认脚本并生成视频" }).click();
  await expect(page.getByLabel("第 1 镜视频预览")).toBeVisible();
  await expect(page.getByText("模拟失败")).toBeVisible();

  const firstSource = await page.getByLabel("第 1 镜视频预览").getAttribute("src");
  await page.getByRole("button", { name: "重试此镜头" }).click();
  await expect(page.getByLabel("第 2 镜视频预览")).toBeVisible();
  await expect(page.getByLabel("第 1 镜视频预览")).toHaveAttribute("src", firstSource!);
  await page.getByRole("button", { name: "下载全部" }).click();
  await expect.poll(() => downloadedTokens.sort()).toEqual([...resultTokens].sort());
  await page.getByRole("button", { name: "下载合并视频" }).click();
  await expect.poll(() => mergeTokens).toEqual(resultTokens);

  expect(submittedShotIds).toEqual(["1", "2", "2"]);
});
