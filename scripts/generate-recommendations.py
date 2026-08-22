"""
Fase 2 — motor de recomendação em lote.

Calcula um score de compatibilidade (0-100) por par (usuário, jogo) e grava
na tabela `recommendations`, que é o que os endpoints /recommendations e
/score/:app_id leem depois. Não precisa rodar em tempo real -- pensado para
rodar periodicamente (ex: diariamente) via GitHub Actions.

Abordagem (baseada em conteúdo, por gênero):
  1. Para cada usuário, calcula a "afinidade por gênero" combinando:
       - tempo jogado (biblioteca): gêneros onde ele jogou mais horas pesam mais
       - feedback explícito (nota 0-100 quando ele corrigiu o score): pesa mais
         que tempo jogado, porque é sinal direto e sem ruído
  2. Para cada jogo do catálogo que o usuário ainda não tem na biblioteca,
     calcula o score como a afinidade do usuário pelo gênero daquele jogo,
     com um pequeno ajuste de popularidade global para evitar recomendar só
     nichos muito pequenos.
  3. Usuário com pouquíssimo dado (poucas horas, sem feedback) cai no
     fallback: popularidade geral por gênero entre todos os usuários.

Isso não é sofisticado (não é collaborative filtering), mas é suficiente
para um primeiro modelo funcional e fácil de auditar/explicar.

Variáveis de ambiente esperadas:
  DATABASE_URL     -- connection string do Postgres (Neon)
  TOP_N_POR_USUARIO -- quantas recomendações gravar por usuário (default: 50)
"""

import os
from datetime import datetime, timezone

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

TOP_N_POR_USUARIO = int(os.environ.get("TOP_N_POR_USUARIO", "50"))

# Peso relativo de cada sinal na afinidade por gênero.
PESO_TEMPO_JOGADO = 1.0
PESO_FEEDBACK = 3.0  # feedback explícito é sinal mais confiável que tempo jogado


def carregar_dados(conn):
    biblioteca = pd.read_sql(
        """
        select gl.user_id, gc.genero, gl.playtime_minutos, gl.app_id
        from game_library gl
        join game_catalog gc on gc.app_id = gl.app_id
        where gc.genero is not null
        """,
        conn,
    )

    feedback = pd.read_sql(
        """
        select f.user_id, gc.genero, coalesce(f.user_rating, f.predicted_score) as nota
        from feedback f
        join game_catalog gc on gc.app_id = f.app_id
        where gc.genero is not null
        """,
        conn,
    )

    catalogo = pd.read_sql("select app_id, genero from game_catalog where genero is not null", conn)

    usuarios = pd.read_sql("select id as user_id from users where deleted_at is null", conn)

    return biblioteca, feedback, catalogo, usuarios


def calcular_afinidade_por_genero(biblioteca, feedback):
    """Retorna DataFrame [user_id, genero, afinidade] normalizado 0-100 por usuário."""

    tempo_por_genero = (
        biblioteca.groupby(["user_id", "genero"])["playtime_minutos"].sum().reset_index()
    )
    tempo_por_genero["sinal_tempo"] = tempo_por_genero["playtime_minutos"] * PESO_TEMPO_JOGADO

    feedback_por_genero = feedback.groupby(["user_id", "genero"])["nota"].mean().reset_index()
    feedback_por_genero["sinal_feedback"] = feedback_por_genero["nota"] * PESO_FEEDBACK

    combinado = pd.merge(
        tempo_por_genero[["user_id", "genero", "sinal_tempo"]],
        feedback_por_genero[["user_id", "genero", "sinal_feedback"]],
        on=["user_id", "genero"],
        how="outer",
    ).fillna(0)

    combinado["sinal_bruto"] = combinado["sinal_tempo"] + combinado["sinal_feedback"]

    # Normaliza para 0-100 dentro de cada usuário, para o score final ficar
    # comparável entre usuários diferentes.
    combinado["afinidade"] = combinado.groupby("user_id")["sinal_bruto"].transform(
        lambda s: 100 * s / s.max() if s.max() > 0 else 0
    )

    return combinado[["user_id", "genero", "afinidade"]]


def calcular_popularidade_global_por_genero(biblioteca):
    """Fallback para usuários sem dado suficiente: popularidade por gênero entre todos."""
    pop = biblioteca.groupby("genero")["playtime_minutos"].sum().reset_index()
    pop["popularidade"] = 100 * pop["playtime_minutos"] / pop["playtime_minutos"].max()
    return pop[["genero", "popularidade"]]


def gerar_recomendacoes(biblioteca, feedback, catalogo, usuarios, top_n):
    afinidade = calcular_afinidade_por_genero(biblioteca, feedback)
    popularidade_global = calcular_popularidade_global_por_genero(biblioteca)

    jogos_por_usuario = biblioteca.groupby("user_id")["app_id"].apply(set).to_dict()

    linhas_finais = []

    for user_id in usuarios["user_id"]:
        possui = jogos_por_usuario.get(user_id, set())
        candidatos = catalogo[~catalogo["app_id"].isin(possui)].copy()

        # Sem candidato (ex: usuário já possui todo o catálogo conhecido) --
        # nada a recomendar ainda, não é erro.
        if candidatos.empty:
            continue

        afinidade_usuario = afinidade[afinidade["user_id"] == user_id][["genero", "afinidade"]]
        tem_dado_suficiente = not afinidade_usuario.empty

        if tem_dado_suficiente:
            candidatos = candidatos.merge(afinidade_usuario, on="genero", how="left")
            candidatos["score"] = candidatos["afinidade"].fillna(0)
        else:
            candidatos = candidatos.merge(popularidade_global, on="genero", how="left")
            candidatos["score"] = candidatos["popularidade"].fillna(0)

        candidatos["score"] = candidatos["score"].astype(float)
        top = candidatos.nlargest(top_n, "score")[["app_id", "score"]]
        top["user_id"] = user_id
        linhas_finais.append(top)

    if not linhas_finais:
        return pd.DataFrame(columns=["user_id", "app_id", "score"])

    return pd.concat(linhas_finais, ignore_index=True)[["user_id", "app_id", "score"]]


def gravar_recomendacoes(conn, recomendacoes):
    if recomendacoes.empty:
        return

    agora = datetime.now(timezone.utc)
    valores = [
        (int(linha.user_id), int(linha.app_id), round(float(linha.score), 2), agora)
        for linha in recomendacoes.itertuples(index=False)
    ]

    # Grava em lote (execute_values) em vez de um INSERT por linha: com
    # TOP_N_POR_USUARIO x número de usuários, um INSERT por linha vira
    # milhares de idas sequenciais ao Neon pela rede a partir do runner do
    # GitHub Actions -- mesmo problema resolvido no /me/sync do Worker.
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into recommendations (user_id, app_id, score, generated_at)
            values %s
            on conflict (user_id, app_id) do update
                set score = excluded.score, generated_at = excluded.generated_at
            """,
            valores,
        )
    conn.commit()


def main():
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(database_url)
    try:
        biblioteca, feedback, catalogo, usuarios = carregar_dados(conn)
        recomendacoes = gerar_recomendacoes(biblioteca, feedback, catalogo, usuarios, TOP_N_POR_USUARIO)
        gravar_recomendacoes(conn, recomendacoes)
    finally:
        conn.close()

    print(f"[recommend] {len(recomendacoes)} recomendações gravadas para {usuarios_unicos(recomendacoes)} usuário(s)")


def usuarios_unicos(recomendacoes):
    return recomendacoes["user_id"].nunique() if not recomendacoes.empty else 0


if __name__ == "__main__":
    main()