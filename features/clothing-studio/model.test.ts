import {
  ClothingCategorySchema,
  ClothingGenerationSettingsSchema,
  ClothingGenerationTaskSchema,
  ClothingPlanItemSchema,
  ModelCandidateRequestSchema,
  SceneCandidateRequestSchema,
  validateReferenceAsset,
} from "./model";

const defaultSettings = {
  platform: "taobao",
  language: "zh-CN",
  aspectRatio: "1090x1443",
  imageCount: 4,
  quality: "auto",
  watermark: "",
} as const;

const defaultModelRequest = {
  gender: "female",
  ageRange: "26-35",
  appearance: "asian",
  bodyType: "regular",
  hairstyle: "medium",
  requirements: "自然站姿",
  count: 2,
  quality: "auto",
} as const;

it("accepts 1-16 clothing images and enforces platform language", () => {
  expect(ClothingGenerationSettingsSchema.parse({
    ...defaultSettings,
    platform: "ozon",
    language: "ru",
    imageCount: 16,
  })).toMatchObject({ imageCount: 16, language: "ru" });

  expect(() => ClothingGenerationSettingsSchema.parse({ ...defaultSettings, imageCount: 0 })).toThrow();
  expect(() => ClothingGenerationSettingsSchema.parse({ ...defaultSettings, imageCount: 17 })).toThrow();
  expect(() => ClothingGenerationSettingsSchema.parse({
    ...defaultSettings,
    platform: "amazon",
    language: "zh-CN",
  })).toThrow("平台语言必须使用固定映射");
});

it("supports only the approved first-version clothing categories", () => {
  expect(ClothingCategorySchema.options).toEqual(["top", "bottom", "dress", "coat", "set"]);
});

it("supports a dedicated three-dimensional product type for the first clothing image", () => {
  expect(ClothingPlanItemSchema.parse({
    id: "1",
    type: "product",
    title: "白底立体服装主图",
    objective: "完整展示服装",
    copy: "",
    scene: "纯白背景",
    prompt: "生成白底立体服装主图",
  }).type).toBe("product");
});

it("normalizes the legacy flat-lay plan type to the canonical product type", () => {
  expect(ClothingPlanItemSchema.parse({
    id: "1",
    type: "flat_lay",
    title: "旧版白底主图",
    objective: "完整展示服装",
    copy: "",
    scene: "纯白背景",
    prompt: "生成纯白背景立体服装主图，不显示人物",
  }).type).toBe("product");
});

it("limits model and scene candidate requests to 1-4 images", () => {
  expect(ModelCandidateRequestSchema.parse(defaultModelRequest).count).toBe(2);
  expect(() => ModelCandidateRequestSchema.parse({ ...defaultModelRequest, count: 5 })).toThrow();

  const sceneRequest = {
    style: "mobile",
    venue: "street",
    lighting: "natural",
    season: "autumn",
    requirements: "",
    count: 4,
    aspectRatio: "1090x1443",
    quality: "auto",
  };
  expect(SceneCandidateRequestSchema.parse(sceneRequest).count).toBe(4);
  expect(() => SceneCandidateRequestSchema.parse({ ...sceneRequest, count: 0 })).toThrow();
});

it("requires exactly one source for an uploaded or generated reference", () => {
  const file = new File(["image"], "model.webp", { type: "image/webp" });
  expect(validateReferenceAsset({
    id: "uploaded-model",
    kind: "model",
    source: "upload",
    previewUrl: "blob:model",
    file,
  }).file).toBe(file);
  expect(validateReferenceAsset({
    id: "generated-scene",
    kind: "scene",
    source: "generated",
    previewUrl: "/api/clothing/download?token=opaque",
    downloadToken: "opaque",
  }).downloadToken).toBe("opaque");
  expect(() => validateReferenceAsset({
    id: "ambiguous",
    kind: "model",
    source: "upload",
    previewUrl: "blob:model",
    file,
    downloadToken: "opaque",
  })).toThrow("参考图来源无效");
});

it("requires successful clothing tasks to include preview and download data", () => {
  expect(() => ClothingGenerationTaskSchema.parse({
    planItemId: "1",
    status: "succeeded",
    progress: 100,
  })).toThrow("成功任务必须包含结果地址和下载令牌");
  expect(ClothingGenerationTaskSchema.parse({
    planItemId: "1",
    status: "succeeded",
    progress: 100,
    resultUrl: "http://localhost/api/clothing/download?token=opaque",
    downloadToken: "opaque",
  }).status).toBe("succeeded");
});
