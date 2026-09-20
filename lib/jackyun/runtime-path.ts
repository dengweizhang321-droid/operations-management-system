import path from "node:path";

export function resolveJackyunChromeProfileDirectory(input: {
  cwd?: string;
  configuredProfileDirectory?: string;
} = {}) {
  const cwd = input.cwd?.trim();
  const root = cwd ? path.resolve(cwd) : ".";
  const configured = input.configuredProfileDirectory?.trim();
  if (!configured) return path.join(root, ".runtime", "jackyun-chrome-profile");
  if (path.isAbsolute(configured)) return path.normalize(configured);
  return cwd ? path.resolve(root, configured) : path.normalize(configured);
}
