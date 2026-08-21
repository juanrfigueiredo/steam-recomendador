import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../lib/db";
import type { AuthedVars } from "../lib/authMiddleware";
import { requireAuth, requireAdmin } from "../lib/authMiddleware";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
adminRoutes.use("*", requireAuth, requireAdmin);

// Só métricas agregadas -- nenhuma linha individual de usuário é exposta aqui.
adminRoutes.get("/reports", async (c) => {
  const db = getDb(c.env);

  const [totais, crescimentoSemanal, optIn, feedbackVolume] = await Promise.all([
    db`select count(*) as total_usuarios from users where deleted_at is null`,
    db`
      select date_trunc('week', created_at)::date as semana, count(*) as novos_usuarios
      from users
      where deleted_at is null
      group by 1
      order by 1 desc
      limit 12
    `,
    db`
      select
        count(*) filter (where consent_commercial) as com_opt_in,
        count(*) as total
      from users
      where deleted_at is null
    `,
    db`
      select date_trunc('week', created_at)::date as semana, count(*) as feedbacks
      from feedback
      group by 1
      order by 1 desc
      limit 12
    `,
  ]);

  return c.json({
    total_usuarios: totais[0],
    crescimento_semanal: crescimentoSemanal,
    taxa_opt_in_comercial: optIn[0],
    volume_feedback_semanal: feedbackVolume,
  });
});
