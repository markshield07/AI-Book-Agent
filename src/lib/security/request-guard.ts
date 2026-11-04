// Request guard for a local, no-login app. Runs in middleware on every request.
//
// Because there is no sign-in, anything that can make the browser send a request to
// localhost:3100 could act as the author. Two attacks matter:
//  - DNS rebinding: a web page on evil.example re-points its own hostname at 127.0.0.1 and
//    then reads http://evil.example:3100/api/account/export (every manuscript) as same-origin.
//    Blocked by only answering requests whose Host header is a local name (or ALLOWED_HOSTS).
//  - Cross-site requests (CSRF): any page the author visits can send a "simple" POST to
//    localhost. Blocked by refusing state-changing requests that a browser marks as coming
//    from another site (Origin / Sec-Fetch-Site).
// Requests without browser headers (curl, scripts on this computer) are allowed: anything
// that can run commands here can already read the database file.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
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
  return new Set([...LOCAL_HOSTS, ...extra]);
}

export function checkRequest(
  method: string,
  headers: { get(name: string): string | null },
  allowed: Set<string> = allowedHosts()
): GuardResult {
  const host = headers.get("host");
  if (!host || !allowed.has(hostnameOf(host)))
    return { ok: false, status: 421, reason: "This app only answers on localhost. Add the host to ALLOWED_HOSTS to allow it." };

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
