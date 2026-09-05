import { NextResponse } from "next/server";
import {
  addLibraryResource,
  listLibraryResources,
  updateLibraryResource,
} from "@/extension/robin/product-domain";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, json = false): NextResponse | null {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (json && !hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ resources: listLibraryResources() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const denied = guard(req, true);
  if (denied) return denied;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim()) return fail(new Error("name is required"));
    return NextResponse.json({ resource: addLibraryResource({
      name: body.name,
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(typeof body.url === "string" ? { url: body.url } : {}),
      ...(typeof body.source === "string" ? { source: body.source } : {}),
      ...(body.category === "source" || body.category === "test" || body.category === "tool" || body.category === "stack" || body.category === "distribution"
        ? { category: body.category }
        : {}),
    }) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: Request) {
  const denied = guard(req, true);
  if (denied) return denied;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    const patch: Parameters<typeof updateLibraryResource>[1] = {};
    if (body.status !== undefined) {
      if (body.status !== "recommended" && body.status !== "saved" && body.status !== "using" && body.status !== "archived") {
        return fail(new Error("invalid status"));
      }
      patch.status = body.status;
    }
    // Writing a price stamps lastChecked, so an empty one is rejected rather
    // than stored: it would date a verification that never happened.
    if (body.price !== undefined) {
      if (typeof body.price !== "string" || !body.price.trim()) return fail(new Error("price must be a non-empty string"));
      patch.price = body.price.trim();
    }
    if (Object.keys(patch).length === 0) return fail(new Error("nothing to update"));

    const resource = updateLibraryResource(body.id, patch);
    if (!resource) return fail(new Error(`No resource with id "${body.id}"`), 404);
    return NextResponse.json({ resource });
  } catch (error) {
    return fail(error);
  }
}
