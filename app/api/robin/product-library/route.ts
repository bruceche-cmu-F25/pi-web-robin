import { NextResponse } from "next/server";
import {
  addLibraryResource,
  listLibraryResources,
  updateLibraryResource,
} from "@/extension/robin/product-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";



export const GET = apiRoute(async () => {
    return NextResponse.json({ resources: listLibraryResources() });
});

export const POST = apiRoute(async (req) => {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim()) return apiError(new Error("name is required"));
    return NextResponse.json({ resource: addLibraryResource({
      name: body.name,
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(typeof body.url === "string" ? { url: body.url } : {}),
      ...(typeof body.source === "string" ? { source: body.source } : {}),
      ...(body.category === "source" || body.category === "test" || body.category === "tool" || body.category === "stack" || body.category === "distribution"
        ? { category: body.category }
        : {}),
    }) });
});

export const PATCH = apiRoute(async (req) => {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.id !== "string") return apiError(new Error("id is required"));

    const patch: Parameters<typeof updateLibraryResource>[1] = {};
    if (body.status !== undefined) {
      if (body.status !== "recommended" && body.status !== "saved" && body.status !== "using" && body.status !== "archived") {
        return apiError(new Error("invalid status"));
      }
      patch.status = body.status;
    }
    // Writing a price stamps lastChecked, so an empty one is rejected rather
    // than stored: it would date a verification that never happened.
    if (body.price !== undefined) {
      if (typeof body.price !== "string" || !body.price.trim()) return apiError(new Error("price must be a non-empty string"));
      patch.price = body.price.trim();
    }
    if (Object.keys(patch).length === 0) return apiError(new Error("nothing to update"));

    const resource = updateLibraryResource(body.id, patch);
    if (!resource) return apiError(new Error(`No resource with id "${body.id}"`), 404);
    return NextResponse.json({ resource });
});
