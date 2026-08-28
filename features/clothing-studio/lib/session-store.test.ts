import { expect, it } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "../test-fixtures";
import { clearClothingSession, loadClothingSession, saveClothingSession } from "./session-store";

it("restores only JSON-safe run data and marks it recovered", () => {
  const storage = new Map<string, string>();
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } as Storage;
  saveClothingSession({
    settings: defaultClothingSettings,
    analysis: makeClothingAnalysis(2),
    tasks: [{ planItemId: "1", providerJobId: "opaque", status: "running", progress: 40 }],
  }, store);

  expect(loadClothingSession(store)).toEqual(expect.objectContaining({
    settings: defaultClothingSettings,
    analysis: makeClothingAnalysis(2),
    recovered: true,
  }));
  expect(storage.get("clothing-studio-active-run-v1")).not.toContain("File");
  clearClothingSession(store);
  expect(loadClothingSession(store)).toBeNull();
});

it("ignores malformed saved state", () => {
  const store = {
    getItem: () => "{bad json",
    setItem: () => undefined,
    removeItem: () => undefined,
  } as unknown as Storage;
  expect(loadClothingSession(store)).toBeNull();
});

it("restores a legacy saved session with a flat-lay image-one type", () => {
  const storage = new Map<string, string>();
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } as Storage;
  saveClothingSession({
    settings: defaultClothingSettings,
    analysis: makeClothingAnalysis(2),
    tasks: [],
  }, store);
  const legacy = JSON.parse(storage.get("clothing-studio-active-run-v1")!);
  legacy.analysis.plan[0].type = "flat_lay";
  storage.set("clothing-studio-active-run-v1", JSON.stringify(legacy));

  expect(loadClothingSession(store)?.analysis.plan[0].type).toBe("product");
});
