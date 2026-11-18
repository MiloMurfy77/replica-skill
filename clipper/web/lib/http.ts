import { NextResponse } from "next/server";
import { currentUser, type User } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** Envuelve un handler de API: exige sesión y traduce errores a JSON. */
export function withUser<A extends unknown[]>(fn: (user: User, ...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      const user = await currentUser();
      if (!user) return json({ error: "Inicia sesión para continuar." }, 401);
      return await fn(user, ...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Error interno." }, 500);
    }
  };
}
