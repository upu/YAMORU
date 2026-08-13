export const PHASE_ONE_TIME_ZONE = "Asia/Tokyo";

function parseDateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, month, day];
}

export function tokyoDateToUtcIso(value: string): string | null {
  if (parseDateParts(value) === null) return null;
  return new Date(`${value}T00:00:00+09:00`).toISOString();
}

export function addDaysToTokyoDateUtcIso(
  value: string,
  days: number,
): string | null {
  const parts = parseDateParts(value);
  if (parts === null) return null;
  const [year, month, day] = parts;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const shiftedDate = [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return tokyoDateToUtcIso(shiftedDate);
}

export function formatTokyoDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "long",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date(value));
}
