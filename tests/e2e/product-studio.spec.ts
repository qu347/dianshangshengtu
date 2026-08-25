import { expect, test } from "@playwright/test";
import { analysisWithTwoItems } from "../../features/product-studio/test-fixtures";

test("completes a two-image product workflow without real API calls", async ({ page }) => {
  await page.route("**/api/product/analyze", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analysis: analysisWithTwoItems }) }));
  let submitted = 0;
  await page.route("**/api/product/generate", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task: { planItemId: String(++submitted), providerJobId: `job-${submitted}`, status: "running", progress: 0 } }) }));
  await page.route("**/api/product/jobs/*", (route) => {
    const id = route.request().url().split("/").at(-1)!;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task: { planItemId: id.replace("job-", ""), providerJobId: id, status: "succeeded", progress: 100, resultUrl: "data:image/png;base64,iVBORw0KGgo=", downloadToken: `token-${id}` } }) });
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
