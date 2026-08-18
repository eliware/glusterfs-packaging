import { hostname } from "node:os";

export function servingHostId() {
  const value = hostname().trim();
  return value.split("-").at(-1) || value || "unknown";
}
