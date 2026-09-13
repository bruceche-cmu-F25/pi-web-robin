"use client";

import { useSearchParams } from "next/navigation";
import { PracticeWorkspace } from "./PracticeWorkspace";

/**
 * The coding workspace: problem practice.
 *
 * The URL picks the problem and list, so the dashboard's "start today's
 * problem" lands on it. Keyed by the query so following a second such link
 * re-reads it rather than keeping the first selection.
 */
export function CodingBoard() {
  const searchParams = useSearchParams();

  return (
    <PracticeWorkspace key={searchParams.toString()}
      initialProblem={searchParams.get("problem")} initialList={searchParams.get("list")} />
  );
}
