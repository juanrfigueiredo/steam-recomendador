import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env } from "../lib/env";
import { getDb } from "../lib/db";
import { buildSteamLoginUrl, verifySteamCallback, fetchSteamPlayerSummary } from "../lib/steamAuth";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../lib/session";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/steam/login", (c) => {
  // return_to/realm apontam pro proxy same-origin do frontend
  // (frontend/functions/api/), não pro domínio do Worker -- é lá que o
  // navegador acaba depois do callback, e é onde o cookie de sessão
  // precisa ser gravado como primeiro domínio (ver setCookie abaixo).
  const returnTo = `${c.env.FRONTEND_URL}/api/auth/steam/callback`;
  const realm = c.env.FRONTEND_URL;
  return c.redirect(buildSteamLoginUrl(returnTo, realm));
});

authRoutes.get("/steam/callback", async (c) => {
  const steamId64 = await verifySteamCallback(new URL(c.req.url).searchParams);
  if (!steamId64) {
    return c.json({ error: "falha ao verificar login com a Steam" }, 401);
  }

  const summary = await fetchSteamPlayerSummary(steamId64, c.env.STEAM_API_KEY);
  const db = getDb(c.env);

  // upsert: cria o usuário na primeira vez, atualiza nome/avatar nas seguintes.
  const rows = await db`
    insert into users (steam_id, display_name, avatar_url)
    values (${steamId64}, ${summary?.personaname ?? null}, ${summary?.avatarfull ?? null})
    on conflict (steam_id) do update
      set display_name = excluded.display_name,
          avatar_url = excluded.avatar_url
    returning id, is_admin
  `;
  const user = rows[0] as { id: number; is_admin: boolean };

  const token = await createSessionToken(
    { userId: user.id, isAdmin: user.is_admin, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    c.env.SESSION_SECRET
  );

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    // "Lax" porque este callback é alcançado via proxy same-origin do
    // frontend (frontend/functions/api/) -- o navegador só vê o domínio do
    // Pages, então o cookie é de primeira parte (não é mais bloqueado por
    // navegadores que recusam cookies de terceiros).
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  // O frontend decide, no lado dele, se isso é um popup (avisa a janela
  // original e se fecha) ou navegação de página inteira (segue pro
  // dashboard) -- ver frontend/auth-callback.html.
  return c.redirect(`${c.env.FRONTEND_URL}/auth-callback.html`);
});

authRoutes.post("/logout", (c) => {
  setCookie(c, SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return c.json({ ok: true });
});
