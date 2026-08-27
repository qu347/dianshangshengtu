import { beforeEach, expect, it, vi } from "vitest";
import type { DimensionAnnotation } from "@/features/product-studio/model";
import { fallbackDimensionLayout } from "@/lib/dimension-layout";
import { analyzeDimensionLayout } from "./dimension-layout";

const image = "data:image/png;base64,iVBORw0KGgo=";
const annotations: DimensionAnnotation[] = [
  { id: "width", label: "Ширина", displayValue: "3.54 in" },
  { id: "height", label: "Высота", displayValue: "1.97 in" },
];
const validLayout = {
  bounds: { left: 180, top: 220, right: 820, bottom: 820 },
  placements: [
    { id: "width", axis: "horizontal", side: "top" },
    { id: "height", axis: "vertical", side: "right" },
  ],
} as const;

function completion(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it("accepts exact stable ids and never sends program-owned values to vision AI", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify(validLayout)));

  await expect(analyzeDimensionLayout({ image, annotations }, fetchImpl)).resolves.toEqual(validLayout);

  const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  const serialized = JSON.stringify(request);
  expect(request.model).toBe("gemini-3.1-flash-lite");
  expect(serialized).toContain("width");
  expect(serialized).toContain("Ширина");
  expect(serialized).not.toContain("3.54 in");
  expect(serialized).not.toContain("1.97 in");
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("repairs one invalid layout and accepts the repaired exact-id result", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(completion("not-json"))
    .mockResolvedValueOnce(completion(JSON.stringify(validLayout)));

  await expect(analyzeDimensionLayout({ image, annotations }, fetchImpl)).resolves.toEqual(validLayout);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each([
  ["duplicate ids", {
    ...validLayout,
    placements: [validLayout.placements[0], { ...validLayout.placements[1], id: "width" }],
  }],
  ["reordered ids", {
    ...validLayout,
    placements: [validLayout.placements[1], validLayout.placements[0]],
  }],
  ["missing ids", {
    ...validLayout,
    placements: [validLayout.placements[0]],
  }],
  ["out-of-range bounds", {
    ...validLayout,
    bounds: { ...validLayout.bounds, left: -1 },
  }],
  ["invalid axis", {
    ...validLayout,
    placements: [{ ...validLayout.placements[0], axis: "diagonal" }, validLayout.placements[1]],
  }],
] as const)("falls back after two invalid %s responses", async (_label, invalid) => {
  const fetchImpl = vi.fn().mockResolvedValue(completion(JSON.stringify(invalid)));

  await expect(analyzeDimensionLayout({ image, annotations }, fetchImpl))
    .resolves.toEqual(fallbackDimensionLayout(annotations));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("falls back after a transport failure without retrying an unavailable service", async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

  await expect(analyzeDimensionLayout({ image, annotations }, fetchImpl))
    .resolves.toEqual(fallbackDimensionLayout(annotations));
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("falls back when the repair request also fails", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(completion("not-json"))
    .mockRejectedValueOnce(new Error("offline"));

  await expect(analyzeDimensionLayout({ image, annotations }, fetchImpl))
    .resolves.toEqual(fallbackDimensionLayout(annotations));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
