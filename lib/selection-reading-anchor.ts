/** Keep the selected word at its reading height while the side panel reflows
 * the main column. Stop as soon as the reader scrolls/selects/navigates again. */
export function preserveSelectionReadingPosition(container: HTMLElement, selection: Range): () => void {
  const range = selection.cloneRange();
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    range.setEnd(range.startContainer, Math.min(range.startOffset + 1, range.startContainer.textContent?.length ?? 0));
  }
  const initial = range.getClientRects()[0];
  if (!initial) return () => {};
  const offset = initial.top - container.getBoundingClientRect().top;
  let width = container.clientWidth;
  const observer = new ResizeObserver(() => {
    if (!container.contains(range.startContainer)) { dispose(); return; }
    if (width === container.clientWidth) return;
    width = container.clientWidth;
    const rect = range.getClientRects()[0];
    if (rect) container.scrollTop += rect.top - container.getBoundingClientRect().top - offset;
  });
  const onKey = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) dispose();
  };
  function dispose() {
    observer.disconnect();
    container.removeEventListener("wheel", dispose);
    container.removeEventListener("touchstart", dispose);
    container.removeEventListener("pointerdown", dispose);
    container.removeEventListener("keydown", onKey);
  }
  observer.observe(container);
  container.addEventListener("wheel", dispose, { passive: true });
  container.addEventListener("touchstart", dispose, { passive: true });
  container.addEventListener("pointerdown", dispose);
  container.addEventListener("keydown", onKey);
  return dispose;
}
