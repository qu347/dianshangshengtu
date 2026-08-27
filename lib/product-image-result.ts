import type { ImageRenderConfig } from "./image-render-config";
import { fallbackDimensionLayout } from "./dimension-layout";
import { analyzeDimensionLayout } from "./grsai/dimension-layout";
import { normalizeWhiteBackground } from "./product-image-validation";
import { fetchPublicImage } from "./remote-image";

export async function prepareGeneratedImageResult(input: {
  url: string;
  render: ImageRenderConfig;
  fetchImage?: (url: string) => Promise<Buffer>;
  analyzeLayout?: typeof analyzeDimensionLayout;
}): Promise<
  | { ok: true; render: ImageRenderConfig }
  | { ok: false; error: string }
> {
  if (input.render.imageIndex > 2) return { ok: true, render: input.render };

  let normalized: Buffer;
  try {
    const source = await (input.fetchImage ?? fetchPublicImage)(input.url);
    normalized = await normalizeWhiteBackground(source);
  } catch {
    return {
      ok: false,
      error: input.render.imageIndex === 1
        ? "白底商品主图背景处理失败，请重试此图"
        : "尺寸图背景处理失败，请重试此图",
    };
  }

  if (input.render.imageIndex === 1) return { ok: true, render: input.render };

  let dimensionLayout = fallbackDimensionLayout(input.render.annotations);
  try {
    dimensionLayout = await (input.analyzeLayout ?? analyzeDimensionLayout)({
      image: `data:image/png;base64,${normalized.toString("base64")}`,
      annotations: input.render.annotations,
    });
  } catch {
    // Placement analysis is optional; trusted deterministic layout remains usable.
  }
  return { ok: true, render: { ...input.render, dimensionLayout } };
}
