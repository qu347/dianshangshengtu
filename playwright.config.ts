import { defineConfig, devices } from "@playwright/test";

const browserChannel = process.env.PLAYWRIGHT_CHANNEL;
const testPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const testOrigin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: testOrigin, trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -- -p ${testPort}`,
    url: testOrigin,
    reuseExistingServer: !process.env.PLAYWRIGHT_PORT,
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], ...(browserChannel ? { channel: browserChannel } : {}) },
  }],
});
