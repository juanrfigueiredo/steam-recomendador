# Recomendador de Jogos Steam — Plano e Arquitetura Técnica

Última atualização: 21/08/2026

## Visão geral do produto

Serviço gratuito de recomendação de jogos que usa dados da conta Steam do usuário (via login oficial) para gerar recomendações. Extensão de navegador opcional mostra um score de compatibilidade ao visitar página de jogo na Steam/SteamDB, sem registrar histórico de navegação. Foco principal de desenvolvimento é a venda de estatística agregada e anonimizada de preferências declaradas pelos usuários, distribuída via AWS Data Exchange, Datarade e Dewey Data.

## Decisões de produto

Login via Steam OpenID. Leitura de biblioteca, horas jogadas, conquistas e wishlist via Steam Web API. Extensão mostra score de compatibilidade (não precisa ser em tempo real, pode ser pré-calculado em lote): verde 80%+, amarelo 50-79%, neutro 30-49%, vermelho abaixo de 30%. Usuário confirma ou corrige o score, e se corrigir dá uma nota de 0 a 100, dado que também alimenta a base de preferências declaradas. Monetização principal é venda de estatística agregada e anonimizada dessas preferências; afiliados é secundário; sem assinatura premium. Consentimento comercial é opt-in separado, desmarcado por padrão, desacoplado do uso do serviço principal. Usuário pode exportar e deletar seus dados, prazo de exclusão até 30 dias.

## Arquitetura técnica (hospedagem gratuita)

### Componentes

**Frontend (cadastro, dashboard, tela de consentimento)**: site estático hospedado no Cloudflare Pages, gratuito.

**Backend/API**: Cloudflare Workers. Gratuito até 100 mil requisições/dia, sem cold start. Limite de 10ms de CPU por invocação, por isso a lógica pesada (cálculo de recomendação) roda em lote fora do Worker, não a cada requisição.

**Banco de dados**: Neon Postgres, plano gratuito, compatível com driver HTTP que funciona nativamente dentro de Cloudflare Workers.

**Extensão de navegador**: Manifest V3, JavaScript, publicada na Chrome Web Store e Firefox Add-ons. Sem custo de hospedagem, roda no navegador do usuário.

**Job de agregação e anonimização**: GitHub Actions com execução agendada (cron). Roda em Python com pandas, fora do limite de CPU do Worker. Minutos gratuitos cobrem uso nessa escala. Gera um único arquivo agregado (CSV/Parquet), reaproveitado nos três canais de venda.

### Integrações de venda de dados

O mesmo dataset agregado e anonimizado alimenta os três canais, cada um com mecanismo de entrega próprio:

**AWS Data Exchange**: exige bucket S3 como origem técnica. O job de agregação publica o arquivo no S3 e cria uma nova revision a cada atualização. Custo de poucos centavos por mês, só a partir do primeiro export.

**Datarade**: marketplace de intermediação (vitrine comercial), não hospeda o dado. Cadastro via Provider Studio (candidatura, aprovação em 1-2 dias úteis). Você mantém propriedade e escolhe o método de entrega ao comprador, ex: link de download gerado a partir do mesmo arquivo do S3, ou endpoint próprio no Cloudflare Workers. Sem custo de infraestrutura própria.

