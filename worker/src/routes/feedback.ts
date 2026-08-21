import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../lib/db";
import type { AuthedVars } from "../lib/authMiddleware";
import { requireAuth } from "../lib/authMiddleware";

export const feedbackRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
feedbackRoutes.use("*", requireAuth);

type FeedbackBody = {
  app_id: number;
  predicted_score: number;
  confirmed: boolean;
  user_rating?: number; // 0-100, obrigatório quando confirmed = false
};

feedbackRoutes.post("/", async (c) => {
  const body = await c.req.json<FeedbackBody>();

  if (!body.confirmed && (body.user_rating === undefined || body.user_rating < 0 || body.user_rating > 100)) {
    return c.json({ error: "user_rating (0-100) é obrigatório quando confirmed = false" }, 400);
  }

  const db = getDb(c.env);
  await db`
    insert into feedback (user_id, app_id, predicted_score, confirmed, user_rating)
    values (${c.get("userId")}, ${body.app_id}, ${body.predicted_score}, ${body.confirmed}, ${body.confirmed ? null : body.user_rating})
  `;

  return c.json({ ok: true });
});
