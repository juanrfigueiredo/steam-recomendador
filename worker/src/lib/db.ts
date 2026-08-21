import { neon } from "@neondatabase/serverless";
import type { Env } from "./env";

// Cria um client de query por request. O driver HTTP da Neon é feito
// exatamente para rodar dentro de Workers (sem TCP persistente).
export function getDb(env: Env) {
  return neon(env.DATABASE_URL);
}
