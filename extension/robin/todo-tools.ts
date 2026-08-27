/**
 * The todo tools: add, list, update, delete, complete.
 *
 * Server-only (loaded by the extension). Each registration reads and writes the
 * todo store through store.ts; the store itself stays testable without pi.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { addTodo, completeTodo, deleteTodo, updateTodo } from "./todo-domain.ts";
import { formatTodo, localDate, readTodos } from "./store.ts";
import { text } from "./toolkit.ts";

export function registerTodoTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "todo_add",
    label: "Add todo",
    description:
      "Add a task to the user's personal todo list. Use this whenever the user mentions something they need to do later.",
    promptSnippet: "todo_add — record a task on the user's todo list",
    promptGuidelines: [
      "When the user mentions something they intend to do later, record it with todo_add instead of only acknowledging it.",
      "Give a todo a url whenever the task lives somewhere the user will need to open — an assignment page, a job posting, a form, a doc. The dashboard turns the title into that link.",
      "A todo whose link shows as (auto) in todo_list is only guessing from its title (a course number opens Canvas, email talk opens the inbox). Replace it with todo_update when you know the exact page.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short description of the task" }),
      due: Type.Optional(
        Type.String({
          description:
            "Due date as YYYY-MM-DD in the user's local timezone, if they gave one. Resolve relative dates against the local date reported by todo_list, not UTC.",
        }),
      ),
      url: Type.Optional(
        Type.String({
          description:
            "Link to where the task is actually done, if there is one. http, https or mailto.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      try {
        const { todo, open } = addTodo(params);
        return text(`Added ${formatTodo(todo)}\n${open} open todo(s).`);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }
    },
  });

  pi.registerTool({
    name: "todo_list",
    label: "List todos",
    description: "List the user's todos. Returns ids, which other todo tools accept.",
    promptSnippet: "todo_list — read the user's todo list",
    parameters: Type.Object({
      includeDone: Type.Optional(Type.Boolean({ description: "Include completed todos (default false)" })),
    }),
    async execute(_toolCallId, params) {
      const todos = readTodos();
      const today = localDate();
      const visible = params.includeDone ? todos : todos.filter((t) => !t.done);
      // The local date is stated explicitly so relative dates ("tomorrow") are
      // resolved against the user's day, not the model's assumed UTC one.
      const header = `Today is ${today} (user's local date).`;
      if (visible.length === 0) {
        return text(`${header}\n${params.includeDone ? "No todos." : "No open todos."}`);
      }
      return text(`${header}\n${visible.map((t) => formatTodo(t, today)).join("\n")}`);
    },
  });

  pi.registerTool({
    name: "todo_update",
    label: "Update todo",
    description:
      "Edit a todo's title, due date or link. Identify it by id (from todo_list) or by a distinctive part of its current title.",
    promptSnippet: "todo_update — edit a todo on the user's todo list",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Todo id from todo_list" })),
      title: Type.Optional(Type.String({ description: "Part of the current todo title, if the id is unknown" })),
      newTitle: Type.Optional(Type.String({ description: "Replacement title" })),
      due: Type.Optional(
        Type.String({ description: "Replacement due date as YYYY-MM-DD, or an empty string to remove it" }),
      ),
      url: Type.Optional(
        Type.String({
          description:
            "Link to where the task is done (http, https or mailto), or an empty string to remove it",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      if (params.newTitle === undefined && params.due === undefined && params.url === undefined) {
        return text("Provide a newTitle, due date or url to update.");
      }

      try {
        const result = updateTodo(params, {
          ...(params.newTitle !== undefined ? { title: params.newTitle } : {}),
          ...(params.due !== undefined ? { due: params.due } : {}),
          ...(params.url !== undefined ? { url: params.url } : {}),
        });
        if ("error" in result) return text(result.error);
        return text(`Updated ${formatTodo(result)}`);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }
    },
  });

  pi.registerTool({
    name: "todo_delete",
    label: "Delete todo",
    description:
      "Permanently delete a todo. Identify it by id (from todo_list) or by a distinctive part of its title.",
    promptSnippet: "todo_delete — permanently remove a todo from the user's todo list",
    promptGuidelines: [
      "Only delete a todo when the user explicitly asks to delete or remove it. Completing a todo is not deletion.",
    ],
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Todo id from todo_list" })),
      title: Type.Optional(Type.String({ description: "Part of the todo title, if the id is unknown" })),
    }),
    async execute(_toolCallId, params) {
      const result = deleteTodo(params);
      if ("error" in result) return text(result.error);
      return text(`Deleted "${result.title}".`);
    },
  });

  pi.registerTool({
    name: "todo_complete",
    label: "Complete todo",
    description:
      "Mark a todo as done. Identify it by id (from todo_list) or by a distinctive part of its title.",
    promptSnippet: "todo_complete — mark a todo as done",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Todo id from todo_list" })),
      title: Type.Optional(Type.String({ description: "Part of the todo title, if the id is unknown" })),
    }),
    async execute(_toolCallId, params) {
      const result = completeTodo(params);
      if ("error" in result) return text(result.error);
      const today = localDate();
      if (result.alreadyDone) return text(`Already done: ${formatTodo(result.todo, today)}`);
      return text(`Completed ${formatTodo(result.todo, today)}\n${result.open} open todo(s) left.`);
    },
  });
}
