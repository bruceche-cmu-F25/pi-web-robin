import { NextResponse } from "next/server";
import { validateAgentImages } from "@/lib/image-attachments";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PREAMBLE = [
  "Classify one raw capture for a personal product incubator.",
  "Return JSON only, with keys kind, title, summary, confidence, reason, url.",
  "kind must be idea, resource, link, or note. confidence must be low, medium, or high.",
  "An idea is a possible product. A resource is a reusable tool, source, test method, stack, or distribution playbook. A link belongs to an idea the user already has and needs a target idea later. A note is anything ambiguous.",
  "Be conservative: use note and low confidence when uncertain. Never invent a URL, price, revenue number, or claim not present in the capture.",
  "If one source contains many possible resources, classify the original as resource and mention possible children in the summary; do not silently split it.",
].join("\n");

interface Suggestion {
  kind: "idea" | "resource" | "link" | "note";
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  reason: string;
  url?: string;
}

function parseSuggestion(reply: string): Suggestion | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
    if (value.kind !== "idea" && value.kind !== "resource" && value.kind !== "link" && value.kind !== "note") return null;
    if (value.confidence !== "low" && value.confidence !== "medium" && value.confidence !== "high") return null;
    if (typeof value.title !== "string" || typeof value.summary !== "string" || typeof value.reason !== "string") return null;
    return {
      kind: value.kind,
      title: value.title.slice(0, 160),
      summary: value.summary.slice(0, 1200),
      confidence: value.confidence,
      reason: value.reason.slice(0, 500),
      ...(typeof value.url === "string" && value.url.trim() ? { url: value.url } : {}),
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { text?: unknown; images?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (Array.isArray(body.images) && body.images.length > 4) return NextResponse.json({ error: "A capture can include at most 4 images" }, { status: 400 });
    const imageError = body.images === undefined ? null : validateAgentImages(body.images);
    if (imageError) return NextResponse.json({ error: imageError }, { status: 400 });
    const images = (body.images ?? []) as Array<{ type: "image"; data: string; mimeType: string }>;
    if (!text && images.length === 0) return NextResponse.json({ error: "text or an image is required" }, { status: 400 });

    const result = await runScopedAssistantTurn({
      remembered: null,
      remember: () => {},
      toolNames: [],
      preamble: PREAMBLE,
      message: text || "Classify the attached image capture.",
      images,
    });
    const suggestion = parseSuggestion(result.reply) ?? {
      kind: "note",
      title: text.slice(0, 80) || "Image capture",
      summary: text,
      confidence: "low",
      reason: "The classifier response was ambiguous; review this capture manually.",
    };
    return NextResponse.json({ suggestion });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
