import { AppShell } from "@/components/app-shell";
import { VideoRemake } from "@/features/video-remake/components/video-remake";

export default function VideoRemakePage() {
  return <AppShell active="video-remake"><VideoRemake /></AppShell>;
}
