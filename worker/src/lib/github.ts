const REPO = "juanrfigueiredo/steam-recomendador";
const WORKFLOW_FILE = "generate-recommendations.yml";

// Dispara o workflow "Gerar recomendações em lote" (normalmente só roda no
// cron diário) na hora, depois que um usuário sincroniza a biblioteca --
// pra não esperar até 24h pras recomendações dele aparecerem.
export async function triggerRecommendationGeneration(token: string): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "steam-recomendador-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!response.ok) {
    console.error(`falha ao disparar geração de recomendações: ${response.status} ${await response.text()}`);
  }
}
