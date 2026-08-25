import { AppShell } from "@/components/app-shell";
import { ProductStudio } from "@/features/product-studio/components/product-studio";

export default function ProductStudioPage() {
  return <AppShell active="product-studio"><ProductStudio /></AppShell>;
}
