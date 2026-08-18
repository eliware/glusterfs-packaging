const origin = location.origin;
const jsonCache = new Map();

async function getJson(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  const request = fetch(`${origin}${path}`, { cache: "force-cache" }).then(
    async (response) => {
      if (!response.ok) throw new Error(`request failed: ${response.status}`);
      return response.json();
    },
  );
  jsonCache.set(path, request);
  try {
    return await request;
  } catch (error) {
    jsonCache.delete(path);
    throw error;
  }
}

export const fetchCatalog = () => getJson("/api/v1/catalog");
export const fetchDirectory = (path) =>
  getJson(`/api/v1/list?path=${encodeURIComponent(path)}`);
export const fetchRepositoryIndex = () =>
  getJson("/metadata/repository-index.json");
export const fetchReleaseManifest = () =>
  getJson("/metadata/release-manifest.json");
export { origin };
