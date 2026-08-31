import { expect, it, vi } from "vitest";
import { runShotBatch } from "./intro-runner";

const shots = [
  { id: "1", title: "开场", description: "商品特写", onScreenText: "", durationSec: 5 },
  { id: "2", title: "结尾", description: "商品全景", onScreenText: "", durationSec: 5 },
];
const settings = { aspectRatio: "9:16" as const, durationSec: 10, resolution: "480p" as const, language: "zh-CN" as const };

it("passes its signal into submission and stops before later shots after cancellation", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const submit = vi.fn(async (input: { shot: { id: string }; signal?: AbortSignal }) => {
    receivedSignal = input.signal;
    controller.abort();
    return { shotId: input.shot.id, status: "running" as const, progress: 0, providerJobId: "job-1" };
  });

  await runShotBatch({
    shots,
    productImages: [],
    settings,
    api: { submit: submit as never, status: vi.fn() },
    onShotChange: vi.fn(),
    signal: controller.signal,
  });

  expect(receivedSignal).toBe(controller.signal);
  expect(submit).toHaveBeenCalledTimes(1);
});

it("passes the same signal into polling", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;

  await runShotBatch({
    shots: shots.slice(0, 1),
    productImages: [],
    settings: { ...settings, durationSec: 5 },
    api: {
      submit: vi.fn().mockResolvedValue({ shotId: "1", status: "running", progress: 20, providerJobId: "job-1" }) as never,
      status: vi.fn(async (_jobToken, _shotId, signal?: AbortSignal) => {
        receivedSignal = signal;
        controller.abort();
        return { shotId: "1", status: "running" as const, progress: 20, providerJobId: "job-1" };
      }),
    },
    onShotChange: vi.fn(),
    signal: controller.signal,
  });

  expect(receivedSignal).toBe(controller.signal);
});
