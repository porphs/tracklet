import { deadlineStatus, statusBadge, type DeadlineStatus } from "../domain/deadline";
import type { DateStr } from "../domain/types";

/** Short date for display, e.g. "Nov 20" (adds the year when it is not this year). */
export function shortDate(date: DateStr, today: DateStr): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.slice(0, 4) !== today.slice(0, 4)) opts.year = "numeric";
  return dt.toLocaleDateString(undefined, opts);
}

export function statusClass(status: DeadlineStatus): string {
  return status === "none" ? "" : ` status-${status}`;
}

/**
 * The one way every view shows a deadline: date text, plus a coloured text badge when
 * near or overdue. Colour is never the only signal.
 */
export function DeadlineBadge({
  date,
  today,
  nearWindow,
  closed,
  prefix = "Due",
}: {
  date: DateStr | null;
  today: DateStr;
  nearWindow: number;
  closed: boolean;
  prefix?: string;
}) {
  if (!date) return null;
  const info = deadlineStatus(date, today, nearWindow, closed);
  const badge = statusBadge(info);
  return (
    <span className={`deadline${statusClass(info.status)}`} title={`${prefix} ${date}`}>
      {badge ?? `${prefix} ${shortDate(date, today)}`}
    </span>
  );
}
