import type { ProductAnalysis } from "../model";

const confidenceLabels = {
  observed: "图片观察",
  inferred: "AI 推断",
  user_provided: "用户提供",
} as const;

export function AnalysisPanel({ analysis }: { analysis: ProductAnalysis }) {
  return (
    <section aria-labelledby="analysis-panel-title" className="rounded-xl border border-[#e4e7ec] bg-[#fafbfc] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7b808b]">AI PRODUCT INSIGHT</p>
          <h2 id="analysis-panel-title" className="mt-1 text-base font-semibold text-[#202329]">商品洞察</h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">分析完成</span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-3 ring-1 ring-black/5">
          <dt className="text-xs text-[#7b808b]">商品类目</dt>
          <dd className="mt-1 text-sm font-medium text-[#24272d]">{analysis.category}</dd>
        </div>
        <div className="rounded-lg bg-white p-3 ring-1 ring-black/5">
          <dt className="text-xs text-[#7b808b]">产品名称</dt>
          <dd className="mt-1 text-sm font-medium text-[#24272d]">{analysis.productName}</dd>
        </div>
      </dl>

      <h3 className="mt-5 text-sm font-semibold text-[#343840]">视觉信息</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {analysis.visualFacts.map((fact, index) => (
          <li key={`${fact.value}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 text-sm ring-1 ring-black/5">
            <span className="text-[#343840]">{fact.value}</span>
            <span className="shrink-0 rounded-full bg-[#f0eefc] px-2 py-0.5 text-[11px] text-[#6558ba]">{confidenceLabels[fact.confidence]}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-[#343840]">目标人群</h3>
      <p className="mt-2 text-sm leading-6 text-[#555a64]">{analysis.audience.join("、")}</p>

      <h3 className="mt-5 text-sm font-semibold text-[#343840]">卖点依据</h3>
      <ul className="mt-2 space-y-2">
        {analysis.sellingPoints.map((point, index) => (
          <li key={`${point.title}-${index}`} className="rounded-lg bg-white px-3 py-2.5 text-sm ring-1 ring-black/5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-[#343840]">{point.title}</span>
              <span className="shrink-0 text-[11px] text-[#777c86]">{confidenceLabels[point.confidence]}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#777c86]">依据：{point.evidence}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-[#343840]">视觉方向</h3>
      <p className="mt-2 rounded-lg bg-[#eeebff] px-3 py-2.5 text-sm leading-6 text-[#51458f]">{analysis.visualDirection}</p>
    </section>
  );
}
