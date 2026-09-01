import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../lib/db";
import type { AuthedVars } from "../lib/authMiddleware";
import { requireAuth } from "../lib/authMiddleware";

export const recommendationsRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
recommendationsRoutes.use("*", requireAuth);

recommendationsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db`
    select r.app_id, gc.nome, gc.imagem_url, gc.preco_moeda, gc.preco_inicial_centavos,
           gc.preco_final_centavos, gc.desconto_percentual, gc.gratuito, r.genero_motivo,
           r.score, r.generated_at
    from recommendations r
    join game_catalog gc on gc.app_id = r.app_id
    where r.user_id = ${c.get("userId")}
    order by r.score desc
    limit 50
  `;
  return c.json({ recomendacoes: rows });
});
