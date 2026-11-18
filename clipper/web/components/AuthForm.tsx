"use client";

import Link from "next/link";
import { useState } from "react";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    setError((await res.json().catch(() => ({}))).error ?? "Algo salió mal.");
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">{mode === "login" ? "Entra en tu cuenta" : "Crea tu cuenta"}</h1>
      <p className="mt-1 text-sm text-muted">
        {mode === "signup" ? "Incluye 60 minutos gratis para probar." : "Sigue convirtiendo vídeos en clips."}
      </p>
      <form onSubmit={onSubmit} className="card mt-6 space-y-3 p-5">
        <label className="block text-sm">
          Email
          <input name="email" type="email" required autoComplete="email" className="input mt-1" />
        </label>
        <label className="block text-sm">
          Contraseña
          <input
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="input mt-1"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Un momento…" : mode === "login" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            ¿No tienes cuenta? <Link className="text-accent" href="/signup">Créala gratis</Link>
          </>
        ) : (
          <>
            ¿Ya tienes cuenta? <Link className="text-accent" href="/login">Entra</Link>
          </>
        )}
      </p>
    </div>
  );
}
