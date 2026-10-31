/** Presentation-only app handoff. Stored URLs remain HTTP(S), never app schemes.
 * References and limits: docs/dashboard-workspace.md#mobile-app-links.
 */
export function isIOSLinkPlatform({ userAgent, platform, maxTouchPoints }: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
  // OS identity is used only for OS-specific URI handlers, never for layout or
  // touch capabilities. iPadOS can identify as a Mac; desktop Macs stay web-only.
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function savedLinkLaunch(raw: string, ios: boolean): { href: string; app?: string; home?: boolean } {
  let url: URL;
  try { url = new URL(raw); } catch { return { href: raw }; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return { href: raw };
  if (ios) {
    if (url.hostname === "mail.google.com" && /^\/mail\/(?:u\/\d+\/?)?$/.test(url.pathname) && !url.search && ["", "#inbox"].includes(url.hash)) {
      return { href: "googlegmail://", app: "Gmail", home: true };
    }
    if (url.hostname === "calendar.google.com" && ["/", "/calendar/"].includes(url.pathname) && !url.search && !url.hash) {
      return { href: "googlecalendar://", app: "Google Calendar", home: true };
    }
    if (url.hostname === "docs.google.com") {
      if (/^\/document\/(?:u\/\d+\/)?d\/[\w-]+(?:\/|$)/.test(url.pathname)) {
        return { href: `googledocs://${raw}`, app: "Google Docs" };
      }
      if (/^\/document\/(?:u\/\d+\/)?$/.test(url.pathname) && !url.hash && [...url.searchParams.keys()].every(key => key === "tgif")) {
        return { href: "googledocs://", app: "Google Docs", home: true };
      }
    }
    // Only actual page URLs, not Notion's login/settings or arbitrary subdomains.
    if (["www.notion.so", "notion.so"].includes(url.hostname) && /[a-f0-9]{32}\/?$/i.test(url.pathname)) {
      return { href: `notion://${url.host}${url.pathname}${url.search}${url.hash}`, app: "Notion" };
    }
  }
  // Ordinary HTTPS links allow OS Universal/App Links and naturally fall back to
  // the site. No invented custom schemes for GitHub, ChatGPT, Claude or NotebookLM.
  return { href: raw };
}
