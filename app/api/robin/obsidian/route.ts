import { NextResponse } from "next/server";
import { archiveNoteToObsidian, listObsidianArchives, listObsidianVaults, ObsidianError } from "@/extension/robin/obsidian-domain";
import { clearNoteAttachments } from "@/extension/robin/note-attachments";
import { clearNotesAgentSession } from "@/extension/robin/notes-agent-state";
import { cancelNoteFinalize } from "@/lib/note-finalize-jobs";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => NextResponse.json({ vaults: listObsidianVaults(), archives: listObsidianArchives() }));

export const POST = apiRoute(async (req) => {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const archive = archiveNoteToObsidian(body);
    // Publication is already committed. Cleanup failure must not report the saved note as lost.
    for (const cleanup of [cancelNoteFinalize, clearNotesAgentSession, clearNoteAttachments]) {
      try { cleanup(archive.draftId); }
      catch (error) { console.error("[robin] Obsidian archive cleanup failed:", error); }
    }
    return NextResponse.json({ archive });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: error instanceof ObsidianError ? error.status : 500,
    });
  }
});
