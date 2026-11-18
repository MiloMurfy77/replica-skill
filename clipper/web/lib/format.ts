export function fmtTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "–";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function parseTime(v: string): number | null {
  const parts = v.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export const JOB_STEPS = [
  { key: "queued", label: "En cola" },
  { key: "transcribing", label: "Transcribiendo" },
  { key: "selecting", label: "Buscando los mejores momentos" },
  { key: "framing", label: "Encuadrando y subtitulando" },
  { key: "done", label: "Listo" },
] as const;

export function scoreColor(score: number): string {
  if (score >= 80) return "text-accent border-accent";
  if (score >= 60) return "text-ok border-ok";
  return "text-muted border-line";
}
