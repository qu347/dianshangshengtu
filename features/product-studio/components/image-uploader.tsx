"use client";

import { useCallback, useState } from "react";
import { preprocessProductImage, validateProductFiles } from "../lib/image-files";

type ImageUploaderProps = {
  files: File[];
  onFilesChanged: (files: File[]) => void;
  disabled?: boolean;
};

function ImagePreview({ file }: { file: File }) {
  const imageRef = useCallback((element: HTMLImageElement | null) => {
    if (!element) return;
    const url = URL.createObjectURL(file);
    element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Blob URLs cannot use Next.js image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={imageRef} alt={file.name} className="size-24 rounded-xl object-cover" />;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageUploader({ files, onFilesChanged, disabled = false }: ImageUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(selected: File[]) {
    if (disabled) return;
    const errors = validateProductFiles(selected);
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    try {
      const processed = await Promise.all(selected.map(preprocessProductImage));
      setError(null);
      onFilesChanged(processed);
    } catch (error) {
      setError(error instanceof Error ? error.message : "图片处理失败");
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#cfd3dc] bg-[#fafbfc] px-4 py-5 text-center transition hover:border-[#9b91e8] hover:bg-[#f8f7ff] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
        <input
          className="sr-only"
          aria-label="上传产品图"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(event) => void handleFiles(Array.from(event.currentTarget.files ?? []))}
        />
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-[#17191d] text-lg leading-none text-white">+</span>
        <span className="mt-2 text-sm font-medium text-[#24272d]">选择或拖入产品图</span>
        <span className="mt-1 text-xs text-[#747984]">JPG、PNG、WEBP · 最多 6 张</span>
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {files.length > 0 && (
        <ul aria-label="已选产品图" className="grid grid-cols-3 gap-x-3 gap-y-4">
        {files.map((file, index) => (
          <li className="min-w-0" key={`${file.name}-${index}`}>
            <div className="relative size-24 overflow-hidden rounded-xl bg-[#f2f3f5] ring-1 ring-black/5">
              <ImagePreview file={file} />
              <button
                aria-label={`移除 ${file.name}`}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/65 text-sm leading-none text-white transition hover:bg-black disabled:opacity-50"
                type="button"
                disabled={disabled}
                onClick={() => onFilesChanged(files.filter((_, fileIndex) => fileIndex !== index))}
              >
                ×
              </button>
            </div>
            <p className="mt-1.5 truncate text-xs text-[#343840]" title={file.name}>{file.name}</p>
            <p className="mt-0.5 text-[11px] text-[#8a8f99]">{formatFileSize(file.size)}</p>
          </li>
        ))}
        </ul>
      )}
    </div>
  );
}