**Dewey Data**: diferente do Datarade, a Dewey hospeda e distribui o dado para os compradores (usuários acadêmicos e comerciais verificados). Processo de parceria via formulário de candidatura no site deles; o método técnico exato de envio do dataset (upload, SFTP, ou API) não é detalhado publicamente e precisa ser confirmado diretamente com a equipe de parcerias da Dewey no momento da integração. Fonte: [Dewey Data — Become a data partner](https://docs.deweydata.io/docs/become-a-data-partner).

Recomendação: implementar primeiro AWS Data Exchange e Datarade (processo claro e documentado), e tratar a integração com Dewey Data como etapa separada, iniciada por contato direto com o time deles para confirmar o mecanismo de entrega antes de automatizar.

Status: código do job de agregação e das integrações com AWS Data Exchange e Datarade já implementado e entregue (`aggregate_preferences.py`, `publish_aws_data_exchange.py`, `publish_datarade.py`, workflow `publish-datasets.yml`).

### Fluxo da extensão

1. Usuário faz login uma vez no site (Steam OpenID) e autoriza a extensão, que recebe um token de API armazenado localmente no navegador.
2. Ao visitar página de jogo na Steam/SteamDB, o content script extrai o app_id.
3. Extensão consulta `GET /score/:app_id` no Worker.
4. Worker busca o score na tabela `recommendations` (pré-calculada em lote). Se o jogo ainda não tem score calculado, aplica uma heurística rápida de fallback. A consulta não é registrada de forma persistente vinculada ao usuário, só cache efêmero com TTL curto para performance.
5. Extensão mostra a cor correspondente.
6. Usuário pode abrir a extensão, confirmar ou corrigir o score, e enviar `POST /feedback`.

### Endpoints principais

`GET /auth/steam/login` e `GET /auth/steam/callback` — autenticação via Steam OpenID, emissão de sessão (JWT).

`GET /me`, `GET /me/library`, `POST /me/sync` — perfil e sincronização de biblioteca.

`GET /recommendations` — lista de jogos recomendados para o usuário.

`GET /score/:app_id` — score de compatibilidade usado pela extensão.

`POST /feedback` — confirmação ou correção de score, com nota de 0 a 100 quando aplicável.

`GET /me/consent`, `POST /me/consent` — leitura e atualização do consentimento comercial (opt-in separado).

`GET /me/export` — exportação estruturada (JSON) de todos os dados do usuário.

`POST /me/delete` — solicitação de exclusão, com prazo de até 30 dias.

### Modelo de dados (Postgres)

`users`: id, steam_id, display_name, avatar_url, created_at, consent_commercial (bool), consent_commercial_at, deleted_at, is_admin (bool).

`game_library`: user_id, app_id, playtime_minutos, last_synced_at.

`game_catalog`: app_id, nome, gêneros, tags (cache da Steam Store API).

`recommendations`: user_id, app_id, score, generated_at (recalculado em lote).

`feedback`: id, user_id, app_id, predicted_score, confirmed (bool), user_rating (0-100, nullable), created_at.

`consent_log`: user_id, tipo de consentimento, concedido (bool), timestamp — auditoria de cada mudança de consentimento.

`deletion_requests`: user_id, requested_at, scheduled_purge_at, completed_at.

### Pipeline de agregação e anonimização (GitHub Actions)

1. Consulta `feedback` apenas de usuários com `consent_commercial = true`, agrupando por gênero/tag e por semana.
2. Aplica k-anonimato: descarta qualquer grupo com menos de k usuários (ex: k=5).
3. Remove qualquer identificador direto ou indireto (sem user_id, sem timestamp mais fino que semana, sem IP, que nunca é coletado).
4. Gera arquivo agregado (CSV/Parquet).
5. Publica no S3 (AWS Data Exchange) e disponibiliza o mesmo arquivo para entrega via Datarade e Dewey Data.

Dado bruto identificável nunca sai do banco Neon, só o resultado agregado chega aos marketplaces.

### Exclusão de dados

`POST /me/delete` marca `deleted_at` e cria registro em `deletion_requests`. Job agendado purga definitivamente após 30 dias: remove linhas de `users`, `game_library`, `feedback` vinculadas a essa conta. Dado já agregado e publicado nos marketplaces antes da exclusão não é removido retroativamente, por já estar anonimizado (k-anonimato) e não ser mais dado pessoal.

### Painel de desenvolvedor/admin

Acesso restrito à equipe (não é o login de usuário comum), para ver relatórios de uso.

**Autenticação**: conta de admin separada, com flag `is_admin` na tabela `users` (setada manualmente no banco, sem cadastro público). Rotas `/admin/*` no Worker verificam essa flag antes de responder.

**Relatórios de uso**: `GET /admin/reports`, consulta agregada no Postgres, sem expor dado individual de usuário. Cobre: total de usuários cadastrados, crescimento por semana, taxa de opt-in do consentimento comercial, volume de feedback recebido, histórico de exports publicados nos marketplaces.

### Custo estimado

Cloudflare Pages, Cloudflare Workers, Neon Postgres e GitHub Actions: R$ 0 na escala inicial. AWS S3: poucos centavos por mês, só a partir do primeiro export para o AWS Data Exchange. Datarade e Dewey Data: sem custo de infraestrutura própria, é cadastro como provedor/parceiro. Chrome Web Store: taxa única de cadastro de desenvolvedor (~US$ 5), sem custo recorrente. Firefox Add-ons: gratuito.

## O que a Claude pode e não pode fazer neste projeto

### Sem precisar de interrupção

Escrever todo o código: backend, frontend, extensão de navegador, migrations do banco, motor de recomendação, scripts de agregação/publicação (já entregues), testes automatizados, workflows de CI/CD, e rascunho de termos de uso e política de privacidade alinhado ao que foi definido sobre consentimento e LGPD.

### Sempre exige o usuário

Criar contas (GitHub, Cloudflare, Neon, AWS com billing configurado, chave de API da Steam, conta de desenvolvedor na Chrome Web Store, cadastro no Datarade Provider Studio, contato com a Dewey Data). Todas exigem identidade real, e-mail verificado, muitas exigem cartão de crédito ou CPF/CNPJ.

Gerar e entregar os segredos dessas contas (tokens com escopo limitado, nunca senha), normalmente como secrets de repositório.

Publicar a extensão nas lojas — passa por revisão humana da própria loja e confirmação de quem é dono da conta de desenvolvedor.

Aprovar os termos de uso finais — a Claude redige o rascunho, mas a responsabilidade legal é do usuário ou de advogado contratado por ele. Dado o histórico de risco discutido neste plano (rastreamento, venda de dados), recomenda-se revisão jurídica antes de publicar.

Qualquer decisão que gere custo real (ex: sair do free tier).

### Pré-requisitos para execução com menos interrupção

1. Repositório Git criado pelo usuário, com a Claude tendo acesso de escrita.
2. Contas criadas nos serviços listados acima.
3. Segredos configurados como GitHub Actions secrets.
4. Decisão do usuário sobre os termos de uso (aprovar o rascunho da Claude ou mandar para revisão jurídica) antes de implementar o fluxo de consentimento em produção.

### Plano de execução em fases

**Fase 0 — Setup** (usuário faz, Claude orienta): contas, repositório, secrets.

**Fase 1 — Backend core**: autenticação Steam OpenID, endpoints principais, banco de dados e migrations. Pode ser feita integralmente pela Claude assim que `DATABASE_URL` existir.

**Fase 2 — Motor de recomendação em lote** e endpoint `/score`.

**Fase 3 — Frontend**: cadastro, dashboard, tela de consentimento.

**Fase 4 — Extensão de navegador**.

**Fase 5 — Pipeline de agregação e integrações de venda** (AWS Data Exchange e Datarade já entregues nesta fase).

**Fase 6 — Termos de uso e política de privacidade**: rascunho pela Claude, checkpoint humano obrigatório antes de publicar.

**Fase 7 — Deploy e testes end-to-end**.

**Fase 8 — Publicação nas lojas/marketplaces**: checkpoint humano obrigatório (aprovação final e ação de submissão).

Em cada fase, a Claude pode avançar automaticamente, exceto nos pontos marcados como checkpoint humano.

## Dúvidas em aberto

(a preencher conforme a conversa avança)
