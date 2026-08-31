import JSZip from "jszip";
import { fetchClipBlob } from "./client";
import type { VideoSceneTask, VideoScript } from "../model";

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

export async function downloadClip(token: string, sceneId: string, fetchBlob = fetchClipBlob) {
  clickBlobDownload(await fetchBlob(token), `scene-${sceneId}.mp4`);
}

export async function downloadAllScenes(
  tasks: VideoSceneTask[],
  script: VideoScript | null,
  fetchBlob = fetchClipBlob,
) {
  const zip = new JSZip();
  const succeeded = tasks.filter((task) => task.status === "succeeded" && task.downloadToken);

  zip.file("script.json", JSON.stringify(script, null, 2));
  await Promise.all(succeeded.map((task) => (
    zip.file(`scene-${task.sceneId}.mp4`, fetchBlob(task.downloadToken!))
  )));

  clickBlobDownload(await zip.generateAsync({ type: "blob" }), "video-remake-results.zip");
}
