/** Client-safe roadmap projection. Source text stays in Obsidian; these are not course ticks. */
export const ROADMAP_STATUSES = ["unassessed", "learning", "gap", "confident"] as const;
export type RoadmapStatus = typeof ROADMAP_STATUSES[number];
export interface RoadmapSection { id: string; title: string; content: string; practice: string; fingerprint: string }
export interface RoadmapRecord {
  vaultId: string;
  path: string;
  section: string;
  title: string;
  status: RoadmapStatus;
  evidence: string;
  fingerprint: string;
  revision: number;
  updatedAt: string;
}

/** Recognise learning collections, not every note mentioning a roadmap in passing. */
export function isRoadmapPath(path: string): boolean {
  return /(?:roadmaps?|路线图|路線圖|学习路线|學習路線|知识地图|知識地圖)/i.test(path);
}

export function roadmapKey(vaultId: string, path: string, section: string): string {
  return JSON.stringify([vaultId, path, section]);
}

interface Heading { depth: number; title: string; start: number }
/** Deliberately supports ATX headings. Fenced examples, front matter and comments aren't lessons. */
function headings(markdown: string): Heading[] {
  const result: Heading[] = [];
  let offset = 0, fence = "", inComment = false;
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.slice(marker[0].length).trim() === "") fence = "";
    } else if (inComment || line.includes("<!--")) {
      inComment = line.lastIndexOf("<!--") > line.lastIndexOf("-->") || (inComment && !line.includes("-->"));
    } else if (marker) fence = marker[1];
    else {
      const match = line.match(/^ {0,3}(#{1,6})[ \t]+([^\r\n]+)/);
      if (match) result.push({ depth: match[1].length, title: match[2].replace(/[ \t]+#+[ \t]*$/, "").trim(), start: offset });
    }
    offset += line.length;
  }
  return result;
}

const PRACTICE = /练习|練習|实践|實踐|验收|驗收|自测|自測|检查|檢查|实验|實驗|观察项|觀察項|形成的理解|學到|学到|practice|exercise|checkpoint|self.?check|experiment/i;

export function splitRoadmap(markdown: string): Omit<RoadmapSection, "fingerprint">[] {
  const content = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const outline = headings(content);
  const sections = outline.filter((heading) => heading.depth === 2);
  const starts = [{ id: "intro", title: outline.find((heading) => heading.depth === 1)?.title ?? "", start: 0 },
    ...sections.map((heading, index) => ({ ...heading, id: JSON.stringify([heading.title, sections.slice(0, index).filter((other) => other.title === heading.title).length]) }))];
  return starts.map((section, index) => {
    const end = starts[index + 1]?.start ?? content.length;
    const body = content.slice(section.start, end).trim();
    const local = headings(body);
    let through = -1;
    const practice = local.flatMap((heading, i) => {
      if (heading.start < through || !PRACTICE.test(heading.title)) return [];
      through = local.slice(i + 1).find((next) => next.depth <= heading.depth)?.start ?? body.length;
      return [body.slice(heading.start, through).trim()];
    }).join("\n\n");
    return { id: section.id, title: section.title, content: body, practice };
  }).filter((section) => section.content);
}
