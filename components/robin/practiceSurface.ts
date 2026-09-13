import type { CatalogProblem } from "@/extension/robin/practice";

/** Difficulty ink shared by the toolbar and catalog, using theme-aware tokens. */
export const DIFFICULTY_COLOR: Record<CatalogProblem["difficulty"], string> = {
  Easy: "var(--success)",
  Medium: "var(--warning)",
  Hard: "var(--danger)",
};
