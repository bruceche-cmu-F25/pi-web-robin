/* Keep the fixed Learning Hub's screenshots in step with catalog edits during dev. */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const watcher = spawn(process.execPath, [join(root, "scripts/refresh-shelf-previews.mjs"), "--watch"], {
  cwd: root, stdio: "inherit",
});
const host = process.argv.includes("--lan") ? "0.0.0.0" : "127.0.0.1";
const dev = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", host, "-p", "30141"], {
  cwd: root, stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { watcher.kill(signal); dev.kill(signal); });
}
dev.on("exit", (code) => {
  watcher.kill();
  process.exitCode = code ?? 1;
});
dev.on("error", (error) => {
  console.error("Could not start Next dev:", error);
  watcher.kill();
  process.exitCode = 1;
});
