/**
 * Excalidraw 0.18 resolves canvas, text-editor and SVG fonts through this public
 * name → ID table. Reuse its local-font slot (2) so existing notes keep working,
 * and keep the Helvetica property available to its metrics/restore code.
 * A CSS-only override would change the editor but not canvas measurements.
 */
export function configureCanvasFont(families: Record<string, number>, fontFamily: string): number {
  const id = families.Helvetica;
  const family = fontFamily.trim();
  if (!family) return id;
  Object.defineProperty(families, "Helvetica", { enumerable: false });
  families[family] = id;
  return id;
}
