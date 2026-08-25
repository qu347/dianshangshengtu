"use client";

import { useCallback, useState } from "react";
import { preprocessProductImage, validateProductFiles } from "../lib/image-files";

type ImageUploaderProps = {
  files: File[];
  onFilesChanged: (files: File[]) => void;
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
  return <img ref={imageRef} alt={file.name} />;
}

export function ImageUploader({ files, onFilesChanged }: ImageUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(selected: File[]) {
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
    <div>
      <input
        aria-label="上传产品图"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFiles(Array.from(event.currentTarget.files ?? []))}
      />
      {error && <p role="alert">{error}</p>}
      <div>
        {files.map((file, index) => (
          <div key={`${file.name}-${index}`}>
            <ImagePreview file={file} />
            <button type="button" onClick={() => onFilesChanged(files.filter((_, fileIndex) => fileIndex !== index))}>移除 {file.name}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
