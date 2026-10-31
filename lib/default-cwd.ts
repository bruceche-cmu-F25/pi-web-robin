import { homedir } from "os";
import path from "path";

/** One stable workspace for general conversations, outside any chosen project. */
export function defaultCwdPath(home = homedir()): string {
  return path.join(home, "pi-cwd", "general");
}
