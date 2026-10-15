import type { SVGProps } from "react";

/** Small, decorative line drawings. The adjacent text supplies the accessible name. */
const paths = {
  market: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 21 21M8 11h5M10.5 8.5v5",
  validation: "M8 3h8M10 3v6l-6 10a1.3 1.3 0 0 0 1.2 2h13.6a1.3 1.3 0 0 0 1.2-2L14 9V3M7 15h10M9 18h.01M14 17h.01",
  build: "m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  billing: "M4 5h16v14H4zM4 9h16M7 15h4M16 14h1",
  distribution: "m3 10 16-6v16L3 14v-4ZM7 16l1 5h3l-1-4M19 8h2M19 16h2",
  release: "M12 15V3M7 8l5-5 5 5M4 14v7h16v-7",
  operations: "M3 12h4l3-7 4 14 3-7h4M3 4h3M18 20h3",
  economics: "M4 21V4M4 21h17M8 17v-4M13 17V9M18 17V5",
  map: "M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4",
  idea: "M9 18h6M10 21h4M8 13a6 6 0 1 1 8 0c-1.5 1-1.5 2-1.5 2.5h-5c0-.5 0-1.5-1.5-2.5Z",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a7 7 0 0 1 14 0v3M16 4a4 4 0 0 1 0 8M18 15a5 5 0 0 1 4 5",
  document: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6",
  link: "m10 8 3-3a4.2 4.2 0 0 1 6 6l-3 3M14 16l-3 3a4.2 4.2 0 0 1-6-6l3-3M8 16l8-8",
  check: "m5 12 4 4L19 6",
} as const;
export type ProductGlyphName = keyof typeof paths;

export function ProductGlyph({ name, ...props }: SVGProps<SVGSVGElement> & { name: ProductGlyphName }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props} aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
