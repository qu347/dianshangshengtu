"use client";

import { useCallback, useState } from "react";
import { preprocessClothingImage, validateGarmentFiles } from "../lib/image-files";

type GarmentUploaderProps = {
  files: File[];
  onFilesChanged: (files: File[]) => void;
  disabled?: boolean;
};

function Preview({ file }: { file: File }) {
  const imageRef = useCallback((element: HTMLImageElement | null) => {
    if (!element) return;
    const url = URL.createObjectURL(file);
    element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Blob URLs cannot use Next.js image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={imageRef} alt={file.name} className="size-20 rounded-xl object-cover" />;
}
export function GarmentUploader({ files, onFilesChanged, disabled = false }: GarmentUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(selected: File[]) {
    const errors = validateGarmentFiles(selected);
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    try {
      const processed = await Promise.all(selected.map(preprocessClothingImage));
      setError(null);
      onFilesChanged(processed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "服装图片处理失败");
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#ccd0d8] bg-[#fafbfc] px-4 py-5 text-center transition hover:border-[#17191d] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
        <input
          className="sr-only"
          aria-label="上传服装图"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(event) => void handleFiles(Array.from(event.currentTarget.files ?? []))}
        />
        <span className="flex size-9 items-center justify-center rounded-xl bg-[#17191d] text-xl text-white">+</span>
        <span className="mt-2 text-sm font-semibold">选择或拖入服装图</span>
        <span className="mt-1 text-xs text-[#777c86]">JPG、PNG、WEBP · 最多 6 张</span>
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {files.length > 0 && (
        <ul aria-label="已选服装图" className="grid grid-cols-3 gap-3">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="min-w-0">
              <div className="relative size-20 overflow-hidden rounded-xl bg-[#f0f1f3]">
                <Preview file={file} />
                <button
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  disabled={disabled}
                  onClick={() => onFilesChanged(files.filter((_, itemIndex) => itemIndex !== index))}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/65 text-white"
                >×</button>
              </div>
              <p className="mt-1 truncate text-xs text-[#555a64]">{file.name}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
