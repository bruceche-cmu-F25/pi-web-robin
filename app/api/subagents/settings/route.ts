import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import {
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
} from "@/lib/subagent-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = readSubagentSettings();
    return NextResponse.json({ enabled: settings.builtInEnabled });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export const PUT = apiRoute(async (req) => {
  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const settings = writeBuiltInSubagentsEnabled(body.enabled);
    return NextResponse.json({ enabled: settings.builtInEnabled });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
