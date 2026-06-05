import { resolve, isAbsolute } from "node:path";
import { config as loadEnv } from "dotenv";

/** Read `--path <dir>` / `--path=<dir>` from argv; fall back to the process cwd. */
export function resolveBaseDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") return resolve(argv[i + 1] ?? ".");
    if (a?.startsWith("--path=")) return resolve(a.slice("--path=".length));
  }
  return process.cwd();
}

/** Turn a possibly-relative `file:` SQLite URL into an absolute one anchored at baseDir. */
function absoluteFileUrl(url: string, baseDir: string): string {
  if (!url.startsWith("file:")) return url;
  const p = url.slice("file:".length);
  if (isAbsolute(p)) return url;
  return `file:${resolve(baseDir, p).replace(/\\/g, "/")}`;
}

/**
 * Resolve env that the server needs from baseDir so the launcher only has to
 * pass `--path <dir>`: load <baseDir>/.env (keeps secrets out of mcp.json) and
 * make HARNESS_DB_URL absolute (so the cwd we are launched from is irrelevant).
 */
export function applyRuntimeEnv(baseDir: string): void {
  loadEnv({ path: resolve(baseDir, ".env") });
  process.env.HARNESS_DB_URL = absoluteFileUrl(
    process.env.HARNESS_DB_URL ?? `file:${resolve(baseDir, "prisma", "dev.db").replace(/\\/g, "/")}`,
    baseDir,
  );
}
