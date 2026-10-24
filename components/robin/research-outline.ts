/** A heading hierarchy, not new notebook storage. Indexes point into the rendered document. */
export interface ResearchHeading {
  index: number;
  level: number;
  title: string;
  children: ResearchHeading[];
}

export function researchHeadingTree(headings: Array<{ level: number; title: string }>): ResearchHeading[] {
  const root: ResearchHeading = { index: -1, level: 0, title: "", children: [] };
  const stack = [root];
  headings.forEach((heading, index) => {
    const node: ResearchHeading = { ...heading, index, children: [] };
    while (stack.length > 1 && stack.at(-1)!.level >= node.level) stack.pop();
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  return root.children;
}
