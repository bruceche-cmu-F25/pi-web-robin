import { NextResponse } from "next/server";
import {
  PLAYBOOK_STEPS,
  addCapture,
  addIdea,
  fileCapture,
  listCaptures,
  listIdeas,
  type StepId,
} from "@/extension/robin/product-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";



const isStep = (value: unknown): value is StepId => PLAYBOOK_STEPS.includes(value as StepId);

export const GET = apiRoute(async () => {
    return NextResponse.json({ ideas: listIdeas(), captures: listCaptures().filter((item) => item.status === "pending") });
});

export const POST = apiRoute(async (req) => {
    const body = await req.json() as Record<string, unknown>;

    // A raw capture: text, an image, or both. Kept whole and filed later.
    if (body.capture === true) {
      const images = Array.isArray(body.images)
        ? body.images.filter((item): item is { data: string; mimeType: string } =>
          !!item && typeof item === "object"
          && typeof (item as { data?: unknown }).data === "string"
          && typeof (item as { mimeType?: unknown }).mimeType === "string")
        : [];
      return NextResponse.json({ capture: addCapture({
        ...(typeof body.text === "string" ? { text: body.text } : {}),
        images,
      }) });
    }

    // Filing a capture the user has confirmed a classification for.
    if (typeof body.captureId === "string") {
      const kind = body.kind;
      if (kind !== "idea" && kind !== "resource" && kind !== "link" && kind !== "note") return apiError(new Error("invalid kind"));
      if (typeof body.title !== "string" || !body.title.trim()) return apiError(new Error("title is required"));
      return NextResponse.json({ capture: fileCapture({
        id: body.captureId,
        kind,
        title: body.title,
        ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
        ...(typeof body.url === "string" ? { url: body.url } : {}),
        ...(typeof body.ideaId === "string" ? { ideaId: body.ideaId } : {}),
      }) });
    }

    if (typeof body.name !== "string" || !body.name.trim()) return apiError(new Error("name is required"));
    return NextResponse.json({ idea: addIdea({
      name: body.name,
      ...(typeof body.note === "string" ? { note: body.note } : {}),
      ...(isStep(body.step) ? { step: body.step } : {}),
    }) });
});
