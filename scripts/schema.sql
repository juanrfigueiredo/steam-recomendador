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
