"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getInitialNavigation } from "@/lib/initial-navigation";

interface WorkspaceShortcutOptions {
  sessionId?: string | null;
  cwd?: string | null;
}

/** Cmd+D opens Daily; Cmd+R returns to Chat while preserving its target. */
export function useWorkspaceShortcuts(options: WorkspaceShortcutOptions = {}): void {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigation = getInitialNavigation(searchParams);
  const sessionId = options.sessionId === undefined ? navigation.sessionId : options.sessionId;
  const cwd = options.cwd === undefined ? navigation.requestedCwd : options.cwd;

  useEffect(() => {
    const navigate = (pathname: "/" | "/dashboard") => {
      const query = sessionId
        ? `?session=${encodeURIComponent(sessionId)}`
        : cwd
          ? `?cwd=${encodeURIComponent(cwd)}`
          : "";
      router.push(`${pathname}${query}`, { scroll: false });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key !== "d" && key !== "r") return;

      event.preventDefault();
      navigate(key === "d" ? "/dashboard" : "/");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cwd, router, sessionId]);
}
