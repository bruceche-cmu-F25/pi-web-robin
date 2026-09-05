import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { addIdeaLink, getIdea, listIdeas } from "./product-domain.ts";
import { text } from "./toolkit.ts";

export function registerProductTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "product_list",
    label: "List ideas",
    description: "List the user's product ideas so the incubator agent can compare or discuss them.",
    promptSnippet: "product_list — read the user's ideas",
    parameters: Type.Object({}),
    async execute() {
      const ideas = listIdeas();
      return text(ideas.length === 0
        ? "No ideas yet."
        : ideas.map((idea) => `${idea.id} · ${idea.step}${idea.parked ? " (parked)" : ""} · ${idea.name}`).join("\n"));
    },
  });

  pi.registerTool({
    name: "product_get",
    label: "Read idea",
    description: "Read one idea: its note and the links gathered against it.",
    promptSnippet: "product_get — read one idea",
    parameters: Type.Object({ id: Type.String({ description: "Idea id" }) }),
    async execute(_toolCallId, { id }) {
      const idea = getIdea(id);
      return text(idea ? JSON.stringify(idea, null, 2) : `No idea with id "${id}".`);
    },
  });

  pi.registerTool({
    name: "product_add_link",
    label: "Save a link to an idea",
    description: "Save a sourced link to one idea. This is the only thing the agent may write without a separate confirmation in the UI.",
    promptSnippet: "product_add_link — save a sourced link from requested research",
    promptGuidelines: [
      "Use product_add_link only after the user explicitly asks you to research or save something.",
      "A real http or https URL you actually visited is required. Never save an inference, a recommendation, or a remembered URL.",
      "The note says what is at the other end and why it matters — not what you conclude from it.",
      "Do not rewrite the idea's name, note, or state; those are the user's, and the Product page is where they change.",
    ],
    parameters: Type.Object({
      ideaId: Type.String({ description: "Idea id from product_list or product_get" }),
      title: Type.String({ description: "Short label for the link" }),
      url: Type.String({ description: "Original http or https URL" }),
      note: Type.Optional(Type.String({ description: "What is there and why it matters" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const link = addIdeaLink(params.ideaId, { ...params, addedBy: "agent" });
        return text(`Saved link ${link.id}: ${link.title}`);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
