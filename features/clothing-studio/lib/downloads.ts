import JSZip from "jszip";
import type { ClothingGenerationTask } from "../model";

export async function fetchClothingResultBlob(token: string) {
  const response = await fetch(`/api/clothing/download?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("图片下载失败，请重试");
  return response.blob();
}

export async function createClothingResultsZip(
  tasks: ClothingGenerationTask[],
  fetchBlob = fetchClothingResultBlob,
) {
  const zip = new JSZip();
  const successful = tasks.filter((task) => task.status === "succeeded" && task.downloadToken);
  await Promise.all(successful.map(async (task) => {
    const index = Number(task.planItemId);
    const filename = `clothing-${String(index).padStart(2, "0")}.png`;
    zip.file(filename, await fetchBlob(task.downloadToken!));
  }));
  return zip.generateAsync({ type: "blob" });
}

function clickBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  try {
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function downloadClothingResult(
  token: string,
  filename: string,
  fetchBlob = fetchClothingResultBlob,
) {
  clickBlobDownload(await fetchBlob(token), filename);
}

export async function downloadAllClothingResults(
  tasks: ClothingGenerationTask[],
  fetchBlob = fetchClothingResultBlob,
) {
  clickBlobDownload(await createClothingResultsZip(tasks, fetchBlob), "clothing-results.zip");
}

