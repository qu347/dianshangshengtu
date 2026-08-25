import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

it("highlights the product studio and keeps clothing as a future module", () => {
  render(<AppShell active="product-studio"><div>工作区</div></AppShell>);

  expect(screen.getByRole("link", { name: "全品类商品图" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("服装组图")).toBeInTheDocument();
  expect(screen.getByText("工作区")).toBeInTheDocument();
});
