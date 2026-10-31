import { NextResponse } from "next/server";
import { homedir } from "os";
import { defaultCwdPath } from "@/lib/default-cwd";
import { projectIdentityKey } from "@/lib/project-identity";

export async function GET() {
  const root = defaultCwdPath();
  return NextResponse.json({ home: homedir(), generalProject: { root, key: projectIdentityKey(root) } });
}
