import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../lib/db";
import type { AuthedVars } from "../lib/authMiddleware";
import { requireAuth } from "../lib/authMiddleware";

export const scoreRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
scoreRoutes.use("*", requireAuth);

const CACHE_TTL_SECONDS = 300; // cache de borda, efêmero -- não é log persistente

// Usado pela extensão ao abrir a página de um jogo. Só lê a tabela
// `recommendations`, pré-calculada em lote (ver Fase 2). Não grava em
// nenhuma tabela a cada chamada -- só um cache de borda com TTL curto, para
// não sobrecarregar o banco em picos de navegação, que expira sozinho e
// nunca vira histórico consultável.
scoreRoutes.get("/:appId", async (c) => {
  const appId = Number(c.req.param("appId"));
  if (!Number.isInteger(appId)) return c.json({ error: "app_id inválido" }, 400);

  const cacheKey = new Request(
    `https://cache.local/score/${c.get("userId")}/${appId}`
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const db = getDb(c.env);
  const rows = await db`
    select score from recommendations where user_id = ${c.get("userId")} and app_id = ${appId}
  `;

  let score: number;
  if (rows.length > 0) {
    score = Number((rows[0] as { score: string }).score);
  } else {
    // Fallback: jogo ainda não teve score calculado em lote. Heurística
    // simples baseada na média de compatibilidade dos jogos já pontuados
    // que compartilham pelo menos uma tag com este -- suficiente até o
    // próximo ciclo do batch (Fase 2). `&&` é o operador de overlap de
    // array do Postgres; null && qualquer coisa é falso, então jogos sem
    // tag continuam degradando graciosamente pro score neutro abaixo.
    const fallbackRows = await db`
      select avg(r.score) as media
      from recommendations r
      join game_catalog gc_target on gc_target.app_id = ${appId}
      join game_catalog gc_scored on gc_scored.app_id = r.app_id and gc_scored.tags && gc_target.tags
      where r.user_id = ${c.get("userId")}
    `;
    const media = (fallbackRows[0] as { media: string | null } | undefined)?.media;
    score = media ? Number(media) : 50; // neutro quando não há nenhum dado ainda
  }

  const response = c.json({ app_id: appId, score });
  response.headers.set("Cache-Control", `private, max-age=${CACHE_TTL_SECONDS}`);
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});
