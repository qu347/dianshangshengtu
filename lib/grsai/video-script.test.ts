import { beforeEach, expect, it, vi } from "vitest";
import { analyzeVideoScript, buildScriptPrompt } from "./video-script";

const settings = { aspectRatio: "9:16" as const, durationSec: 12, language: "en" as const, quality: "480p" as const };
const frames = ["data:image/jpeg;base64,AAAA"];

const validScript = {
  styleNotes: "黑金背景，节奏紧凑，每镜一个大字卖点",
  scenes: [
    { id: "1", title: "开镜特写", description: "商品居中特写，缓慢推进", onScreenText: "96H Battery", durationSec: 6 },
    { id: "2", title: "场景展示", description: "通勤场景佩戴展示，环绕运镜", onScreenText: "Adaptive ANC", durationSec: 6 },
  ],
};

function completion(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it("encodes duration, ratio, language, and JSON-only requirements into the prompt", () => {
  const prompt = buildScriptPrompt({
    productName: "无线耳机",
    requirements: "突出续航",
    settings,
    videoDurationSec: 15,
  });

  expect(prompt).toContain("总时长必须约 12 秒（允许 ±4 秒）");
  expect(prompt).toContain("每个分镜 5 到 15 秒");
  expect(prompt).toContain("画面比例为 9:16");
  expect(prompt).toContain("叠层文字必须使用英文");
  expect(prompt).toContain("不得臆造商品不具备的功效、认证或价格");
});

it("parses a valid script and normalizes scene ids", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify({ ...validScript, scenes: validScript.scenes.map((s) => ({ ...s, id: "9" })) })));

  const script = await analyzeVideoScript({ frames, settings, productName: "无线耳机", requirements: "", videoDurationSec: 15 }, fetchImpl);

  expect(script.scenes.map((scene) => scene.id)).toEqual(["1", "2"]);
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("repairs an invalid script once and reapplies the duration budget", async () => {
  const offBudget = { ...validScript, scenes: [{ ...validScript.scenes[0], durationSec: 15 }] };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(completion("not-json"))
    .mockResolvedValueOnce(completion(JSON.stringify(offBudget)));

  await expect(analyzeVideoScript({ frames, settings, productName: "", requirements: "", videoDurationSec: 15 }, fetchImpl))
    .resolves.toMatchObject({ scenes: [{ durationSec: 15 }] });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("fails with a safe error when the repaired script is still invalid", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(completion("not-json"))
    .mockResolvedValueOnce(completion(JSON.stringify({
      styleNotes: "x",
      scenes: [{ ...validScript.scenes[0], durationSec: 4 }],
    })));

  await expect(analyzeVideoScript({ frames, settings, productName: "", requirements: "", videoDurationSec: 15 }, fetchImpl))
    .rejects.toMatchObject({ code: "invalid_request", status: 502 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
