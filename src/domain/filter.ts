import type { Label } from "./types";

/** The label filter: matches by label name, ignoring case, so it works across boards (spec AC3.7). */
export function matchesLabelFilter(labels: Label[] | undefined, filterName: string | null): boolean {
  if (!filterName) return true;
  const want = filterName.trim().toLowerCase();
  return (labels ?? []).some((l) => l.name.trim().toLowerCase() === want);
}

/** Distinct label names (first spelling wins), for the filter dropdown. */
export function labelNames(labels: Label[]): string[] {
  const seen = new Map<string, string>();
  for (const l of labels) {
    const k = l.name.trim().toLowerCase();
    if (!seen.has(k)) seen.set(k, l.name.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
