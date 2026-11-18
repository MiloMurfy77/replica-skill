import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { minutesUsed } from "@/lib/data";
import LogoutButton from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipper — de vídeo largo a clips",
  description: "Convierte vídeos largos en decenas de clips verticales listos para publicar.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const used = user ? await minutesUsed(user.id) : 0;
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink">✂</span>
              Clipper
            </Link>
            {user ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="rounded-full border border-line px-3 py-1 text-muted" title="Minutos de vídeo analizados">
                  {used} min analizados
                </span>
                <span className="hidden text-muted sm:inline">{user.email}</span>
                <LogoutButton />
              </div>
            ) : (
              <div className="flex gap-2 text-sm">
                <Link href="/login" className="btn-ghost">
                  Entrar
                </Link>
                <Link href="/signup" className="btn-primary">
                  Crear cuenta
                </Link>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
