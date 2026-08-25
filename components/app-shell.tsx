import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ active, children }: {
  active: "product-studio" | "clothing-studio";
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#17191d]">
      <header className="flex h-14 items-center justify-between border-b border-black/10 bg-white px-5">
        <span className="font-medium">AI 电商视觉</span>
        <span className="text-sm text-black/55">本地模式</span>
      </header>
      <div className="grid min-h-[calc(100vh-3.5rem)] md:grid-cols-[220px_1fr]">
        <nav aria-label="模块导航" className="flex gap-2 border-b border-black/10 bg-white p-3 md:block md:border-r md:border-b-0">
          <Link href="/product-studio" aria-current={active === "product-studio" ? "page" : undefined}
            className={active === "product-studio" ? "block rounded-lg bg-[#17191d] px-3 py-2 text-sm text-white" : "block rounded-lg px-3 py-2 text-sm"}>
            全品类商品图
          </Link>
          <span className="block rounded-lg px-3 py-2 text-sm text-black/55">服装组图</span>
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
