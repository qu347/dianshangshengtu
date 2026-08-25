import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ProductStudio } from "./product-studio";
import { analysisWithTwoItems } from "../test-fixtures";

vi.mock("../lib/image-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/image-files")>();
  return { ...actual, preprocessProductImage: vi.fn(async (file: File) => file) };
});

it("uploads a product and shows the analysis", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  render(<ProductStudio api={{ analyze }} />);

  await userEvent.upload(
    screen.getByLabelText("上传产品图"),
    new File(["x"], "cup.png", { type: "image/png" }),
  );
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));

  expect(await screen.findByText(analysisWithTwoItems.visualDirection)).toBeInTheDocument();
  expect(screen.getByText("银色金属杯身")).toBeInTheDocument();
});
