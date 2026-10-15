// This local deployment uses Pi on tailnet HTTPS 443 and Hermes on 8443.
// Build a fresh URL: never forward Pi's session, cwd, hash or credentials.
export function hermesHrefForHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    return "http://127.0.0.1:8788/";
  }
  if (/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(host)) {
    return `https://${host}:8443/`;
  }
  return null;
}
