import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ScriptEditor } from "./script-editor";

it("rejects a four-second scene edit and accepts five seconds", () => {
  const onChange = vi.fn();
  render(<ScriptEditor
    script={{
      styleNotes: "warm studio",
      scenes: [{ id: "1", title: "opening", description: "product closeup", onScreenText: "", durationSec: 6 }],
    }}
    settings={{ aspectRatio: "9:16", durationSec: 6, language: "zh-CN", quality: "480p" }}
    onChange={onChange}
    onReanalyze={vi.fn()}
    onConfirm={vi.fn()}
  />);

  const duration = screen.getByLabelText("第 1 镜时长");
  expect(duration).toHaveAttribute("min", "5");

  fireEvent.change(duration, { target: { value: "4" } });
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.change(duration, { target: { value: "5" } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    scenes: [expect.objectContaining({ durationSec: 5 })],
  }));
});
