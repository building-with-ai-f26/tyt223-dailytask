// Which push addresses the reminder server will send to. A phone's push subscription always points at
// its browser maker's push service; anything else (a fake address saved by a user) is refused, so the
// server can't be used to send requests to arbitrary websites. Pure, no imports, tested in Node.

const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_SUFFIXES = [".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com"];

export function pushEndpointAllowed(endpoint) {
  let url;
  try { url = new URL(String(endpoint || "")); } catch (e) { return false; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_SUFFIXES.some((s) => host.endsWith(s));
}
