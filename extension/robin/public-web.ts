/** Shared hostname guard for server-side fetches whose target came from a user or model. */

/** Hosts that must never be reachable from a URL we did not choose. */
const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|\[?::1\]?|0\.0\.0\.0)$/i;
const PRIVATE_IPV4 = /^(?:10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./;
const DOMAIN_NAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Refuse direct private addresses and address encodings disguised as hostnames. */
export function isPublicWebHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host)) return false;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return DOMAIN_NAME.test(host);
}

