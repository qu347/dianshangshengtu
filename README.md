# Product Studio

## Local setup

Run these commands from the repository root:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Edit `.env.local` locally and enter your own Grsai API key plus a random `DOWNLOAD_TOKEN_SECRET`. Never paste keys or secret values into chat, and never commit `.env.local` or any other file containing secrets.

Open `http://localhost:3000/product-studio` in your browser.

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

1. Image 1 is a white-background product main image without marketing copy or dimension labels.
2. Image 2 is a dimension-annotation image when the run contains at least two images. The service generates a clean layout and the server overlays the localized labels and exact display values.

The remaining plan fields stay editable before generation, including each Chinese generation prompt. In addition to 1:1, 2:3, and 3:2, the studio offers native `1090×1443` output as `3:4 竖版（1090×1443）` without substituting another aspect ratio.

An optional text watermark is composited into generated results. Amazon image 1 is the exception: it remains watermark-free to preserve the marketplace main-image rule. When provided, the watermark applies to other result images and to all images on the other supported platforms.

## Tests

The automated browser test mocks every product API endpoint and does not call Grsai:

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

After configuring `.env.local`, upload exactly one valid product image and set the generation count to `1`. Analyze the product, review the single plan, generate it, and confirm that the one result previews and downloads successfully. Do not perform a second real generation as part of the smoke test.
