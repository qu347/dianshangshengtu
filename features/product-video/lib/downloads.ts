import JSZip from "jszip";
import { fetchClipBlob, fetchMergedClipBlob } from "./client";
import type { IntroScript, VideoIntroTask } from "../model";

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

export async function downloadShot(token: string, shotId: string, fetchBlob = fetchClipBlob) {
  clickBlobDownload(await fetchBlob(token), `shot-${shotId}.mp4`);
}

export function succeededTokensInOrder(tasks: VideoIntroTask[], script: IntroScript) {
  return script.shots.flatMap((shot) => {
    const task = tasks.find((item) => item.shotId === shot.id);
    return task?.status === "succeeded" && task.downloadToken ? [task.downloadToken] : [];
  });
}

export async function downloadAllShots(
  tasks: VideoIntroTask[],
  script: IntroScript | null,
  fetchBlob = fetchClipBlob,
) {
  const zip = new JSZip();
  const succeeded = tasks.filter((task) => task.status === "succeeded" && task.downloadToken);

  zip.file("script.json", JSON.stringify(script, null, 2));
  await Promise.all(succeeded.map((task) => (
    zip.file(`shot-${task.shotId}.mp4`, fetchBlob(task.downloadToken!))
  )));

  clickBlobDownload(await zip.generateAsync({ type: "blob" }), "product-video-results.zip");
}

export async function downloadMergedVideo(tokens: string[], fetchBlob = fetchMergedClipBlob) {
  clickBlobDownload(await fetchBlob(tokens), "product-video-merged.mp4");
}
