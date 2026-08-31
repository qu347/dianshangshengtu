import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ active, children }: {
  active: "product-studio" | "video-remake" | "clothing-studio";
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#17191d]">
      <header className="sticky top-0 z-20 border-b border-[#e4e7ec] bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center gap-4 px-4 py-2 md:px-8">
          <div className="flex shrink-0 items-center gap-3">
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-[#17191d] text-xs font-bold text-white">AI</span>
            <span>
              <span className="block text-sm font-semibold">AI 电商视觉</span>
              <span className="block text-[11px] text-[#777c86]">商品生成工作台</span>
            </span>
          </div>
          <nav aria-label="模块导航" className="order-3 flex w-full gap-1 overflow-x-auto rounded-xl bg-[#f4f5f7] p-1 md:order-none md:ml-5 md:w-auto">
            <Link
              href="/product-studio"
              aria-current={active === "product-studio" ? "page" : undefined}
              className={active === "product-studio" ? "shrink-0 rounded-lg bg-[#17191d] px-3.5 py-2 text-sm text-white shadow-sm" : "shrink-0 rounded-lg px-3.5 py-2 text-sm text-[#626773]"}
            >
              全品类商品图
            </Link>
            <Link
              href="/video-remake"
              aria-current={active === "video-remake" ? "page" : undefined}
              className={active === "video-remake" ? "shrink-0 rounded-lg bg-[#17191d] px-3.5 py-2 text-sm text-white shadow-sm" : "shrink-0 rounded-lg px-3.5 py-2 text-sm text-[#626773]"}
            >
              爆款视频复刻
            </Link>
            <span className="shrink-0 rounded-lg px-3.5 py-2 text-sm text-[#9a9ea7]">服装组图</span>
          </nav>
          <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#f4f5f7] px-3 py-2 text-xs text-[#5f646e]">
            <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
            本地模式
          </span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
