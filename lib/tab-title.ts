// The tab title has two writers: a page holds its own title (the chat shell's
// "<project> - Pi Web"), and the focus timer puts its countdown in front of
// whatever that title is, because the tab strip is what you can see while
// working in another tab. Both re-apply themselves whenever <head> changes,
// since route changes and Next's metadata replace the title. They must agree
// on one target string: if either writes a title the other rejects, their
// observers trigger each other forever and hang the browser.

let titlePrefix = "";
let prefixObserver: MutationObserver | null = null;

/** `base` with whatever prefix is currently applied kept in front of it. */
export function withTitlePrefix(base: string): string {
  return titlePrefix + base;
}

/** Put `prefix` in front of the current title and keep it there; "" removes it. */
export function applyTitlePrefix(prefix: string): void {
  const base = titlePrefix && document.title.startsWith(titlePrefix)
    ? document.title.slice(titlePrefix.length) : document.title;
  titlePrefix = prefix;
  if (document.title !== prefix + base) document.title = prefix + base;
  if (prefix && !prefixObserver) {
    prefixObserver = new MutationObserver(() => applyTitlePrefix(titlePrefix));
    prefixObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  } else if (!prefix) {
    prefixObserver?.disconnect();
    prefixObserver = null;
  }
}

/** Hold the page title at `base`, prefix included. Returns the release. */
export function holdTitle(base: string): () => void {
  const sync = () => {
    const wanted = withTitlePrefix(base);
    if (document.title !== wanted) document.title = wanted;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}
