const paths = {
  plus: "M12 5v14M5 12h14",
  expand: "m8 10 4 4 4-4",
  collapse: "m8 14 4-4 4 4",
  send: "M12 19V5m-6 6 6-6 6 6",
  stop: "M6 6h12v12H6z",
  download: "M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5",
  document: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6",
  link: "m10 13 4-4m-5 0-4 4a4 4 0 0 0 6 6l3-3m-4-8 3-3a4 4 0 0 1 6 6l-3 3",
  arrange: "M9 9h6v6H9zM12 9V4M3 4h18M12 15v5M3 20h18M3 2v4m18-4v4M3 18v4m18-4v4",
  select: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z",
  undo: "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12",
  redo: "m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12",
  fit: "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5",
  chat: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM8 9h8M8 13h5",
  close: "m6 6 12 12M6 18 18 6",
  edit: "m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z",
  branch: "M4 12h7m0 0V5h8m-8 7v7h8M19 2v6m-3-3h6M16 19h6",
  sibling: "M5 4v14h7M5 7h14m-3 11h6m-3-3v6",
  check: "m5 12 4 4L19 6",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
  map: "M9 9h6v6H9zM12 9V4h7M9 12H4v7m11-7h5m-8 3v5",
} as const;
export function MindmapIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
