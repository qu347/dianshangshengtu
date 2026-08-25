import type { ProductAnalysis } from "../model";

const confidenceLabels = {
  observed: "图片观察",
  inferred: "AI 推断",
  user_provided: "用户提供",
} as const;

export function AnalysisPanel({ analysis }: { analysis: ProductAnalysis }) {
  return (
    <div>
      <p className="text-sm text-black/55">商品类目</p>
      <p className="mt-1 font-medium">{analysis.category}</p>
      <p className="mt-3 text-sm text-black/55">产品名称</p>
      <p className="mt-1 font-medium">{analysis.productName}</p>

      <h2 className="mt-5 font-medium">视觉信息</h2>
      <ul className="mt-2 space-y-2">
        {analysis.visualFacts.map((fact, index) => (
          <li key={`${fact.value}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#f5f6f8] px-3 py-2">
            <span>{fact.value}</span>
            <span className="shrink-0 text-xs text-black/55">{confidenceLabels[fact.confidence]}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-5 font-medium">目标人群</h2>
      <p className="mt-2">{analysis.audience.join("、")}</p>

      <h2 className="mt-5 font-medium">卖点依据</h2>
      <ul className="mt-2 space-y-2">
        {analysis.sellingPoints.map((point, index) => (
          <li key={`${point.title}-${index}`} className="rounded-lg bg-[#f5f6f8] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span>{point.title}</span>
              <span className="shrink-0 text-xs text-black/55">{confidenceLabels[point.confidence]}</span>
            </div>
            <p className="mt-1 text-sm text-black/55">依据：{point.evidence}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-5 font-medium">视觉方向</h2>
      <p className="mt-2">{analysis.visualDirection}</p>
    </div>
  );
}
