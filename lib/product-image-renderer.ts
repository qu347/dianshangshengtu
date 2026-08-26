import sharp from "sharp";
import type { ImageRenderConfig } from "./image-render-config";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function annotationSvg(
  width: number,
  height: number,
  annotations: ImageRenderConfig["annotations"],
) {
  if (annotations.length === 0) return "";

  const areaWidth = Math.round(width * 0.35);
  const areaStart = width - areaWidth;
  const padding = Math.max(16, Math.round(width * 0.025));
  const labelSize = Math.max(16, Math.round(width * 0.022));
  const valueSize = Math.max(18, Math.round(width * 0.028));
  const lineStart = Math.round(width * 0.55);
  const lineEnd = areaStart + padding;
  const slotHeight = height / (annotations.length + 1);

  const labels = annotations.map((annotation, index) => {
    const centerY = Math.round(slotHeight * (index + 1));
    return `
      <line x1="${lineStart}" y1="${centerY}" x2="${lineEnd}" y2="${centerY}"
        stroke="#27313f" stroke-width="2" opacity="0.72" />
      <circle cx="${lineStart}" cy="${centerY}" r="4" fill="#27313f" opacity="0.8" />
      <text x="${lineEnd + padding}" y="${centerY - Math.round(valueSize * 0.35)}"
        font-family="Arial, sans-serif" font-size="${labelSize}" fill="#27313f">
        ${escapeXml(annotation.label)}
      </text>
      <text x="${lineEnd + padding}" y="${centerY + Math.round(valueSize * 0.8)}"
        font-family="Arial, sans-serif" font-size="${valueSize}" font-weight="700" fill="#111827">
        ${escapeXml(annotation.displayValue)}
      </text>`;
  }).join("");

  return `
    <rect x="${areaStart}" y="0" width="${areaWidth}" height="${height}"
      fill="#ffffff" opacity="0.78" />
    ${labels}`;
}

function watermarkSvg(width: number, height: number, watermark: string) {
  if (!watermark) return "";

  const padding = Math.max(18, Math.round(Math.min(width, height) * 0.035));
  const fontSize = Math.max(24, Math.round(Math.min(width, height) * 0.045));
  return `
    <defs>
      <filter id="watermark-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="2" stdDeviation="2" flood-color="#111827" flood-opacity="0.35" />
      </filter>
    </defs>
    <text x="${width - padding}" y="${height - padding}" text-anchor="end"
      font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700"
      fill="#ffffff" fill-opacity="0.62" stroke="#111827" stroke-opacity="0.42"
      stroke-width="3" paint-order="stroke fill" filter="url(#watermark-shadow)">
      ${escapeXml(watermark)}
    </text>`;
}

export async function renderProductImage(input: Buffer, config: ImageRenderConfig): Promise<Buffer> {
  const normalized = await sharp(input).rotate().png().toBuffer();
  const metadata = await sharp(normalized).metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法读取图片尺寸");

  const annotations = config.imageIndex === 2 ? config.annotations.slice(0, 6) : [];
  const watermark = config.applyWatermark ? config.watermark : "";
  if (annotations.length === 0 && !watermark) return normalized;

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"
    width="${metadata.width}" height="${metadata.height}" viewBox="0 0 ${metadata.width} ${metadata.height}">
    ${annotationSvg(metadata.width, metadata.height, annotations)}
    ${watermarkSvg(metadata.width, metadata.height, watermark)}
  </svg>`);

  return sharp(normalized)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
