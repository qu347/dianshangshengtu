import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { createClothingResultsZip, downloadAllClothingResults, fetchClothingResultBlob } from "./downloads";

afterEach(() => vi.restoreAllMocks());

it("uses clothing download URLs and stable plan-index filenames", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["image"]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await fetchClothingResultBlob("signed/token");
  expect(fetchMock).toHaveBeenCalledWith("/api/clothing/download?token=signed%2Ftoken");

  const blob = await createClothingResultsZip([
    { planItemId: "3", status: "succeeded", progress: 100, resultUrl: "http://localhost/3", downloadToken: "three" },
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "http://localhost/1", downloadToken: "one" },
  ], async () => new Blob(["image"]));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(["clothing-03.png", "clothing-01.png"]);
});

it("downloads the archive as clothing-results.zip and revokes its URL", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  await downloadAllClothingResults([
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "http://localhost/1", downloadToken: "one" },
  ], async () => new Blob(["image"]));
  expect(click).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:zip");
  expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("clothing-results.zip");
});
