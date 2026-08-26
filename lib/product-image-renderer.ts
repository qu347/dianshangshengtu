import sharp from "sharp";
import type { ImageRenderConfig } from "./image-render-config";
import { isWhiteBackgroundImage } from "./product-image-validation";

const MAX_INPUT_PIXELS = 4_000_000;
const MAX_IMAGE_DIMENSION = 4096;
const FONT_FAMILY = "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif";

type TextLayout = {
  fontSize: number;
  lineHeight: number;
  lines: string[];
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function glyphWidth(char: string) {
  if (/\s/u.test(char)) return 0.33;
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint >= 0x2e80 || codePoint > 0xffff) return 1.05;
  if (codePoint >= 0x0400 && codePoint <= 0x052f) {
    const isUppercase = char === char.toUpperCase() && char !== char.toLowerCase();
    return isUppercase ? 1.25 : 0.8;
  }
  if (/[MW@#%]/u.test(char)) return 0.85;
  if (/[A-Z]/u.test(char)) return 0.68;
  if (/[a-z0-9]/u.test(char)) return 0.56;
  return 0.45;
}

function textWidth(value: string, fontSize: number) {
  return Array.from(value).reduce((total, char) => total + glyphWidth(char), 0) * fontSize;
}

function wrapText(value: string, fontSize: number, maxWidth: number) {
  const lines: string[] = [];
  let current = "";

  for (const token of value.trim().split(/(\s+)/u).filter(Boolean)) {
    if (/^\s+$/u.test(token)) {
      if (current) current += " ";
      continue;
    }

    const candidate = `${current}${token}`;
    if (textWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.trim()) {
      lines.push(current.trimEnd());
      current = "";
    }

    for (const char of Array.from(token)) {
      if (current && textWidth(`${current}${char}`, fontSize) > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [""];
}

function fitText(
  value: string,
  preferredFontSize: number,
  minimumFontSize: number,
  maxWidth: number,
  maxLines = 2,
): TextLayout {
  for (let fontSize = preferredFontSize; fontSize >= minimumFontSize; fontSize -= 1) {
    const lines = wrapText(value, fontSize, maxWidth);
    if (lines.length <= maxLines) {
      return { fontSize, lineHeight: Math.ceil(fontSize * 1.2), lines };
    }
  }

  const lines = wrapText(value, minimumFontSize, maxWidth);
  return { fontSize: minimumFontSize, lineHeight: Math.ceil(minimumFontSize * 1.2), lines };
}

function textLinesSvg(
  x: number,
  y: number,
  layout: TextLayout,
  attributes: string,
) {
  const lines = layout.lines.map((line, index) => (
    `<tspan x="${x}" dy="${index === 0 ? 0 : layout.lineHeight}">${escapeXml(line)}</tspan>`
  )).join("");
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${layout.fontSize}" ${attributes}>${lines}</text>`;
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
  const preferredLabelSize = Math.max(16, Math.round(width * 0.022));
  const preferredValueSize = Math.max(18, Math.round(width * 0.028));
  const lineStart = Math.round(width * 0.55);
  const lineEnd = areaStart + padding;
  const textStart = lineEnd + padding;
  const textMaxWidth = width - textStart - padding;
  const slotHeight = height / (annotations.length + 1);

  const labels = annotations.map((annotation, index) => {
    const centerY = Math.round(slotHeight * (index + 1));
    const label = fitText(annotation.label, preferredLabelSize, 12, textMaxWidth);
    const value = fitText(annotation.displayValue, preferredValueSize, 12, textMaxWidth);
    const gap = Math.max(4, Math.round(label.fontSize * 0.25));
    const totalHeight = label.lineHeight * label.lines.length
      + gap
      + value.lineHeight * value.lines.length;
    const blockTop = centerY - totalHeight / 2;
    const labelY = Math.round(blockTop + label.fontSize);
    const valueY = Math.round(
      blockTop + label.lineHeight * label.lines.length + gap + value.fontSize,
    );
    return `
      <line x1="${lineStart}" y1="${centerY}" x2="${lineEnd}" y2="${centerY}"
        stroke="#27313f" stroke-width="2" opacity="0.72" />
      <circle cx="${lineStart}" cy="${centerY}" r="4" fill="#27313f" opacity="0.8" />
      ${textLinesSvg(textStart, labelY, label, 'fill="#27313f"')}
      ${textLinesSvg(textStart, valueY, value, 'font-weight="700" fill="#111827"')}`;
  }).join("");

  return `
    <rect x="${areaStart}" y="0" width="${areaWidth}" height="${height}"
      fill="#ffffff" opacity="0.78" />
    ${labels}`;
}

function watermarkSvg(width: number, height: number, watermark: string) {
  if (!watermark) return "";

  const padding = Math.max(18, Math.round(Math.min(width, height) * 0.035));
  const preferredFontSize = Math.max(24, Math.round(Math.min(width, height) * 0.045));
  const layout = fitText(watermark, preferredFontSize, 16, Math.round(width * 0.55));
  const firstLineY = height - padding - (layout.lines.length - 1) * layout.lineHeight;
  const text = textLinesSvg(
    width - padding,
    firstLineY,
    layout,
    'text-anchor="end" font-weight="700" fill="#ffffff" fill-opacity="0.62" '
      + 'stroke="#111827" stroke-opacity="0.42" stroke-width="3" '
      + 'paint-order="stroke fill" filter="url(#watermark-shadow)"',
  );
  return `
    <defs>
      <filter id="watermark-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="2" stdDeviation="2" flood-color="#111827" flood-opacity="0.35" />
      </filter>
    </defs>
    ${text}`;
}

export async function renderProductImage(input: Buffer, config: ImageRenderConfig): Promise<Buffer> {
  if (config.imageIndex === 1 && !await isWhiteBackgroundImage(input)) {
    throw new Error("白底商品主图不是纯白背景");
  }
  const inputMetadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (inputMetadata.format === "svg") throw new Error("不支持 SVG 图片");

  const { data: normalized, info } = await sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
  }).rotate().png().toBuffer({ resolveWithObject: true });
  if (
    !info.width
    || !info.height
    || info.width > MAX_IMAGE_DIMENSION
    || info.height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error("图片尺寸超过限制");
  }

  const annotations = config.imageIndex === 2 ? config.annotations.slice(0, 6) : [];
  const watermark = config.applyWatermark ? config.watermark : "";
  if (annotations.length === 0 && !watermark) return normalized;

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"
    width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}">
    ${annotationSvg(info.width, info.height, annotations)}
    ${watermarkSvg(info.width, info.height, watermark)}
  </svg>`);

  return sharp(normalized, { limitInputPixels: MAX_INPUT_PIXELS })
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
