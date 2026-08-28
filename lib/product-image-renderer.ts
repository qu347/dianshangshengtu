import sharp from "sharp";
import type { ImageRenderConfig } from "./image-render-config";
import { fallbackDimensionLayout, type SmartDimensionLayout } from "./dimension-layout";
import { normalizeWhiteBackground } from "./product-image-validation";

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
  suppliedLayout?: SmartDimensionLayout,
) {
  if (annotations.length === 0) return "";

  const layout = suppliedLayout ?? fallbackDimensionLayout(annotations);
  const safeX = Math.round(width * 0.08);
  const safeY = Math.round(height * 0.08);
  const clamp = (value: number, minimum: number, maximum: number) => (
    Math.min(maximum, Math.max(minimum, value))
  );
  const left = clamp(Math.round(layout.bounds.left / 1000 * width), safeX, width - safeX * 2);
  const right = clamp(Math.round(layout.bounds.right / 1000 * width), left + 40, width - safeX);
  const top = clamp(Math.round(layout.bounds.top / 1000 * height), safeY, height - safeY * 2);
  const bottom = clamp(Math.round(layout.bounds.bottom / 1000 * height), top + 40, height - safeY);
  const preferredFontSize = Math.max(16, Math.round(width * 0.021));
  const minimumFontSize = 12;
  const tick = Math.max(14, Math.round(width * 0.016));
  const baseOffset = Math.max(42, Math.round(width * 0.045));
  const offsetStep = Math.max(30, Math.round(width * 0.032));
  const sideCounts: Record<string, number> = {};
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));

  const labelText = (annotation: ImageRenderConfig["annotations"][number]) => (
    `${annotation.label}  ${annotation.displayValue}`
  );
  const placementSvg = layout.placements.flatMap((placement) => {
    const annotation = byId.get(placement.id);
    if (!annotation) return [];
    const slot = sideCounts[placement.side] ?? 0;
    sideCounts[placement.side] = slot + 1;
    const offset = baseOffset + slot * offsetStep;
    const text = labelText(annotation);

    if (placement.axis === "horizontal") {
      const above = placement.side !== "bottom";
      const y = above
        ? clamp(top - offset, safeY, top - 12)
        : clamp(bottom + offset, bottom + 12, height - safeY);
      const textLayout = fitText(text, preferredFontSize, minimumFontSize, right - left, 2);
      const textY = above
        ? y - Math.max(10, Math.round(preferredFontSize * 0.45))
        : y + textLayout.fontSize + Math.max(10, Math.round(preferredFontSize * 0.35));
      return [`
        <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#111111" stroke-width="3" />
        <line x1="${left}" y1="${y - tick}" x2="${left}" y2="${y + tick}" stroke="#111111" stroke-width="3" />
        <line x1="${right}" y1="${y - tick}" x2="${right}" y2="${y + tick}" stroke="#111111" stroke-width="3" />
        ${textLinesSvg(Math.round((left + right) / 2), textY, textLayout, 'text-anchor="middle" font-weight="700" fill="#111111"')}`];
    }

    if (placement.axis === "vertical") {
      const onLeft = placement.side === "left";
      const x = onLeft
        ? clamp(left - offset, safeX, left - 12)
        : clamp(right + offset, right + 12, width - safeX);
      const available = onLeft ? x - safeX : width - safeX - x;
      const textLayout = fitText(text, preferredFontSize, minimumFontSize, Math.max(80, available), 3);
      const textX = onLeft ? x - tick - 8 : x + tick + 8;
      const textY = Math.round((top + bottom) / 2 - textLayout.lineHeight * (textLayout.lines.length - 1) / 2);
      return [`
        <line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#111111" stroke-width="3" />
        <line x1="${x - tick}" y1="${top}" x2="${x + tick}" y2="${top}" stroke="#111111" stroke-width="3" />
        <line x1="${x - tick}" y1="${bottom}" x2="${x + tick}" y2="${bottom}" stroke="#111111" stroke-width="3" />
        ${textLinesSvg(textX, textY, textLayout, `${onLeft ? 'text-anchor="end"' : ''} font-weight="700" fill="#111111"`)}`];
    }

    const onLeft = placement.side === "left";
    const startX = onLeft ? left : right;
    const startY = clamp(Math.round((top + bottom) / 2 + slot * offsetStep), top, bottom);
    const elbowX = onLeft ? startX - offset : startX + offset;
    const endX = onLeft ? safeX : width - safeX;
    const textMaxWidth = Math.max(100, Math.abs(endX - elbowX) - 12);
    const textLayout = fitText(text, preferredFontSize, minimumFontSize, textMaxWidth, 3);
    return [`
      <polyline points="${startX},${startY} ${elbowX},${startY} ${endX},${startY}"
        fill="none" stroke="#111111" stroke-width="3" />
      <circle cx="${startX}" cy="${startY}" r="4" fill="#111111" />
      ${textLinesSvg(onLeft ? endX : elbowX + 8, startY - 10, textLayout, `${onLeft ? 'text-anchor="start"' : ''} font-weight="700" fill="#111111"`)}`];
  }).join("");

  return placementSvg;
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
  const inputMetadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (inputMetadata.format === "svg") throw new Error("不支持 SVG 图片");

  let normalized: Buffer;
  const isDimensionImage = config.imageIndex === 2
    && (config.annotations.length > 0 || config.dimensionLayout !== undefined);
  try {
    normalized = config.imageIndex === 1 || isDimensionImage
      ? await normalizeWhiteBackground(input)
      : await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().png().toBuffer();
  } catch {
    throw new Error(config.imageIndex === 1
      ? "白底商品主图不是纯白背景"
      : "尺寸图不是纯白背景");
  }
  const info = await sharp(normalized, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (
    !info.width
    || !info.height
    || info.width > MAX_IMAGE_DIMENSION
    || info.height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error("图片尺寸超过限制");
  }

  const annotations = isDimensionImage ? config.annotations.slice(0, 6) : [];
  const watermark = config.applyWatermark ? config.watermark : "";
  if (annotations.length === 0 && !watermark) return normalized;

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"
    width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}">
    ${annotationSvg(info.width, info.height, annotations, config.dimensionLayout)}
    ${watermarkSvg(info.width, info.height, watermark)}
  </svg>`);

  return sharp(normalized, { limitInputPixels: MAX_INPUT_PIXELS })
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
