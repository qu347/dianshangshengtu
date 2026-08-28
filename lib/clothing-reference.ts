import sharp from "sharp";
import { verifyDownloadToken } from "./download-token";
import { fetchPublicImage } from "./remote-image";
import { validateClothingImages } from "./clothing-upload";

type ReferenceOptions = {
  fileField: string;
  tokenField: string;
  label: string;
  required: boolean;
};

type ReferenceDependencies = {
  fetchImage?: (url: string) => Promise<Buffer>;
};

function validCandidateRender(render: ReturnType<typeof verifyDownloadToken>["render"]) {
  return render.imageIndex === 99
    && render.annotations.length === 0
    && render.watermark === ""
    && render.applyWatermark === false
    && render.dimensionLayout === undefined;
}

export async function resolveClothingReference(
  form: FormData,
  options: ReferenceOptions,
  tokenSecret: string,
  dependencies: ReferenceDependencies = {},
): Promise<string | undefined> {
  const files = form.getAll(options.fileField).filter((value): value is File => value instanceof File);
  const tokenValue = form.get(options.tokenField);
  const token = typeof tokenValue === "string" && tokenValue.trim() ? tokenValue : undefined;

  if (files.length === 0 && !token) {
    if (!options.required) return undefined;
    throw new Error(`${options.label}来源无效`);
  }
  if (files.length > 0 && token) throw new Error(`${options.label}来源无效`);

  if (files.length > 0) {
    const validated = await validateClothingImages(form, options.fileField, {
      min: 1,
      max: 1,
      label: options.label,
    });
    if ("error" in validated) throw new Error(validated.error);
    const [file] = validated.images;
    return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  }

  try {
    const verified = verifyDownloadToken(token!, tokenSecret);
    if (!validCandidateRender(verified.render)) throw new Error();
    const source = await (dependencies.fetchImage ?? fetchPublicImage)(verified.url);
    const png = await sharp(source).rotate().png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    throw new Error(`${options.label}来源无效`);
  }
}
