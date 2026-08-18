const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".eot", "application/vnd.ms-fontobject"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
]);

export function getContentType(
  filePath,
  fallback = "application/octet-stream",
) {
  const dotIndex = filePath.lastIndexOf(".");
  const extension = dotIndex >= 0 ? filePath.slice(dotIndex).toLowerCase() : "";
  return MIME_TYPES.get(extension) || fallback;
}
