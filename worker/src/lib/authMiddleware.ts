import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "./env";
import { verifySessionToken, SESSION_COOKIE_NAME } from "./session";

export type AuthedVars = {
  userId: number;
  isAdmin: boolean;
};

// Exige sessão válida. Em caso de sucesso, injeta userId/isAdmin no contexto
// para as rotas seguintes lerem com c.get("userId").
export async function requireAuth(c: Context<{ Bindings: Env; Variables: AuthedVars }>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return c.json({ error: "não autenticado" }, 401);

  const payload = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "sessão inválida ou expirada" }, 401);

  c.set("userId", payload.userId);
  c.set("isAdmin", payload.isAdmin);
  await next();
}

export async function requireAdmin(c: Context<{ Bindings: Env; Variables: AuthedVars }>, next: Next) {
  if (!c.get("isAdmin")) return c.json({ error: "acesso restrito" }, 403);
  await next();
}
