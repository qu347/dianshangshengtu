import JSZip from "jszip";
import type { GenerationTask } from "../model";

export async function fetchResultBlob(token: string) {
  const response = await fetch(`/api/product/download?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("图片下载失败，请重试");
  return response.blob();
}

export async function createResultsZip(
  tasks: GenerationTask[],
  fetchBlob = fetchResultBlob,
) {
  const zip = new JSZip();
  const successful = tasks.filter((task) => task.status === "succeeded" && task.downloadToken);

  await Promise.all(successful.map(async (task, index) => {
    zip.file(
      `product-${String(index + 1).padStart(2, "0")}.png`,
      await fetchBlob(task.downloadToken!),
    );
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

export async function downloadResult(
  token: string,
  filename: string,
  fetchBlob = fetchResultBlob,
) {
  clickBlobDownload(await fetchBlob(token), filename);
}

export async function downloadAllResults(
  tasks: GenerationTask[],
  fetchBlob = fetchResultBlob,
) {
  clickBlobDownload(await createResultsZip(tasks, fetchBlob), "product-results.zip");
}
