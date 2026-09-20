import { NextResponse } from "next/server";
import {
  addLink,
  deleteLink,
  listLinks,
  reorderLinkGroups,
  updateLink,
} from "@/extension/robin/link-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  return NextResponse.json({ links: listLinks() });
});

export const POST = apiRoute(async (req) => {
  const body = await req.json() as { title?: unknown; url?: unknown; group?: unknown };
  if (typeof body.url !== "string" || !body.url.trim()) return apiError(new Error("url is required"));

  const { link } = await addLink({
    url: body.url,
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.group === "string" ? { group: body.group } : {}),
  });
  return NextResponse.json({ link });
});

/** Edit a link's address, name, or group. */
export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as {
    action?: unknown;
    groups?: unknown;
    id?: unknown;
    title?: unknown;
    url?: unknown;
    group?: unknown;
  };
  if (body.action === "reorderGroups") {
    if (!Array.isArray(body.groups) || !body.groups.every((group) => typeof group === "string")) {
      return apiError(new Error("groups must be an array of names"));
    }
    reorderLinkGroups(body.groups);
    return NextResponse.json({ success: true });
  }

  if (typeof body.id !== "string") return apiError(new Error("id is required"));
  const link = await updateLink(body.id, {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.url === "string" ? { url: body.url } : {}),
    ...(typeof body.group === "string" ? { group: body.group } : {}),
  });
  if (!link) return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });
  return NextResponse.json({ link });
});

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown };
  if (typeof body.id !== "string") return apiError(new Error("id is required"));

  if (!deleteLink(body.id)) {
    return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
