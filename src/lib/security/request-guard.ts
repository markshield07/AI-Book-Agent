// Request guard for a local, no-login app. Runs in middleware on every request.
//
// The app listens on every network address (0.0.0.0:3100) so any device on the home network
// can open it with no setup, e.g. http://192.168.1.20:3100. There is no sign-in, so anything
// that can make a browser send a request to the app could act as the author. Two attacks matter:
//  - DNS rebinding: a web page on evil.example re-points its own hostname at the app's address
//    and then reads http://evil.example:3100/api/account/export (every manuscript) as
//    same-origin. Blocked by only answering Host headers an outside website can't control:
//    IP addresses, localhost, bare computer names ("desktop-ab12") and mDNS names (*.local).
//    Any other name must be listed in ALLOWED_HOSTS (or ALLOWED_HOSTS="*" to allow all).
//  - Cross-site requests (CSRF): any page the author visits can send a "simple" POST to
//    localhost. Blocked by refusing state-changing requests that a browser marks as coming
//    from another site (Origin / Sec-Fetch-Site).
// Requests without browser headers (curl, scripts on this computer) are allowed: anything
// that can run commands here can already read the database file.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/
const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const COMPUTER_NAME = new RegExp(`^${LABEL}$`); // no dot: not a public domain
const MDNS_NAME = new RegExp(`^(${LABEL}\\.)+local$`); // home-network names like studio-pc.local

/**
 * True for Host names that only resolve on this computer or the home network, so no outside
 * website can point them at the app: IP literals, localhost, bare computer names, *.local.
 */
export function isNetworkLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || IPV4.test(hostname) || IPV6.test(hostname) ||
    (COMPUTER_NAME.test(hostname) && !/^\d+$/.test(hostname)) || MDNS_NAME.test(hostname);
}
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type GuardResult = { ok: true } | { ok: false; status: number; reason: string };

/** Hostname without the port, lower-cased. Handles IPv6 literals like [::1]:3100. */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  const colon = h.lastIndexOf(":");
  return colon >= 0 && h.indexOf(":") === colon ? h.slice(0, colon) : h;
}

export function allowedHosts(env: string | undefined = process.env.ALLOWED_HOSTS): Set<string> {
  const extra = (env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(extra);
}

function hostAllowed(hostname: string, allowed: Set<string>): boolean {
  return allowed.has("*") || allowed.has(hostname) || isNetworkLocalHost(hostname);
}

export function checkRequest(
  method: string,
  headers: { get(name: string): string | null },
  allowed: Set<string> = allowedHosts()
): GuardResult {
  const host = headers.get("host");
  if (!host || !hostAllowed(hostnameOf(host), allowed))
    return {
      ok: false,
      status: 421,
      reason: "Open the app by this computer's IP address (for example http://192.168.1.20:3100). To use a different name, add it to ALLOWED_HOSTS.",
    };

  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };

  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    return { ok: false, status: 403, reason: "Cross-site request refused." };

  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, status: 403, reason: "Cross-site request refused." };
    }
    if (originHost !== host.trim().toLowerCase()) return { ok: false, status: 403, reason: "Cross-site request refused." };
  } else if (origin === "null") {
    // Sandboxed iframes, data: URLs and file:// pages send Origin: null.
    return { ok: false, status: 403, reason: "Cross-site request refused." };
  }
  return { ok: true };
}
