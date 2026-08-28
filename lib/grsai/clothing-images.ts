import type {
  ClothingGenerationSettings,
  ClothingPlanItem,
} from "@/features/clothing-studio/model";
import { targetLanguageDisplayName } from "@/features/product-studio/lib/platform-rules";

export function buildClothingGenerationPrompt(
  item: ClothingPlanItem,
  settings: ClothingGenerationSettings,
  options: { hasScene: boolean },
) {
  if (item.id === "1") {
    return [
      "只使用服装参考图，不使用模特参考图或场景参考图。",
      "生成当前销售服装的正面白底立体服装主图，采用隐形模特式立体成衣轮廓，呈现接近自然穿着时的成衣版型；不要平铺，不要俯拍。",
      "严格保持颜色、版型、材质、纹理、图案、原有 Logo 和 SKU 特征不变。",
      "肩线、领口、袖型、袖口、衣身和下摆结构自然，保留少量真实面料褶皱、厚度与垂坠；服装内部保留柔和真实的结构光影。",
      "避免过度熨平、塑料感、充气感、悬浮感、僵硬对称或夸张褶皱。",
      "服装完整居中、不裁切，四周保留安全边距；整张画布为无渐变、无纹理的纯白背景。",
      "不显示人物、皮肤或实体模特，不出现衣架、道具、尺寸线或其他商品；服装外部不生成投影或灰色光晕。",
      "画面中不要生成任何营销文字；参考图原有 Logo 或印花属于商品本体，必须准确保留，不得新增文字。",
      `用户确认的中文提示词：${item.prompt}`,
    ].join("\n");
  }

  return [
    "第 1 组参考图与白底立体服装主图属于同一件销售服装，保持颜色、版型、纹理、图案、Logo 和关键结构一致。",
    "白底立体服装主图是商品标准参考；模特穿着时应符合真实人体结构，不得保留空心隐形模特效果。",
    "所有人物参考图均为同一位模特；保持脸部、体型、肤色和发型一致，只改变姿势、镜头和构图。",
    options.hasScene
      ? "场景参考图定义整组空间、光线与视觉风格；允许改变机位、景别和局部布置。"
      : "没有指定场景参考图；使用与服装匹配且整组统一的简洁场景。",
    `图片类型：${item.type}。任务目标：${item.objective}。场景与构图：${item.scene}。`,
    item.copy ? `画面文案：${item.copy}。` : "",
    `用户确认的中文提示词：${item.prompt}。`,
    settings.language === "none"
      ? "画面中不要生成任何文字。"
      : `文案语言必须为${targetLanguageDisplayName(settings.language)}。`,
    item.type === "model"
      ? "非协商要求：必须显示所选真人模特，服装必须真实穿着在该模特身上，不得保留空心隐形模特效果。"
      : "",
  ].filter(Boolean).join("\n");
}
