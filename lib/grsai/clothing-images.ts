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
      "生成当前销售服装的正面平铺商品图，保持颜色、版型、材质、纹理、图案、Logo 和 SKU 特征不变。",
      "服装完整居中、不裁切，四周保留安全边距；整张画布为无渐变、无纹理的纯白背景。",
      "不出现人物、人体模型、衣架、道具、尺寸线或其他商品。",
      "画面中不要生成任何营销文字。",
      `用户确认的中文提示词：${item.prompt}`,
    ].join("\n");
  }

  return [
    "第 1 组参考图与白底平铺参考图属于同一件销售服装，保持颜色、版型、纹理、图案、Logo 和关键结构一致。",
    "白底平铺图是服装标准参考，不得把平铺形态复制到穿着状态。",
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
  ].filter(Boolean).join("\n");
}
