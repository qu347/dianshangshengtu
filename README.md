# AI 电商视觉工作台

## Local setup

Run these commands from the repository root:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Edit `.env.local` locally and enter your own Grsai API key plus a random `DOWNLOAD_TOKEN_SECRET`. Never paste keys or secret values into chat, and never commit `.env.local` or any other file containing secrets.

本地包含两个独立模块：

- `http://localhost:3000/product-studio`：全品类商品图。
- `http://localhost:3000/clothing-studio`：服装组图。

Use a local environment file with secret values left blank until you configure them on your own machine:

```dotenv
GRSAI_BASE_URL=https://grsai.dakka.com.cn
GRSAI_API_KEY=
DOWNLOAD_TOKEN_SECRET=
```

## Platform-aware workflow

The studio supports 通用电商、淘宝 / 天猫、抖音商城、Amazon、Shopify and Ozon. Platform language is fixed for marketplace-specific output:

| Platform | Marketing-copy language |
| --- | --- |
| 淘宝 / 天猫、抖音商城 | 中文 |
| Amazon、Shopify | English |
| Ozon | Русский |
| 通用电商 | Manually selected, including no marketing copy |

Product dimensions are flexible rather than tied to a preset product schema. Add up to six named values using mm, cm, m, in, mL, L, or a custom unit. A one-image run may omit dimensions; a run with two or more images requires at least one. Dimension labels are localized to the selected platform language while their display values and input order are preserved.

The first two output positions are fixed for consistency:

1. Image 1 is a white-background product main image without marketing copy or dimension labels. The server normalizes the connected outer background to exact white and rejects a result that cannot be cleaned safely.
2. Image 2 is a dimension-annotation image when the run contains at least two images. It is generated only after image 1 succeeds, using the signed, normalized image-1 result as its first visual reference. The image service creates a clean, complete 3/4 product view on white; a vision pass chooses product bounds and label placement; then the server draws opaque black brackets and the exact localized values supplied by the user.

If image 1 fails, image 2 is held with a prompt to generate or retry the white-background main image first. Later independent images may continue. Retrying image 2 reuses the current signed image-1 result; arbitrary remote image URLs are not accepted as the base reference. If the optional vision placement pass is unavailable, a deterministic trusted layout is used instead of failing the image.

The remaining plan fields stay editable before generation, including each Chinese generation prompt. In addition to 1:1, 2:3, and 3:2, the studio offers native `1090×1443` output as `3:4 竖版（1090×1443）` without substituting another aspect ratio.

An optional text watermark is composited into generated results. Amazon image 1 is the exception: it remains watermark-free to preserve the marketplace main-image rule. When provided, the watermark applies to other result images and to all images on the other supported platforms.

## 服装组图流程

服装模块需要上传 1–6 张服装图，并选择一张固定模特图；场景图可选。模特和场景既可上传，也可通过筛选条件各生成 1–4 张候选图。最终组图数量可选 1–16 张。

服装组图遵循固定依赖关系：

1. 第 1 张始终是纯白背景、仅展示当前销售服装的平铺主图，不出现人物、衣架、道具、营销文字或尺寸标注。
2. 第 2 张及以后在第 1 张成功后生成，并以签名后的第 1 张、原始服装图和所选固定模特为参考；选择场景图时也会沿用其空间、光线和视觉风格。
3. 第 1 张白底处理失败时自动重试一次；两次失败后阻止所有依赖图片。后续图片最多同时生成 3 张，单张失败不会中断其他图片。

平台语言和水印规则与全品类模块一致。Amazon 第 1 张不加水印，Amazon 其他图片及其他平台图片在填写水印后会添加水印。Ozon 固定使用俄文，Amazon / Shopify 固定使用英文，淘宝 / 天猫和抖音固定使用中文。

候选图历史仅在当前页面生命周期中保留。刷新页面可以恢复已保存的最终规划和不透明任务编号，并继续查询未完成任务；浏览器不会持久化本地服装、模特或场景文件，因此刷新后若要重新提交或重试，需重新选择这些文件。

## Tests

自动化浏览器测试会 mock 商品与服装 API，不调用 Grsai，也不消耗积分：

```powershell
npx playwright install chromium
npm test
npm run lint
npm run build
npm run test:e2e
```

### System Edge fallback

If the official Playwright Chromium download is unavailable and Microsoft Edge is already installed, run the same mocked browser test with the system Edge Chromium channel:

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

Leave `PLAYWRIGHT_CHANNEL` unset for the normal, officially installed Playwright Chromium run.

## Real smoke test

只有在明确同意消耗 Grsai 积分后才执行真实冒烟测试：

- 全品类模块：上传 1 张有效产品图，将生成数量设为 1，确认单张结果可预览和下载。
- 服装模块：上传 1 张服装图，只生成 1 张模特候选，最终图片数量设为 2；确认第 1 张为纯白背景服装平铺图，第 2 张使用所选模特与第 1 张参考，且两张均可预览和下载。

真实冒烟测试不要生成第 3 张图片，也不要额外生成模特或场景候选。
