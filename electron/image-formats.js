// Shared by the renderer and the main process; sidecars are never image inputs.
export function isImageFile(file) {
  return typeof file === 'string' && /\.(jpe?g|png|tiff?|gif|webp|avif|bmp|heic|heif|nef|nrw|cr[23]|crw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw)$/i.test(file);
}
