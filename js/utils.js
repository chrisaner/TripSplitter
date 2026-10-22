export function sanitizeRoomId(raw) {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export function getShareUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function hashState(obj) {
  return JSON.stringify({
    poolBalances: obj.poolBalances,
    members: obj.members,
    expenses: obj.expenses
  });
}

/**
 * datetime-local value in the device's current time zone, without UTC conversion.
 */
export function getLocalISOString(dateInput) {
  const d = dateInput == null ? new Date() : new Date(dateInput);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function getDeviceTimeZoneLabel(dateInput) {
  const date = dateInput == null ? new Date() : new Date(dateInput);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${Intl.DateTimeFormat().resolvedOptions().timeZone} · UTC${sign}${hours}:${minutes}`;
}
