import path from "node:path";

export const STORAGE_DIR = path.resolve(
  process.env.STORAGE_DIR ?? path.join(process.cwd(), "..", ".data", "storage"),
);

/** Ruta absoluta dentro del almacenamiento; nunca deja salir de él. */
export function storagePath(rel: string): string {
  const p = path.resolve(STORAGE_DIR, rel);
  if (!p.startsWith(STORAGE_DIR + path.sep)) throw new Error("ruta fuera del almacenamiento");
  return p;
}
