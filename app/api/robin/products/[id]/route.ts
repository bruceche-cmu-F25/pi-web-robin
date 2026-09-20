import { NextResponse } from "next/server";
import {
  PLAYBOOK_STEPS,
  addIdeaLink,
  deleteIdea,
  getIdea,
  updateIdea,
  type IdeaPatch,
  type StepId,
} from "@/extension/robin/product-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const isStep = (value: unknown): value is StepId => PLAYBOOK_STEPS.includes(value as StepId);

export const GET = apiRoute(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const idea = getIdea(id);
  return idea ? NextResponse.json({ idea }) : apiError(new Error(`No idea with id "${id}"`), 404);
});

export const PATCH = apiRoute(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  try {
    const body = await req.json() as Record<string, unknown>;

    // Adding a link is its own operation rather than a whole-array write, so
    // two saves racing cannot drop one another's link.
    if (body.link && typeof body.link === "object") {
      const link = body.link as Record<string, unknown>;
      if (typeof link.url !== "string" || !link.url.trim()) return apiError(new Error("link.url is required"));
      return NextResponse.json({ link: addIdeaLink(id, {
        title: typeof link.title === "string" ? link.title : "",
        url: link.url,
        ...(typeof link.note === "string" ? { note: link.note } : {}),
      }) });
    }

    const patch: IdeaPatch = {};
    if (typeof body.name === "string") {
      if (!body.name.trim()) return apiError(new Error("name cannot be empty"));
      patch.name = body.name.trim();
    }
    if (typeof body.note === "string") patch.note = body.note;
    if (body.step !== undefined) {
      if (!isStep(body.step)) return apiError(new Error("invalid step"));
      patch.step = body.step;
    }
    if (body.parked !== undefined) {
      if (typeof body.parked !== "boolean") return apiError(new Error("parked must be a boolean"));
      patch.parked = body.parked;
    }
    if (Array.isArray(body.links)) patch.links = body.links as IdeaPatch["links"];
    if (body.bet !== undefined) {
      if (body.bet === null) patch.bet = undefined;
      else {
        const bet = body.bet as Record<string, unknown>;
        if (typeof bet.claim !== "string" || !bet.claim.trim()) return apiError(new Error("bet.claim is required"));
        if (bet.by !== undefined && bet.by !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(bet.by))) return apiError(new Error("bet.by must be YYYY-MM-DD"));
        if (bet.settled !== undefined && bet.settled !== "held" && bet.settled !== "broke") return apiError(new Error("invalid bet.settled"));
        patch.bet = {
          claim: bet.claim.trim(),
          ...(bet.by ? { by: String(bet.by) } : {}),
          ...(bet.settled ? { settled: bet.settled as "held" | "broke", settledAt: new Date().toISOString() } : {}),
        };
      }
    }
    if (Object.keys(patch).length === 0) return apiError(new Error("nothing to update"));

    const idea = updateIdea(id, patch);
    return idea ? NextResponse.json({ idea }) : apiError(new Error(`No idea with id "${id}"`), 404);
  } catch (error) {
    return apiError(error);
  }
});

export const DELETE = apiRoute(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const idea = deleteIdea(id);
  return idea ? NextResponse.json({ idea }) : apiError(new Error(`No idea with id "${id}"`), 404);
});
