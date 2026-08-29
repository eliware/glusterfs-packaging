export function pythonPatchAction(sourceText) {
  if (sourceText === null) return "skip-missing";
  if (sourceText.includes("sys.version[[:4]]")) return "skip-applied";
  if (sourceText.includes("sys.version[[:3]]")) return "apply";
  return "error";
}
