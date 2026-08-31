import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SceneGrid } from "./scene-grid";

it("shows a cancelled unfinished scene as retryable instead of generating", () => {
  render(<SceneGrid
    script={{ styleNotes: "studio", scenes: [{ id: "1", title: "开场", description: "商品特写", onScreenText: "", durationSec: 5 }] }}
    tasks={[{ sceneId: "1", status: "failed", progress: 40, error: "已取消，可重试" }]}
    onRetry={vi.fn()}
    onDownload={vi.fn()}
    onDownloadAll={vi.fn()}
  />);

  expect(screen.queryByText("生成中")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("已取消，可重试");
  expect(screen.getByRole("button", { name: "重试此分镜" })).toBeEnabled();
});
