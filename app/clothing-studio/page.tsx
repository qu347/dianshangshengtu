import { AppShell } from "@/components/app-shell";
import { ClothingStudio } from "@/features/clothing-studio/components/clothing-studio";

export default function ClothingStudioPage() {
  return <AppShell active="clothing-studio"><ClothingStudio /></AppShell>;
}
