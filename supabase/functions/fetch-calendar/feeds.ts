// Which calendar links DailyQuest will fetch. Pure, no imports: used by the fetch-calendar
// Edge Function (the real safety check) and mirrored in the app (docs/app/index.html) for
// friendly error messages. Keep the two lists in sync.

const EXACT_HOSTS = ["calendar.google.com", "outlook.office365.com", "outlook.office.com", "outlook.live.com"];
const HOST_SUFFIXES = [".icloud.com", ".brightspace.com", ".d2l.com"];

export function feedHostAllowed(host) {
  host = String(host || "").toLowerCase();
  // School Brightspace sites look like brightspace.nyu.edu; only .edu hosts qualify, so brightspace.attacker.com doesn't.
  return EXACT_HOSTS.includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s)) || (host.endsWith(".edu") && host.split(".").includes("brightspace"));
}

// Turns a pasted link into a safe https URL, or "" if it isn't a supported calendar link.
// webcal:// links (what "subscribe" buttons often give) are the same feed over https.
export function normalizeFeedUrl(raw) {
  let text = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url;
  try { url = new URL(text); } catch (e) { return ""; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";
  if (!feedHostAllowed(url.hostname)) return "";
  return url.href;
}
