export type QueryPatch = Record<string, string | null | undefined>;

export function applyQueryPatch(search: string, patch: QueryPatch): string {
  const params = new URLSearchParams(search);
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value) params.set(name, value);
    else params.delete(name);
  }
  return params.toString();
}

/** Update view state without reloading the current Next.js route. */
export function writeUrlState(patch: QueryPatch, mode: "push" | "replace" = "push"): void {
  const url = new URL(window.location.href);
  url.search = applyQueryPatch(url.search, patch);
  if (url.href === window.location.href) return;
  window.history[`${mode}State`](null, "", url);
}
