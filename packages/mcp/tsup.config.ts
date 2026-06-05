import { defineConfig } from "tsup";

// Bundles the MCP entry (plus @harness/core source) into one self-contained
// executable so the Cursor config can be just `command: "harness-mcp"`.
// Native / engine packages stay external and resolve from node_modules at runtime.
export default defineConfig({
  entry: { "harness-mcp": "src/index.ts", "harness-http": "src/http.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  // Shebang + a real `require` so bundled CJS deps (e.g. gray-matter) that call
  // require() at runtime work inside the ESM output.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'module';\nconst require = __cr(import.meta.url);",
  },
  outExtension: () => ({ js: ".mjs" }),
  // Inline the workspace core (its src is TS) so the bundle is self-contained;
  // keep native / Prisma engine packages external to load from node_modules.
  noExternal: [/^@harness\//],
  external: [/^@prisma\//, "better-sqlite3"],
});
