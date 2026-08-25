/**
 * The curriculum tools.
 *
 * Two, and both read-only. The coding coach can write practice records because
 * a review schedule depends on them; this side keeps no progress at all, so
 * there is nothing here that could claim you read something. What the mentor
 * can do is see what is open, see the shape of the curriculum, and explain.
 *
 * Server-only (loaded by the extension).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CURRICULUM, type ItemLocation } from "./study.ts";
import { currentItem, currentTrack, trackOutline } from "./study-domain.ts";
import { text } from "./toolkit.ts";

function describeCurrent(location: ItemLocation): string {
  const { item, module, track } = location;
  const lines = [
    `${item.title} [${item.kind} · ${track.title} › ${module.title}]`,
    `Module outcome: ${module.outcome}`,
    `Track: ${track.title} — ${track.outcome}`,
  ];
  if (item.url) lines.push(`URL: ${item.url}`);
  if (item.hint) lines.push(`Why it is on the list: ${item.hint}`);
  if (item.kind === "milestone") {
    lines.push("This is a milestone: something they build, not something they read.");
  }
  return lines.join("\n");
}

export function registerStudyTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "study_current",
    label: "Current resource",
    description:
      "Read the curriculum item the coding workspace currently has open, with the module it belongs to. Call this first whenever they ask about \"this\", \"this page\", \"this chapter\", or start asking about a topic without naming a source.",
    promptSnippet: "study_current — which learning resource the workspace has open",
    promptGuidelines: [
      "The workspace opens each resource in a separate tab you cannot see into, and records it on the way. study_current is the only way to know what the user is looking at — never guess it from the conversation, and never assume it is still what was discussed earlier in the session.",
      "You are their architecture and full-stack mentor. Unlike the coding coach, you do not withhold: explain the thing properly, with a concrete example, and check the explanation landed by asking them to apply it once.",
      "Anchor every answer to the module's outcome. The point is not to finish pages; it is to reach the capability the module names. When they are asking about something the current module does not serve, say so and point at the module that does.",
      "Reach for system-level framing whenever it is honest to: what breaks at scale, where the boundary belongs, what the trade-off costs. That transfer — from a tutorial page to a design decision — is what this whole track exists for, and it is the part reading alone never produces.",
      "Their own codebase is the best available example. Where a concept shows up in Robin or Pi Web, use that instead of an invented shop-and-orders example.",
      "Nothing on this side is tracked: there is no progress, no status, no count of what they have read, and no tool that could write one. Never claim to have recorded anything, never ask them to mark something done, and do not narrate how far along they are — you cannot know, and guessing at it is worse than leaving it alone.",
      "Keep it short — this is a side panel next to what they are reading. Reply in the language they write in.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const location = currentItem();
      if (!location) {
        const track = currentTrack();
        return text(
          `Nothing is open in the curriculum right now. The syllabus is showing "${track.title}". `
            + "Ask what they want to work on, or call study_outline to see what is in the track.",
        );
      }
      return text(describeCurrent(location));
    },
  });

  pi.registerTool({
    name: "study_outline",
    label: "Track outline",
    description:
      "Read a curriculum track's modules, what each one is for, and the resources in it. Use this when they ask where something fits, what to read next, or how the whole thing hangs together.",
    promptSnippet: "study_outline — a track's modules, outcomes, and resources",
    promptGuidelines: [
      "Use this before answering any question of the form \"what should I learn next\" or \"why am I doing this\". The answer is in the module outcomes and the order they are written in, not in your own idea of a syllabus.",
      "Do not invent modules, resources, or an order. If something the user needs is genuinely missing from the curriculum, say it is missing rather than describing it as though it were there.",
      "The outline says what exists, never what they have done with it. Recommend from the order and from what they tell you in the conversation — there is no history here to read.",
    ],
    parameters: Type.Object({
      track: Type.Optional(Type.String({
        description: `${CURRICULUM.map((track) => track.id).join(" | ")}. Defaults to the track the syllabus is showing.`,
      })),
    }),
    async execute(_toolCallId, params) {
      const result = trackOutline(params.track?.trim() || currentTrack().id);
      if ("error" in result) return text(result.error);
      const { track, modules } = result;
      const lines = [`${track.title} — ${track.outcome}`, ""];
      for (const courseModule of modules) {
        lines.push(courseModule.title);
        lines.push(`  Outcome: ${courseModule.outcome}`);
        for (const item of courseModule.items) {
          lines.push(`  - ${item.title} (${item.kind}, id: ${item.id})`);
        }
      }
      return text(lines.join("\n"));
    },
  });
}
