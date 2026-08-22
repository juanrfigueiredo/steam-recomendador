import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/env";
import type { AuthedVars } from "./lib/authMiddleware";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { recommendationsRoutes } from "./routes/recommendations";
import { scoreRoutes } from "./routes/score";
import { feedbackRoutes } from "./routes/feedback";
import { adminRoutes } from "./routes/admin";

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

app.use(
  "*",
  cors({
    origin: (origin, c) => (origin === c.env.FRONTEND_URL ? origin : ""),
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/auth", authRoutes);
app.route("/me", meRoutes);
app.route("/recommendations", recommendationsRoutes);
app.route("/score", scoreRoutes);
app.route("/feedback", feedbackRoutes);
app.route("/admin", adminRoutes);

export default app;
