import path from "node:path";

export function getRequestPath(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  return decodeURIComponent(url.pathname);
}

export function resolvePublicPath(publicDir, requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.resolve(publicDir, `.${normalizedPath}`);
  const normalizedPublicDir = path.resolve(publicDir) + path.sep;

  if (!resolvedPath.startsWith(normalizedPublicDir)) {
    return null;
  }

  return resolvedPath;
}
