globalThis.fetch = async () => {
  throw new Error(
    "Network access is disabled in Jest; inject a mocked fetch implementation",
  );
};
