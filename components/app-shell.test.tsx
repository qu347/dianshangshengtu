import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

it("highlights the product studio and links to clothing studio", () => {
  render(<AppShell active="product-studio"><div>工作区</div></AppShell>);

  expect(screen.getByRole("link", { name: "全品类商品图" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "服装组图" })).not.toHaveAttribute("aria-current");
  expect(screen.getByText("工作区")).toBeInTheDocument();
});

it("links the video remake module and highlights it when active", () => {
  render(<AppShell active="video-remake"><div>工作区</div></AppShell>);

  const link = screen.getByRole("link", { name: "爆款视频复刻" });
  expect(link).toHaveAttribute("href", "/video-remake");
  expect(link).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "全品类商品图" })).not.toHaveAttribute("aria-current", "page");
});

it("links the product intro video module and highlights it when active", () => {
  render(<AppShell active="product-video"><div>工作区</div></AppShell>);

  const link = screen.getByRole("link", { name: "商品介绍视频" });
  expect(link).toHaveAttribute("href", "/product-video");
  expect(link).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "爆款视频复刻" })).not.toHaveAttribute("aria-current", "page");
});

it("marks clothing studio as the active module", () => {
  render(<AppShell active="clothing-studio"><div>服装工作区</div></AppShell>);
  expect(screen.getByRole("link", { name: "服装组图" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "全品类商品图" })).not.toHaveAttribute("aria-current");
});
