export type PhoneResult =
  | { ok: true; key: string }
  | { ok: false; reason: "missing" | "invalid" };

export function normalizePhone(raw: string | undefined): PhoneResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, reason: "missing" };

  let digits = trimmed.replace(/\D/g, "");          // keep only digits
  if (digits.length === 10) digits = "1" + digits;  // assume US number
  if (digits.length < 7 || digits.length > 15) return { ok: false, reason: "invalid" };

  return { ok: true, key: digits };
}