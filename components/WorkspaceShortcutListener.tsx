"use client";

import { useWorkspaceShortcuts } from "@/hooks/useWorkspaceShortcuts";

export function WorkspaceShortcutListener() {
  useWorkspaceShortcuts();
  return null;
}
