import { whiteBackgroundOptionsFor, type ImageRenderConfig } from "./image-render-config";
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
  const isDimensionImage = input.render.imageIndex === 2
    && input.render.dimensionLayout !== undefined;
  if (input.render.imageIndex !== 1 && !isDimensionImage) {
    return { ok: true, render: input.render };
  }

  let source: Buffer;
  try {
    source = await (input.fetchImage ?? fetchPublicImage)(input.url);
  } catch {
    return { ok: false, error: "生成图片下载失败，请重试此图" };
  }

  let normalized: Buffer;
  try {
    normalized = await normalizeWhiteBackground(source, whiteBackgroundOptionsFor(input.render));
  } catch {
    return {
      ok: false,
      error: input.render.imageIndex === 1
        ? "白底商品主图背景处理失败，请重试此图"
        : "尺寸图背景处理失败，请重试此图",
    };
  }

  if (!isDimensionImage) return { ok: true, render: input.render };

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
