import { expect, it, vi } from "vitest";
import { pollShotJob, runShotBatch } from "./intro-runner";

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

it.each(["queued", "submitting"] as const)("polls a %s submission until it reaches a terminal result", async (status) => {
  const controller = new AbortController();
  const poll = vi.fn().mockResolvedValue({
    shotId: "1",
    status: "succeeded" as const,
    progress: 100,
    resultUrl: "https://cdn.example/clip.mp4",
    downloadToken: "download-token",
  });

  const results = await runShotBatch({
    shots: shots.slice(0, 1),
    productImages: [],
    settings: { ...settings, durationSec: 5 },
    api: {
      submit: vi.fn().mockResolvedValue({ shotId: "1", status, progress: 20, providerJobId: "job-1" }) as never,
      status: poll,
    },
    onShotChange: vi.fn(),
    signal: controller.signal,
  });

  expect(poll).toHaveBeenCalledWith("job-1", "1", controller.signal);
  expect(results).toMatchObject([{ shotId: "1", status: "succeeded", downloadToken: "download-token" }]);
});

it("keeps polling queued, submitting, and running statuses with the same signal until success", async () => {
  const controller = new AbortController();
  const status = vi.fn()
    .mockResolvedValueOnce({ shotId: "1", status: "queued" as const, progress: 0, providerJobId: "job-1" })
    .mockResolvedValueOnce({ shotId: "1", status: "submitting" as const, progress: 10, providerJobId: "job-1" })
    .mockResolvedValueOnce({ shotId: "1", status: "running" as const, progress: 50, providerJobId: "job-1" })
    .mockResolvedValueOnce({ shotId: "1", status: "succeeded" as const, progress: 100, resultUrl: "https://cdn.example/clip.mp4", downloadToken: "download-token" });
  const sleep = vi.fn(async () => {});

  const result = await pollShotJob({
    providerJobId: "job-1",
    shotId: "1",
    api: { status },
    onShotChange: vi.fn(),
    signal: controller.signal,
    sleep,
  });

  expect(status).toHaveBeenNthCalledWith(1, "job-1", "1", controller.signal);
  expect(status).toHaveBeenNthCalledWith(2, "job-1", "1", controller.signal);
  expect(status).toHaveBeenNthCalledWith(3, "job-1", "1", controller.signal);
  expect(status).toHaveBeenNthCalledWith(4, "job-1", "1", controller.signal);
  expect(sleep).toHaveBeenCalledTimes(3);
  expect(result).toMatchObject({ shotId: "1", status: "succeeded", downloadToken: "download-token" });
});

it("stops immediately on a failed task", async () => {
  const status = vi.fn().mockResolvedValue({ shotId: "1", status: "failed" as const, progress: 100, error: "任务失败" });
  const sleep = vi.fn(async () => {});

  const result = await pollShotJob({
    providerJobId: "job-1",
    shotId: "1",
    api: { status },
    onShotChange: vi.fn(),
    sleep,
  });

  expect(status).toHaveBeenCalledOnce();
  expect(sleep).not.toHaveBeenCalled();
  expect(result).toMatchObject({ status: "failed", error: "任务失败" });
});
