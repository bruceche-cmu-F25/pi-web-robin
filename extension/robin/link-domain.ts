/** Saved-link behavior shared by the HTTP and Pi tool adapters. */
import { fetchPageMetadata, nameFromUrl } from "./fetch-title.ts";
import { removeIcon, storeIcon } from "./icons.ts";
import {
  groupLinks,
  newId,
  normalizeUrl,
  readLinks,
  reorderLinkGroups as reorderGroups,
  updateLinks,
  type Link,
} from "./store.ts";

export type LinkTitleSource = "given" | "page" | "url";

export function listLinks(): Link[] {
  return readLinks();
}

export function getLink(id: string): Link | null {
  return readLinks().find((entry) => entry.id === id) ?? null;
}

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
  updateLinks((links) => {
    links.push(link);
    return { value: undefined, changed: true };
  });
  return { link, titleSource };
}

export async function updateLink(
  id: string,
  patch: { title?: string; url?: string; group?: string },
): Promise<Link | null> {
  const before = getLink(id);
  if (!before) return null;

  const title = patch.title?.trim();
  if (patch.title !== undefined && !title) throw new Error("title cannot be empty");
  const url = patch.url !== undefined && patch.url.trim() ? normalizeUrl(patch.url) : before.url;
  const addressChanged = url !== before.url;
  const metadata = addressChanged ? await fetchPageMetadata(url) : null;
  const icon = metadata?.iconUrl ? await storeIcon(id, metadata.iconUrl) : null;

  // Re-read after network I/O so an unrelated link written in the meantime is
  // not replaced by the snapshot this operation started with.
  let oldIcon: string | undefined;
  const link = updateLinks((links) => {
    const current = links.find((entry) => entry.id === id);
    if (!current) return { value: null, changed: false };
    oldIcon = current.icon;

    current.url = url;
    if (title) current.title = title;
    else if (metadata?.title && current.title === before.title) current.title = metadata.title;
    if (patch.group !== undefined) {
      const group = patch.group.trim();
      if (group) current.group = group;
      else delete current.group;
    }
    if (addressChanged) {
      if (icon) current.icon = icon;
      else delete current.icon;
      current.iconCheckedAt = new Date().toISOString();
    }
    return { value: current, changed: true };
  });
  if (!link) {
    removeIcon(id, icon ?? undefined);
    return null;
  }
  if (addressChanged && oldIcon !== icon) removeIcon(id, oldIcon);
  return link;
}

export function reorderLinkGroups(groups: string[]): void {
  const requested = groups.map((group) => group.trim());
  updateLinks((links) => {
    const current = groupLinks(links).map(({ group }) => group);
    if (requested.length !== current.length
      || new Set(requested).size !== requested.length
      || current.some((group) => !requested.includes(group))) {
      throw new Error("groups must contain every current section exactly once");
    }
    const reordered = reorderGroups(links, requested);
    links.splice(0, links.length, ...reordered);
    return { value: undefined, changed: true };
  });
}

export function deleteLink(id: string): Link | null {
  const deleted = updateLinks((links) => {
    const index = links.findIndex((entry) => entry.id === id);
    if (index < 0) return { value: null, changed: false };
    const [link] = links.splice(index, 1);
    return { value: link ?? null, changed: true };
  });
  if (deleted) removeIcon(deleted.id, deleted.icon);
  return deleted;
}

export async function refreshLinkIcon(id: string): Promise<{ link: Link; icon: string | null } | null> {
  const before = getLink(id);
  if (!before) return null;
  const { iconUrl } = await fetchPageMetadata(before.url);
  const icon = iconUrl ? await storeIcon(id, iconUrl) : null;

  // Metadata loading is slow; merge into the latest file rather than replacing
  // links another caller saved while this request was in flight.
  let oldIcon: string | undefined;
  const link = updateLinks((links) => {
    const current = links.find((entry) => entry.id === id);
    if (!current) return { value: null, changed: false };
    if (current.url !== before.url) return { value: current, changed: false };
    oldIcon = current.icon;
    if (icon) current.icon = icon;
    else delete current.icon;
    current.iconCheckedAt = new Date().toISOString();
    return { value: current, changed: true };
  });
  if (!link) {
    removeIcon(id, icon ?? undefined);
    return null;
  }
  if (link.url !== before.url) return { link, icon: link.icon ?? null };
  if (oldIcon !== icon) removeIcon(id, oldIcon);
  return { link, icon };
}
