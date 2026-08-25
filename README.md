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
