-- Schema inicial do banco (Fase 1)
-- Reflete o modelo de dados definido no plano do projeto.

create table if not exists users (
    id                    bigserial primary key,
    steam_id              text unique not null,
    display_name          text,
    avatar_url            text,
    created_at            timestamptz not null default now(),
    consent_commercial    boolean not null default false,
    consent_commercial_at timestamptz,
    deleted_at            timestamptz,
    is_admin              boolean not null default false
);

create table if not exists game_catalog (
    app_id  bigint primary key,
    nome    text not null,
    genero  text,
    tags    text[]
);

create table if not exists game_library (
    user_id         bigint not null references users(id) on delete cascade,
    app_id          bigint not null references game_catalog(app_id),
    playtime_minutos integer not null default 0,
    last_synced_at  timestamptz not null default now(),
    primary key (user_id, app_id)
);

create table if not exists recommendations (
    user_id      bigint not null references users(id) on delete cascade,
    app_id       bigint not null references game_catalog(app_id),
    score        numeric(5,2) not null,
    generated_at timestamptz not null default now(),
    primary key (user_id, app_id)
);

create table if not exists feedback (
    id               bigserial primary key,
    user_id          bigint not null references users(id) on delete cascade,
    app_id           bigint not null references game_catalog(app_id),
    predicted_score  numeric(5,2) not null,
    confirmed        boolean not null,
    user_rating      integer check (user_rating between 0 and 100),
    created_at       timestamptz not null default now()
);

create table if not exists consent_log (
    id           bigserial primary key,
    user_id      bigint not null references users(id) on delete cascade,
    tipo         text not null,
    concedido    boolean not null,
    created_at   timestamptz not null default now()
);

create table if not exists deletion_requests (
    id                 bigserial primary key,
    user_id            bigint not null references users(id) on delete cascade,
    requested_at       timestamptz not null default now(),
    scheduled_purge_at timestamptz not null,
    completed_at       timestamptz
);

create index if not exists idx_feedback_user_id on feedback(user_id);
create index if not exists idx_feedback_created_at on feedback(created_at);
create index if not exists idx_recommendations_user_id on recommendations(user_id);

-- Fase de reformulação do motor de recomendação: imagem/preço/desconto (pra
-- exibição na UI) e controle de tentativas de enriquecimento (evita re-tentar
-- pra sempre um jogo sem gênero disponível na Steam).
alter table game_catalog add column if not exists imagem_url text;
alter table game_catalog add column if not exists preco_moeda text;
alter table game_catalog add column if not exists preco_inicial_centavos integer;
alter table game_catalog add column if not exists preco_final_centavos integer;
alter table game_catalog add column if not exists desconto_percentual smallint;
alter table game_catalog add column if not exists gratuito boolean;
alter table game_catalog add column if not exists preco_atualizado_em timestamptz;
alter table game_catalog add column if not exists tentativas_enriquecimento smallint not null default 0;

-- Gênero que mais contribuiu pro score, pra explicar a recomendação ao usuário.
alter table recommendations add column if not exists genero_motivo text;

create index if not exists idx_game_catalog_preco_atualizado_em on game_catalog(preco_atualizado_em);
