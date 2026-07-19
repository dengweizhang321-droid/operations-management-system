import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function parseJsonText<T>(text: string): T {
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    return parseJsonText<T>(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`JSON 文件损坏或无法读取，已停止以免覆盖：${filePath}`, { cause: error });
  }
}

export async function readJsonFileOr<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if ((cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown, pretty = true) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await writeFile(tempPath, `${json}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await copyFile(tempPath, filePath);
    await rm(tempPath, { force: true });
  }
}
