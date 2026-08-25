import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ImageUploader } from "./image-uploader";

it("reports too many files without calling onFilesChanged", async () => {
  const onFilesChanged = vi.fn();
  render(<ImageUploader files={[]} onFilesChanged={onFilesChanged} />);
  const files = Array.from({ length: 7 }, (_, i) => new File(["x"], `${i}.png`, { type: "image/png" }));

  await userEvent.upload(screen.getByLabelText("上传产品图"), files);

  expect(screen.getByRole("alert")).toHaveTextContent("最多上传 6 张");
  expect(onFilesChanged).not.toHaveBeenCalled();
});
