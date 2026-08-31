import { ModelCandidateRequestSchema } from "@/features/clothing-studio/model";
import { submitCandidateBatch } from "@/lib/clothing-candidate-jobs";
import { clothingRequestHeaders, validateClothingPostRequest } from "@/lib/clothing-upload";
import { buildModelCandidatePrompt } from "@/lib/grsai/clothing-candidates";
import { GrsaiError } from "@/lib/grsai/errors";
import { ZodError } from "zod";

export { clothingRequestHeaders };

export async function POST(request: Request) {
  const requestError = validateClothingPostRequest(request);
  if (requestError) return requestError;
  if (!process.env.GRSAI_API_KEY || !process.env.DOWNLOAD_TOKEN_SECRET) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }

  try {
    const input = ModelCandidateRequestSchema.parse(await request.json());
    const tasks = await submitCandidateBatch({
      kind: "model",
      count: input.count,
      promptForIndex: (index) => buildModelCandidatePrompt(input, index),
      aspectRatio: "1090x1443",
      quality: input.quality,
      requestUrl: request.url,
    });
    return Response.json({ tasks });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return Response.json({ error: "模特生成参数无效" }, { status: 400 });
    }
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "模特图生成提交失败，请稍后重试" }, { status: 500 });
  }
}
