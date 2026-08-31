import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

it("highlights the product studio and keeps clothing as a future module", () => {
  render(<AppShell active="product-studio"><div>工作区</div></AppShell>);

  expect(screen.getByRole("link", { name: "全品类商品图" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("服装组图")).toBeInTheDocument();
  expect(screen.getByText("工作区")).toBeInTheDocument();
});

it("links the video remake module and highlights it when active", () => {
  render(<AppShell active="video-remake"><div>工作区</div></AppShell>);

  const link = screen.getByRole("link", { name: "爆款视频复刻" });
  expect(link).toHaveAttribute("href", "/video-remake");
  expect(link).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "全品类商品图" })).not.toHaveAttribute("aria-current", "page");
});
