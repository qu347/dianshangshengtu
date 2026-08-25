import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import type { GenerationTask } from "../model";
import { createResultsZip, downloadAllResults, downloadResult } from "./downloads";

afterEach(() => {
  vi.restoreAllMocks();
});

it("adds only successful results to the ZIP", async () => {
  const fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
  const blob = await createResultsZip([
    { planItemId: "1", status: "succeeded", progress: 100, downloadToken: "a" },
    { planItemId: "2", status: "failed", progress: 0, error: "failed" },
  ], fetchBlob);

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(["product-01.png"]);
  expect(fetchBlob).toHaveBeenCalledOnce();
  expect(fetchBlob).toHaveBeenCalledWith("a");
});

it("revokes the temporary URL after downloading one signed result", async () => {
  const resultBlob = new Blob(["image"], { type: "image/png" });
  const fetchBlob = vi.fn(async () => resultBlob);
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:result");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  await downloadResult("signed-token", "result.png", fetchBlob);

  expect(createObjectURL).toHaveBeenCalledWith(resultBlob);
  expect(click).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:result");
});

it("still revokes the temporary URL when starting the browser download fails", async () => {
  const fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:result");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    throw new Error("click failed");
  });

  await expect(downloadResult("signed-token", "result.png", fetchBlob)).rejects.toThrow("click failed");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:result");
});

it("downloads a ZIP containing successful tasks and revokes its temporary URL", async () => {
  const tasks: GenerationTask[] = [
    { planItemId: "1", status: "succeeded", progress: 100, downloadToken: "one" },
    { planItemId: "2", status: "failed", progress: 0, error: "failed" },
  ];
  const fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  await downloadAllResults(tasks, fetchBlob);

  expect(fetchBlob).toHaveBeenCalledOnce();
  expect(fetchBlob).toHaveBeenCalledWith("one");
  expect(click).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:zip");
});
