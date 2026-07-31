function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as an iCalendar UTC timestamp: YYYYMMDDTHHMMSSZ */
export function icsDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildICS(m: {
  id: string;
  title: string;
  agenda?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt?: Date;
}): string {
  const end = m.endsAt ?? new Date(m.startsAt.getTime() + 60 * 60 * 1000); // default 1 hour
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CAG WMS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.id}@cag-wms`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(m.title)}`,
    m.agenda ? `DESCRIPTION:${esc(m.agenda)}` : "",
    m.location ? `LOCATION:${esc(m.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
