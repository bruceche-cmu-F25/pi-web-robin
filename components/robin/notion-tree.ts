export interface NotionTreePage {
  id: string;
  title: string;
  url?: string;
  lastEditedAt?: string;
  parentId?: string;
}

export interface NotionTreeNode extends NotionTreePage {
  children: NotionTreeNode[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Build the visible hierarchy; missing parents and cycles stay safely at the root. */
export function buildNotionTree(pages: NotionTreePage[]): NotionTreeNode[] {
  const nodes = new Map<string, NotionTreeNode>();
  for (const page of pages) nodes.set(page.id, { ...page, children: [] });

  const safeParent = (node: NotionTreeNode): NotionTreeNode | null => {
    if (!node.parentId) return null;
    let parent = nodes.get(node.parentId);
    const seen = new Set([node.id]);
    while (parent) {
      if (seen.has(parent.id)) return null;
      seen.add(parent.id);
      if (!parent.parentId) break;
      parent = nodes.get(parent.parentId);
    }
    return nodes.get(node.parentId) ?? null;
  };

  const roots: NotionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = safeParent(node);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (items: NotionTreeNode[]) => {
    items.sort((a, b) => collator.compare(a.title, b.title));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

/** Keep matching pages and their ancestor path so search never flattens the hierarchy. */
export function filterNotionTree(nodes: NotionTreeNode[], query: string): NotionTreeNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    const children = filterNotionTree(node.children, needle);
    return node.title.toLocaleLowerCase().includes(needle) || children.length
      ? [{ ...node, children }]
      : [];
  });
}
