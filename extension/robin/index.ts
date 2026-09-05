/**
 * Robin dashboard extension — entry point.
 *
 * Loaded by pi from ~/.pi/agent/extensions/robin (symlink to this directory).
 * No build step: jiti imports the TypeScript directly and aliases `typebox` and
 * the pi SDK packages to pi's own copies, so nothing needs installing.
 *
 * This file is only the composition root: each domain's tools live in its own
 * `*-tools.ts` module next to the store/model it talks to, so finding a tool
 * means opening one small file rather than searching a single register-everything
 * module.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCalendarTools } from "./calendar-tools.ts";
import { registerGmailTools } from "./gmail-tools.ts";
import { registerJobTools } from "./job-tools.ts";
import { registerLinkTools } from "./link-tools.ts";
import { registerPracticeTools } from "./practice-tools.ts";
import { registerProductTools } from "./product-tools.ts";
import { registerStudyTools } from "./study-tools.ts";
import { dataPath } from "./paths.ts";
import { registerProviderTools } from "./provider-tools.ts";
import { listTodos } from "./todo-domain.ts";
import { registerTodoTools } from "./todo-tools.ts";

const robin = (pi: ExtensionAPI) => {
  registerTodoTools(pi);
  registerLinkTools(pi);
  registerCalendarTools(pi);
  registerGmailTools(pi);
  registerProviderTools(pi);
  registerJobTools(pi);
  registerPracticeTools(pi);
  registerProductTools(pi);
  registerStudyTools(pi);

  // Confirms the extension actually loaded, and where its data went.
  pi.registerCommand("robin-status", {
    description: "Show Robin store location and todo counts",
    handler: async (_args, ctx) => {
      const { todos } = listTodos({ includeDone: true });
      const open = todos.filter((todo) => !todo.done).length;
      ctx.ui.notify(`Robin store: ${dataPath("todos.json")} — ${todos.length} todo(s), ${open} open.`);
    },
  });
};

export default robin;
