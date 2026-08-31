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

test("generates and retries only the failed five-second remake scene without escaping mocked routes", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
  });
  await page.addInitScript(() => {
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "video") {
        const video = element as HTMLVideoElement;
        Object.defineProperties(video, {
          duration: { configurable: true, get: () => 5 },
          videoWidth: { configurable: true, get: () => 100 },
          videoHeight: { configurable: true, get: () => 100 },
          src: {
            configurable: true,
            get: () => "blob:mock-reference",
            set: () => queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata"))),
          },
          currentTime: {
            configurable: true,
            get: () => 0,
            set: () => queueMicrotask(() => video.dispatchEvent(new Event("seeked"))),
          },
        });
        video.load = () => undefined;
      }
      if (tagName.toLowerCase() === "canvas") {
        const canvas = element as HTMLCanvasElement;
        canvas.getContext = (() => ({ drawImage: () => undefined }) as unknown as CanvasRenderingContext2D) as unknown as typeof canvas.getContext;
        canvas.toBlob = (callback) => callback(new Blob(["frame"], { type: "image/jpeg" }));
      }
      return element;
    }) as typeof document.createElement;
  });

  const resultUrls = ["first-result", "second-result"];
  let secondAttempts = 0;
  const submittedSceneIds: string[] = [];

  await page.route("**/api/video-remake/analyze", (route) => {
    const body = route.request().postData() ?? "";
    expect(multipartField(body, "videoDurationSec")).toBe("5");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        script: {
          styleNotes: "干净的商品展示节奏",
          scenes: [
            { id: "1", title: "开场", description: "商品特写", onScreenText: "新品", durationSec: 5 },
            { id: "2", title: "卖点", description: "模特展示商品", onScreenText: "轻盈", durationSec: 5 },
          ],
        },
      }),
    });
  });
  await page.route("**/api/video-remake/generate", (route) => {
    const body = route.request().postData() ?? "";
    const scene = JSON.parse(multipartField(body, "scene")) as { id: string; durationSec: number };
    const settings = JSON.parse(multipartField(body, "settings")) as { durationSec: number };
    expect(scene.durationSec).toBe(5);
    expect(settings.durationSec).toBe(10);
    expect(body).toContain('name="images"');
    expect(body).toContain('name="modelImage"');
    submittedSceneIds.push(scene.id);
    if (scene.id === "2" && secondAttempts++ === 0) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ task: { sceneId: "2", status: "failed", progress: 0, error: "模拟失败" } }),
      });
    }
    const index = scene.id === "1" ? 0 : 1;
    const resultUrl = new URL("/api/video-remake/download", route.request().url());
    resultUrl.searchParams.set("token", resultUrls[index]);
    resultUrl.searchParams.set("inline", "1");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          sceneId: scene.id,
          status: "succeeded",
          progress: 100,
          resultUrl: resultUrl.toString(),
          downloadToken: resultUrls[index],
        },
      }),
    });
  });
  await page.route("**/api/video-remake/jobs/**", (route) => route.fulfill({ status: 500, body: "unexpected polling" }));
  const downloadedTokens: string[] = [];
  await page.route("**/api/video-remake/download?*", (route) => {
    const token = new URL(route.request().url()).searchParams.get("token");
    expect(resultUrls).toContain(token);
    if (new URL(route.request().url()).searchParams.get("inline") !== "1") downloadedTokens.push(token!);
    return route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from("mock-video") });
  });

  await page.goto("/video-remake");
  await page.getByLabel("视频总时长").fill("5");
  await expect(page.getByLabel("视频总时长")).toHaveValue("5");
  await page.getByLabel("视频总时长").fill("10");
  await page.getByLabel("上传参考视频").setInputFiles({ name: "reference.mp4", mimeType: "video/mp4", buffer: Buffer.from("local-video") });
  await expect(page.getByText("已抽取 6 帧画面用于分析。")).toBeVisible();
  await page.getByLabel("上传商品图").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("上传模特图").setInputFiles({ name: "model.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("已选择模特图。")).toBeVisible();
  await page.getByRole("button", { name: "开始分析视频" }).click();
  await page.getByRole("button", { name: "确认脚本并生成视频" }).click();
  await expect(page.getByLabel("第 1 镜生成结果")).toBeVisible();
  await expect(page.getByText("模拟失败")).toBeVisible();

  const firstSource = await page.getByLabel("第 1 镜生成结果").getAttribute("src");
  await page.getByRole("button", { name: "重试此分镜" }).click();
  await expect(page.getByLabel("第 2 镜生成结果")).toBeVisible();
  await expect(page.getByLabel("第 1 镜生成结果")).toHaveAttribute("src", firstSource!);
  await page.getByRole("button", { name: "下载全部" }).click();
  await expect.poll(() => downloadedTokens.sort()).toEqual([...resultUrls].sort());

  expect(submittedSceneIds).toEqual(["1", "2", "2"]);
});
