const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_RAW_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function resizeImageToDataUrl(
  file: File,
  maxSize = 1024
): Promise<string> {
  // 1. Validate MIME type
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error(
      `Unsupported image type: ${file.type}. Use PNG, JPEG, WebP, or GIF.`
    );
  }

  // 2. Validate raw file size
  if (file.size > MAX_RAW_FILE_SIZE) {
    throw new Error(
      `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`
    );
  }

  // 3. Load into an Image element
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // 4. Compute scaled dimensions (preserve aspect ratio)
  let targetW = width;
  let targetH = height;
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    targetW = Math.round(width * ratio);
    targetH = Math.round(height * ratio);
  }

  // 5. Draw onto off-screen canvas
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // 6. Export as data URL
  //    Use JPEG 0.85 for photos (smaller payload), PNG for anything else
  const isPhoto =
    file.type === "image/jpeg" || file.type === "image/webp";
  return isPhoto
    ? canvas.toDataURL("image/jpeg", 0.85)
    : canvas.toDataURL("image/png");
}
