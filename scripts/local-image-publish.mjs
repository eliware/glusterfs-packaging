export function aliasImageName(image, alias) {
  return `${image.slice(0, image.lastIndexOf(":"))}:${alias}`;
}

export async function publishLocalImage(config) {
  for (const alias of config.aliases) {
    await config.loggedRun(config.runtime, [
      "tag",
      config.image,
      aliasImageName(config.image, alias),
    ]);
  }
  if (!config.publishImage) return;
  await publishOne(config, config.image);
  for (const alias of config.aliases)
    await publishOne(config, aliasImageName(config.image, alias));
}

async function publishOne(config, image) {
  await config.loggedInteractive("node", [config.publishScript, image], {
    env: { ...process.env, CONTAINER_RUNTIME: config.runtime },
  });
}
