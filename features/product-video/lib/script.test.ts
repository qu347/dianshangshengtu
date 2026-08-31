import { beforeEach, expect, it, vi } from "vitest";
import { analyzeIntroScript, buildIntroScriptPrompt } from "./script";

const settings = { aspectRatio: "9:16" as const, durationSec: 10, resolution: "480p" as const, language: "zh-CN" as const };
const images = ["data:image/webp;base64,AAAA"];

const validScript = {
  styleNotes: "黑金质感背景，节奏干脆，每镜一个大字卖点",
  shots: [
    { id: "1", title: "开镜特写", description: "黑金背景中商品居中特写，缓慢推进", onScreenText: "96小时超长续航", durationSec: 10 },
  ],
};

function completion(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it("encodes duration, ratio, language, and the no-fabrication rule into the prompt", () => {
  const prompt = buildIntroScriptPrompt({
    productName: "无线蓝牙耳机",
    requirements: "突出 96 小时续航",
    settings,
  });

  expect(prompt).toContain("总时长必须约 10 秒（允许 ±4 秒）");
  expect(prompt).toContain("优先只输出 1 个完整长镜头");
  expect(prompt).toContain("画面比例为 9:16");
  expect(prompt).toContain("叠层文字必须使用中文");
  expect(prompt).toContain("不得臆造商品不具备的功效、认证、参数或价格");
});

it("parses a valid script and normalizes shot ids", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify({ ...validScript, shots: validScript.shots.map((s) => ({ ...s, id: "9" })) })));

  const script = await analyzeIntroScript({ images, settings, productName: "无线蓝牙耳机", requirements: "" }, fetchImpl);

  expect(script.shots.map((shot) => shot.id)).toEqual(["1"]);
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("repairs an invalid script once and reapplies the duration budget", async () => {
  const repaired = { ...validScript, shots: [{ ...validScript.shots[0], durationSec: 13 }] };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(completion("not-json"))
    .mockResolvedValueOnce(completion(JSON.stringify(repaired)));

  await expect(analyzeIntroScript({ images, settings, productName: "", requirements: "" }, fetchImpl))
    .resolves.toMatchObject({ shots: [{ durationSec: 13 }] });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("fails with a safe error when the repaired script is still invalid", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(completion("not-json"))
    .mockResolvedValueOnce(completion(JSON.stringify({
      styleNotes: "x",
      shots: [{ ...validScript.shots[0], durationSec: 4 }],
    })));

  await expect(analyzeIntroScript({ images, settings, productName: "", requirements: "" }, fetchImpl))
    .rejects.toMatchObject({ code: "invalid_request", status: 502 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("sends product images as image parts of the analysis request", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify(validScript)));

  await analyzeIntroScript({ images, settings, productName: "耳机", requirements: "" }, fetchImpl);

  const [, init] = fetchImpl.mock.calls[0];
  const body = JSON.parse(String(init.body));
  const content = body.messages[1].content;
  expect(content[0].text).toContain("耳机");
  expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } });
});
