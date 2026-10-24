import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { browseVault, discoverVaults, readVaultNote } from "@/extension/robin/obsidian-browser-domain";
import { ObsidianError } from "@/extension/robin/obsidian-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const vaultId = params.get("vaultId");
  try {
    const result = !vaultId ? { vaults: discoverVaults() }
      : params.has("path") ? { note: await readVaultNote(vaultId, params.get("path")!) }
        : await browseVault(vaultId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read vault" }, {
      status: error instanceof ObsidianError ? error.status : 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
});
