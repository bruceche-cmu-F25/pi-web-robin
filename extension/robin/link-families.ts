/**
 * Families: the layer above a link's group.
 *
 * The groups people write are narrow — "求职平台", "Job hunt", "岗位清单" are
 * three names for one errand — and left in save order they end up scattered
 * down the panel. A family collects those into one coloured section with the
 * groups nested inside it, so related shelves sit together and read as one
 * thing.
 *
 * Families are derived from the group name, never stored: renaming a group
 * re-files it, and nothing has to be migrated. A family that ends up with a
 * single group is not a family at all — it renders as a plain group, which is
 * what keeps a colour meaning "these belong together".
 *
 * Pure logic only — no node builtins. This is imported by client components.
 */
import type { EventColorKey } from "./eventColors.ts";
import { groupLinks, type Link } from "./links.ts";

export type LinkFamilyId = "jobs" | "learning" | "ideas" | "daily" | "projects" | "money";

interface FamilyRule {
  id: LinkFamilyId;
  color: EventColorKey;
  /** Matched as a substring for CJK, as a whole word for latin. */
  keywords: string[];
}

/**
 * First match wins, so the order is the classifier. "灵感与研究" is research
 * before it is study, which is why ideas is asked before learning.
 */
const FAMILIES: FamilyRule[] = [
  { id: "jobs", color: "slate", keywords: ["求职", "岗位", "招聘", "内推", "面试", "job", "jobs", "career", "careers", "intern", "internship", "hiring", "recruiting"] },
  { id: "ideas", color: "honey", keywords: ["灵感", "研究", "点子", "idea", "ideas", "research", "meetup", "meetups", "community"] },
  { id: "learning", color: "sage", keywords: ["学习", "刷题", "课程", "教程", "阅读", "读书", "论文", "机器学习", "learning", "learn", "study", "course", "courses", "tutorial", "tutorials", "reading", "read", "ai", "ml", "cs"] },
  { id: "money", color: "clay", keywords: ["费用", "账单", "支出", "订阅", "报销", "billing", "cost", "costs", "spend", "spending", "subscription", "subscriptions", "finance"] },
  { id: "projects", color: "plum", keywords: ["项目", "部署", "运维", "project", "projects", "deploy", "deploys", "infra"] },
  { id: "daily", color: "teal", keywords: ["日常", "入口", "工具", "daily", "tools", "utilities"] },
];

const LATIN_WORD = /^[a-z0-9]+$/;

function matches(name: string, keyword: string): boolean {
  const haystack = name.toLocaleLowerCase();
  if (!LATIN_WORD.test(keyword)) return haystack.includes(keyword);
  // A latin keyword has to be a word: "ai" must not fire on "Gmail".
  return new RegExp(`(?<![a-z0-9])${keyword}(?![a-z0-9])`, "i").test(haystack);
}

/** The family a group name belongs to, or undefined when it fits none. */
export function familyOf(group: string): LinkFamilyId | undefined {
  return FAMILIES.find(({ keywords }) => keywords.some((keyword) => matches(group, keyword)))?.id;
}

export interface LinkGroup {
  group: string;
  links: Link[];
}

export interface LinkSection {
  /** Absent for a group that belongs to no family, or to one of its own. */
  family?: LinkFamilyId;
  color?: EventColorKey;
  /** One entry means this renders as a plain group, without a family header. */
  groups: LinkGroup[];
  links: number;
}

/**
 * Group the links, then cluster the groups by family.
 *
 * Order is taken from the links themselves — a family sits where its first
 * group sat, and groups keep their order inside it — so the panel's own
 * reordering stays the thing that decides what comes first.
 */
export function linkSections(links: Link[]): LinkSection[] {
  const groups = groupLinks(links);
  const sections: LinkSection[] = [];
  const byFamily = new Map<LinkFamilyId, LinkSection>();

  for (const group of groups) {
    const family = familyOf(group.group);
    const existing = family ? byFamily.get(family) : undefined;
    if (existing) {
      existing.groups.push(group);
      existing.links += group.links.length;
      continue;
    }
    const section: LinkSection = {
      ...(family ? { family, color: FAMILIES.find(({ id }) => id === family)?.color } : {}),
      groups: [group],
      links: group.links.length,
    };
    if (family) byFamily.set(family, section);
    sections.push(section);
  }

  // A family of one is indistinguishable from a plain group, and colouring it
  // would say "related" about something that is on its own.
  return sections.map((section) =>
    section.groups.length > 1 ? section : { groups: section.groups, links: section.links });
}
