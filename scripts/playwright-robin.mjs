#!/usr/bin/env node
/** Local CLI bridge: pass Robin's stored browser token only to Playwright, never to a web response. */
import { spawnSync } from "node:child_process";
import { playwrightExtensionToken } from "../extension/robin/settings.ts";

const token = playwrightExtensionToken();
if (!token) {
  console.error("Save the Playwright Extension token in Robin Settings first.");
  process.exit(1);
}
const result = spawnSync("playwright-cli", process.argv.slice(2), {
  env: { ...process.env, PLAYWRIGHT_MCP_EXTENSION_TOKEN: token },
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
