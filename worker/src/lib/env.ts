export type Env = {
  DATABASE_URL: string;
  STEAM_API_KEY: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
  // PAT com permissão de "actions:write" no repo, usada só pra disparar o
  // workflow de geração de recomendações depois de um /me/sync bem-sucedido.
  GITHUB_DISPATCH_TOKEN: string;
};
