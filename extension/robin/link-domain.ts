/** Saved-link behavior shared by the HTTP and Pi tool adapters. */
import { fetchPageMetadata, nameFromUrl } from "./fetch-title.ts";
import { removeIcon, storeIcon } from "./icons.ts";
import {
  groupLinks,
  newId,
  normalizeUrl,
  readLinks,
  reorderLinkGroups as reorderGroups,
  writeLinks,
  type Link,
} from "./store.ts";

export type LinkTitleSource = "given" | "page" | "url";

export async function addLink(input: { url: string; title?: string; group?: string }): Promise<{
  link: Link;
  titleSource: LinkTitleSource;
}> {
  const url = normalizeUrl(input.url);
  const given = input.title?.trim();
  const { title: fetched, iconUrl } = await fetchPageMetadata(url);
  const titleSource: LinkTitleSource = given ? "given" : fetched ? "page" : "url";
  const title = given || fetched || nameFromUrl(url);
  const group = input.group?.trim() || undefined;
  const id = newId();
  const icon = iconUrl ? await storeIcon(id, iconUrl) : null;
  const link: Link = {
    id,
    title,
    url,
    ...(group ? { group } : {}),
    ...(icon ? { icon } : {}),
    iconCheckedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const links = readLinks();
  links.push(link);
  writeLinks(links);
  return { link, titleSource };
}

export async function updateLink(
  id: string,
  patch: { title?: string; url?: string; group?: string },
): Promise<Link | null> {
  const links = readLinks();
  const link = links.find((entry) => entry.id === id);
  if (!link) return null;

  let addressChanged = false;
  if (patch.url !== undefined && patch.url.trim()) {
    const url = normalizeUrl(patch.url);
    addressChanged = url !== link.url;
    link.url = url;
  }
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("title cannot be empty");
    link.title = title;
  }
  if (patch.group !== undefined) {
    const group = patch.group.trim();
    if (group) link.group = group;
    else delete link.group;
  }

  if (addressChanged) {
    removeIcon(link.id, link.icon);
    delete link.icon;
    const { title: fetched, iconUrl } = await fetchPageMetadata(link.url);
    if (patch.title === undefined && fetched) link.title = fetched;
    const icon = iconUrl ? await storeIcon(link.id, iconUrl) : null;
    if (icon) link.icon = icon;
    link.iconCheckedAt = new Date().toISOString();
  }

  writeLinks(links);
  return link;
}

export function reorderLinkGroups(groups: string[]): void {
  const links = readLinks();
  const requested = groups.map((group) => group.trim());
  const current = groupLinks(links).map(({ group }) => group);
  if (requested.length !== current.length
    || new Set(requested).size !== requested.length
    || current.some((group) => !requested.includes(group))) {
    throw new Error("groups must contain every current section exactly once");
  }
  writeLinks(reorderGroups(links, requested));
}

export function deleteLink(id: string): Link | null {
  const links = readLinks();
  const link = links.find((entry) => entry.id === id);
  if (!link) return null;
  removeIcon(link.id, link.icon);
  writeLinks(links.filter((entry) => entry.id !== id));
  return link;
}

export async function refreshLinkIcon(id: string): Promise<{ link: Link; icon: string | null } | null> {
  const links = readLinks();
  const link = links.find((entry) => entry.id === id);
  if (!link) return null;
  const { iconUrl } = await fetchPageMetadata(link.url);
  const icon = iconUrl ? await storeIcon(link.id, iconUrl) : null;
  if (icon) link.icon = icon;
  else delete link.icon;
  link.iconCheckedAt = new Date().toISOString();
  writeLinks(links);
  return { link, icon };
}
