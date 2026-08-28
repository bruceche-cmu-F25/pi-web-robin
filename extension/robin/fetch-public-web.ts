/** SSRF-safe fetch for URLs supplied by a user, model, or remote page. */
import { lookup as systemLookup } from "node:dns";
import { BlockList } from "node:net";
import { Agent } from "undici";
import { isPublicWebHost } from "./public-web.ts";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as const) blocked.addSubnet(network, prefix, "ipv6");

export function isPublicWebAddress(address: string, family: number): boolean {
  if (family !== 4 && family !== 6) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const dispatcher = new Agent({
  connect: {
    // Validation and connection share this lookup result, closing the usual
    // DNS-rebinding gap between a preflight lookup and fetch's own lookup.
    lookup(hostname, options, callback) {
      systemLookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, []);
        if (addresses.length === 0 || addresses.some(({ address, family }) =>
          !isPublicWebAddress(address, family))) {
          return callback(new Error(`Refusing private address for ${hostname}`), []);
        }
        callback(null, addresses);
      });
    },
  },
});

/** Fetch a public HTTP(S) URL, pinning DNS and re-checking every redirect. */
export async function fetchPublicWeb(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  maxRedirects = 5,
): Promise<Response> {
  let target = new URL(url);

  for (let hop = 0; ; hop += 1) {
    if (!/^https?:$/.test(target.protocol) || !isPublicWebHost(target.hostname)) {
      throw new Error(`Refusing private or unsupported URL: ${target.href}`);
    }

    const response = await fetchImpl(target.toString(), {
      ...init,
      redirect: "manual",
      dispatcher,
    } as RequestInit);
    const location = response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
    if (!location) return response;

    await response.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new Error("Too many redirects");
    target = new URL(location, target);
  }
}
