import type { ClothingAnalysis } from "../model";

const categoryLabels = {
  top: "上装",
  bottom: "下装",
  dress: "连衣裙",
  coat: "外套",
  set: "套装",
} as const;

export function ClothingAnalysisPanel({ analysis }: { analysis: ClothingAnalysis }) {
  return (
    <section aria-labelledby="clothing-analysis-title" className="grid gap-3 rounded-2xl bg-[#f7f7f8] p-4 sm:grid-cols-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#838892]">PRODUCT</p>
        <h3 id="clothing-analysis-title" className="mt-1 font-semibold">{analysis.productName}</h3>
        <p className="mt-1 text-xs text-[#727781]">{categoryLabels[analysis.category]}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-[#4d525b]">视觉事实</p>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-[#707580]">
          {analysis.visualFacts.slice(0, 3).map((fact) => <li key={fact.value}>· {fact.value}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold text-[#4d525b]">整组方向</p>
        <p className="mt-2 text-xs leading-5 text-[#707580]">{analysis.visualDirection}</p>
      </div>
    </section>
  );
}
