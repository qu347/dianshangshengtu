import { afterEach, expect, it, vi } from "vitest";
import {
  defaultClothingSettings,
  defaultModelCandidateRequest,
  defaultSceneCandidateRequest,
  makeClothingAnalysis,
} from "../test-fixtures";
import type { ReferenceAsset } from "../model";
import {
  analyzeClothingClient,
  getClothingGenerationStatusClient,
  submitClothingCandidatesClient,
  submitClothingGenerationClient,
} from "./client-api";

const garment = new File(["garment"], "garment.webp", { type: "image/webp" });
const modelFile = new File(["model"], "model.webp", { type: "image/webp" });
const uploadedModel: ReferenceAsset = {
  id: "uploaded-model",
  kind: "model",
  source: "upload",
  previewUrl: "blob:model",
  file: modelFile,
};
const generatedModel: ReferenceAsset = {
  id: "generated-model",
  kind: "model",
  source: "generated",
  previewUrl: "/api/clothing/download?inline=1",
  downloadToken: "model-token",
};

afterEach(() => vi.unstubAllGlobals());

it("serializes uploaded and generated references through distinct multipart fields", async () => {
  const analysis = makeClothingAnalysis(2);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ analysis }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ analysis }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await analyzeClothingClient({
    garments: [garment],
    settings: defaultClothingSettings,
    requirements: "自然垂坠",
    model: uploadedModel,
  });
  await analyzeClothingClient({
    garments: [garment],
    settings: defaultClothingSettings,
    requirements: "",
    model: generatedModel,
  });

  const uploadedForm = fetchMock.mock.calls[0][1]?.body as FormData;
  const generatedForm = fetchMock.mock.calls[1][1]?.body as FormData;
  expect(uploadedForm.get("modelImage")).toBe(modelFile);
  expect(uploadedForm.get("modelToken")).toBeNull();
  expect(generatedForm.get("modelToken")).toBe("model-token");
  expect(generatedForm.get("modelImage")).toBeNull();
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "X-Clothing-Studio-Request": "1" });
});

it("omits model references from image one and includes them with the main token later", async () => {
  const [first, second] = makeClothingAnalysis(2).plan;
  const taskResponse = (id: string) => new Response(JSON.stringify({
    task: { planItemId: id, providerJobId: `job-${id}`, status: "running", progress: 0 },
  }), { status: 200 });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(taskResponse("1"))
    .mockResolvedValueOnce(taskResponse("2"));
  vi.stubGlobal("fetch", fetchMock);

  await submitClothingGenerationClient({
    garments: [garment], settings: defaultClothingSettings, item: first, model: generatedModel,
  });
  await submitClothingGenerationClient({
    garments: [garment], settings: defaultClothingSettings, item: second,
    model: generatedModel, baseImageToken: "main-token",
  });

  const firstForm = fetchMock.mock.calls[0][1]?.body as FormData;
  const secondForm = fetchMock.mock.calls[1][1]?.body as FormData;
  expect(firstForm.get("modelToken")).toBeNull();
  expect(firstForm.get("baseImageToken")).toBeNull();
  expect(secondForm.get("modelToken")).toBe("model-token");
  expect(secondForm.get("baseImageToken")).toBe("main-token");
});

it("routes candidate kinds correctly and URL-encodes opaque status tokens", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      task: { providerJobId: "ignored", status: "running", progress: 10 },
    }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await submitClothingCandidatesClient("model", defaultModelCandidateRequest);
  await submitClothingCandidatesClient("scene", defaultSceneCandidateRequest);
  const task = await getClothingGenerationStatusClient("signed.job/token", "candidate-1");

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/clothing/model-candidates",
    "/api/clothing/scene-candidates",
    "/api/clothing/jobs/signed.job%2Ftoken",
  ]);
  expect(task.planItemId).toBe("candidate-1");
});

