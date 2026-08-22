# Status geral do projeto

## Fase 0 — Setup
**Concluída em 22/08/2026.** Contas, banco e secrets criados. O bloqueio era secrets cadastrados em "Settings → **Agents** secrets and variables" (seção separada, usada por agentes de IA) em vez de "Settings → **Actions** secrets and variables" — os workflows leem `${{ secrets.NOME }}`, que só enxerga Actions. Depois de recadastrar `CLOUDFLARE_API_TOKEN`, `DATABASE_URL`, `STEAM_API_KEY`, `SESSION_SECRET` em Actions: `migrate.yml` rodou e aplicou o schema no Neon, `deploy-worker.yml` rodou e publicou o Worker em `https://steam-recomendador-api.juanrfigueiredo.workers.dev`. `PUBLIC_BASE_URL` no `wrangler.toml` atualizado para essa URL (commit `e417fc4`) e redeployado. Testado `GET /auth/steam/login` — redireciona corretamente para o Steam OpenID com `return_to`/`realm` apontando pra URL de produção.

## Fase 1 — Backend core
**Concluída em 22/08/2026.** Código entregue: autenticação Steam OpenID, endpoints principais (`/me`, `/me/library`, `/me/sync`, `/me/consent`, `/me/export`, `/me/delete`, `/recommendations`, `/score/:appId`, `/feedback`, `/admin/reports`). Typecheck ok. Deploy confirmado em produção, `PUBLIC_BASE_URL` correto, login da Steam testado e funcionando.

## Fase 2 — Motor de recomendação em lote
Código entregue e agora rodando de ponta a ponta em produção (22/08/2026). No caminho, achamos e corrigimos duas lacunas reais:
- `game_catalog.genero` nunca era preenchido em lugar nenhum (o motor é baseado em gênero). Criado `scripts/enrich_catalog.py`, que busca gênero/tags na Steam Store API (endpoint `appdetails`) pros jogos pendentes e roda como passo antes de `generate-recommendations.py` no workflow `generate-recommendations.yml`.
- `gerar_recomendacoes()` quebrava (`nlargest` em coluna vazia) quando um usuário não tinha nenhum jogo candidato. Blindado com `continue` nesse caso.

Rodado com sucesso: 140/146 jogos do único usuário de teste ganharam gênero (6 sem classificação disponível na Steam, ficam pendentes). **0 recomendações geradas — esperado, não é bug**: com só 1 usuário sincronizado, o catálogo inteiro é a própria biblioteca dele, não sobra candidato. Precisa de mais um usuário sincronizado (ou popular o catálogo com jogos que ninguém tem) pra ver o motor recomendar algo de fato.

## Fase 5 — Integrações de venda de dados
Código entregue: `aggregate_preferences.py`, `publish_aws_data_exchange.py`, `publish_datarade.py`, workflow `publish-datasets.yml`. Falta criar o dataset no AWS Data Exchange e o cadastro no Datarade Provider Studio (isso é Fase 8).

## Fase 3 — Frontend
Código entregue e deployado em 22/08/2026: landing (`index.html`, login) e dashboard (`dashboard.html`: biblioteca, recomendações com feedback, consentimento comercial, exportar/excluir conta), HTML/CSS/JS puro, sem build. Publicado no Cloudflare Pages: `https://steam-recomendador.pages.dev`.

Como o frontend fica em domínio diferente do Worker (sem domínio próprio ainda), precisou de ajustes cross-origin no backend: cookie de sessão mudou de `SameSite=Lax` para `SameSite=None`, CORS libera `FRONTEND_URL` (variável nova no `wrangler.toml`, separada de `PUBLIC_BASE_URL` que continua sendo a URL do próprio Worker usada no OpenID), e o callback de login redireciona para `FRONTEND_URL/dashboard.html`. CORS testado via curl (preflight OK, `Access-Control-Allow-Origin` e `Allow-Credentials` corretos) — falta só o teste real no navegador (login completo + cookie cross-site aceito), que só dá pra confirmar com um usuário de verdade.

Workflow `deploy-frontend.yml` cria o projeto Pages automaticamente se não existir e publica a cada push em `frontend/**`.

Redesenhado em 22/08/2026 com direção visual do usuário: paleta bright-green-web (schemecolor.com), fonte Lora, botões sem cantos arredondados (sem sombra -- hover é transição suave de cor), caixa central max-width 1400px centralizada horizontalmente em telas grandes (sem cap de altura -- página rola inteira normal, sem scroll interno), modo escuro padrão com alternância via Alt esquerdo+Shift+D. Ajustes de UX depois de várias rodadas de teste visual real: hero da landing centraliza verticalmente, login da Steam abre em popup (`frontend/auth-callback.html` fecha o popup via `postMessage`, Worker redireciona o callback pra lá), biblioteca paginada (20/página, coluna de tempo centralizada, formato `horas:minutos`), assets com cache-busting automático (`?v=<hash do commit>`, injetado pelo workflow) pra nunca mais depender de hard-refresh manual, parágrafo de aviso de privacidade removido da landing a pedido do usuário.

**Lições dessa rodada (guardar pra próximas telas):**
- CSS shorthand `margin: 0 auto Npx` zera `margin-top` mesmo que outra regra mais específica tente setá-lo depois -- cuidado com especificidade ao combinar seletores de elemento (`.landing-hero p`) com seletores de classe (`.aviso-privacidade`) no mesmo elemento.
- Antes de assumir bug de cache do navegador, confirmar via `curl` direto no arquivo publicado (sem cache) que o conteúdo já está certo -- fizemos isso e realmente estava certo, mas a causa raiz nunca foi 100% confirmada (o cache-busting automático elimina a dúvida daqui pra frente, então não precisa mais investigar esse tipo de sintoma).
- Cap de altura + scroll interno na caixa (achando que resolvia "caixa vazia gigante em monitor grande") criou um problema pior (scrollbar feia, proporção esquisita) -- revertido. Only a WIDTH cap, sem cap de altura.

## Próximas fases

Fase 4 (extensão de navegador), Fase 6 (termos de uso — checkpoint humano), Fase 7 (deploy e testes end-to-end), Fase 8 (publicação nas lojas — checkpoint humano) ainda não iniciadas.

## Próximo passo imediato

Fase 3 estável (login popup + dashboard testados visualmente pelo usuário em várias rodadas, sem pendência aberta de UI). Duas frentes possíveis a partir daqui, não dependem uma da outra:

1. **Fase 4 — Extensão de navegador** (Manifest V3): mostra o score de compatibilidade (`GET /score/:appId`) ao visitar página de jogo na Steam/SteamDB, com as cores definidas no plano (verde 80%+, amarelo 50-79%, neutro 30-49%, vermelho <30% -- já usadas no dashboard). Precisa do token de API por usuário pra autenticar a extensão (endpoint de autorização ainda não existe no backend, ver `docs/plano-recomendador-steam.md` seção "Fluxo da extensão").
2. **Dado real pro motor de recomendação**: sincronizar um segundo usuário Steam pra sair do caso trivial (catálogo == biblioteca de 1 pessoa só, 0 recomendações). Não bloqueia a Fase 4, mas sem isso a extensão sempre vai mostrar o fallback de heurística, nunca o score pré-calculado de verdade.
