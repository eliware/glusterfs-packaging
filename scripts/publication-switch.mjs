import path from "node:path";
import { lstat, mkdir, rename, rm, symlink } from "node:fs/promises";

export async function switchPublicationTarget(target, source, generation) {
  const next = `${target}.next`;
  await mkdir(path.dirname(target), { recursive: true });
  await rm(next, { recursive: true, force: true });
  await symlink(path.relative(path.dirname(target), source), next, "dir");
  try {
    const current = await lstat(target);
    if (current.isSymbolicLink()) {
      await rename(next, target);
      return;
    }
    const previousTarget = `${target}.previous-${generation}`;
    await rename(target, previousTarget);
    try {
      await rename(next, target);
    } catch (error) {
      await rename(previousTarget, target).catch(() => {});
      throw error;
    }
    await rm(previousTarget, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await rename(next, target);
  }
}
