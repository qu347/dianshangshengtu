import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { GarmentUploader } from "./garment-uploader";

it("rejects more than six garment files and supports removing a selected thumbnail", async () => {
  const onFilesChanged = vi.fn();
  const { rerender } = render(<GarmentUploader files={[]} onFilesChanged={onFilesChanged} />);
  const files = Array.from({ length: 7 }, (_, index) => (
    new File(["x"], `${index}.png`, { type: "image/png" })
  ));
  await userEvent.upload(screen.getByLabelText("上传服装图"), files);
  expect(screen.getByRole("alert")).toHaveTextContent("最多上传 6 张服装图");
  expect(onFilesChanged).not.toHaveBeenCalled();

  const one = new File(["x"], "dress.png", { type: "image/png" });
  rerender(<GarmentUploader files={[one]} onFilesChanged={onFilesChanged} />);
  await userEvent.click(screen.getByRole("button", { name: "移除 dress.png" }));
  expect(onFilesChanged).toHaveBeenCalledWith([]);
});

