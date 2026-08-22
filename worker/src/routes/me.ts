import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../lib/db";
import type { AuthedVars } from "../lib/authMiddleware";
import { requireAuth } from "../lib/authMiddleware";
import { fetchOwnedGames } from "../lib/steamAuth";

export const meRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
meRoutes.use("*", requireAuth);

meRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db`
    select id, steam_id, display_name, avatar_url, created_at, consent_commercial
    from users
    where id = ${c.get("userId")} and deleted_at is null
  `;
  if (rows.length === 0) return c.json({ error: "usuário não encontrado" }, 404);
  return c.json(rows[0]);
});

meRoutes.get("/library", async (c) => {
  const db = getDb(c.env);
  const rows = await db`
    select gl.app_id, gc.nome, gl.playtime_minutos, gl.last_synced_at
    from game_library gl
    join game_catalog gc on gc.app_id = gl.app_id
    where gl.user_id = ${c.get("userId")}
    order by gl.playtime_minutos desc
  `;
  return c.json({ jogos: rows });
});

// Sincroniza a biblioteca Steam do usuário: busca a lista atual na Steam Web
// API e faz upsert em game_catalog + game_library. Roda sob demanda (o
// usuário clica em "sincronizar"), não em todo request.
meRoutes.post("/sync", async (c) => {
  const db = getDb(c.env);
  const userRows = await db`select steam_id from users where id = ${c.get("userId")}`;
  if (userRows.length === 0) return c.json({ error: "usuário não encontrado" }, 404);
  const steamId64 = (userRows[0] as { steam_id: string }).steam_id;

  const games = await fetchOwnedGames(steamId64, c.env.STEAM_API_KEY);

  // Upsert em lote (unnest) em vez de uma query por jogo: o Worker tem limite
  // de subrequests por invocação (50 no plano gratuito), e uma query por jogo
  // estoura esse limite em qualquer biblioteca com mais de ~25 jogos.
  if (games.length > 0) {
    const appIds = games.map((g) => g.appid);
    const names = games.map((g) => g.name ?? "(sem nome)");
    const playtimes = games.map((g) => g.playtime_forever);

    try {
      await db`
        insert into game_catalog (app_id, nome)
        select * from unnest(${appIds}::bigint[], ${names}::text[])
        on conflict (app_id) do update set nome = excluded.nome
      `;
      await db`
        insert into game_library (user_id, app_id, playtime_minutos, last_synced_at)
        select ${c.get("userId")}, app_id, playtime, now()
        from unnest(${appIds}::bigint[], ${playtimes}::integer[]) as t(app_id, playtime)
        on conflict (user_id, app_id) do update
          set playtime_minutos = excluded.playtime_minutos,
              last_synced_at = excluded.last_synced_at
      `;
    } catch (err) {
      return c.json({ error: "falha ao sincronizar biblioteca", detalhe: String(err) }, 500);
    }
  }

  return c.json({ ok: true, jogos_sincronizados: games.length });
});

// Consentimento comercial: leitura e atualização, sempre com log de auditoria.
meRoutes.get("/consent", async (c) => {
  const db = getDb(c.env);
  const rows = await db`select consent_commercial, consent_commercial_at from users where id = ${c.get("userId")}`;
  return c.json(rows[0] ?? { consent_commercial: false, consent_commercial_at: null });
});

meRoutes.post("/consent", async (c) => {
  const body = await c.req.json<{ consent_commercial: boolean }>();
  const db = getDb(c.env);

  await db`
    update users
    set consent_commercial = ${body.consent_commercial}, consent_commercial_at = now()
    where id = ${c.get("userId")}
  `;
  await db`
    insert into consent_log (user_id, tipo, concedido)
    values (${c.get("userId")}, 'uso_comercial_agregado', ${body.consent_commercial})
  `;

  return c.json({ ok: true });
});

// Exportação estruturada de tudo que temos sobre o usuário (direito de acesso, LGPD art. 18).
meRoutes.get("/export", async (c) => {
  const db = getDb(c.env);
  const userId = c.get("userId");

  const [user, library, feedback, consentLog] = await Promise.all([
    db`select id, steam_id, display_name, avatar_url, created_at, consent_commercial, consent_commercial_at
       from users where id = ${userId}`,
    db`select app_id, playtime_minutos, last_synced_at from game_library where user_id = ${userId}`,
    db`select app_id, predicted_score, confirmed, user_rating, created_at from feedback where user_id = ${userId}`,
    db`select tipo, concedido, created_at from consent_log where user_id = ${userId}`,
  ]);

  return c.json({
    usuario: user[0] ?? null,
    biblioteca: library,
    feedback,
    historico_consentimento: consentLog,
  });
});

// Exclusão: soft-delete imediato + agendamento de purga definitiva em 30 dias.
// A purga de fato roda em um job separado (ver scripts/purge_deleted_users.py).
meRoutes.post("/delete", async (c) => {
  const db = getDb(c.env);
  const userId = c.get("userId");

  await db`update users set deleted_at = now() where id = ${userId}`;
  await db`
    insert into deletion_requests (user_id, scheduled_purge_at)
    values (${userId}, now() + interval '30 days')
  `;

  return c.json({ ok: true, mensagem: "conta marcada para exclusão em até 30 dias" });
});
