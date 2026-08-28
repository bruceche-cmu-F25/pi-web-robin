import { NextResponse } from "next/server";
import {
  addLink,
  deleteLink,
  listLinks,
  reorderLinkGroups,
  updateLink,
} from "@/extension/robin/link-domain";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ links: listLinks() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { title?: unknown; url?: unknown; group?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) return fail(new Error("url is required"));

    const { link } = await addLink({
      url: body.url,
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.group === "string" ? { group: body.group } : {}),
    });
    return NextResponse.json({ link });
  } catch (error) {
    return fail(error);
  }
}

/** Edit a link's address, name, or group. */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
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
        return fail(new Error("groups must be an array of names"));
      }
      reorderLinkGroups(body.groups);
      return NextResponse.json({ success: true });
    }

    if (typeof body.id !== "string") return fail(new Error("id is required"));
    const link = await updateLink(body.id, {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.url === "string" ? { url: body.url } : {}),
      ...(typeof body.group === "string" ? { group: body.group } : {}),
    });
    if (!link) return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });
    return NextResponse.json({ link });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    if (!deleteLink(body.id)) {
      return NextResponse.json({ error: `No link with id "${body.id}"` }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
