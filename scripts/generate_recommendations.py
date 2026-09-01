"""
Fase 2 — motor de recomendação em lote.

Calcula um score de compatibilidade (0-100) por par (usuário, jogo) e grava
na tabela `recommendations`, que é o que os endpoints /recommendations e
/score/:app_id leem depois. Não precisa rodar em tempo real -- pensado para
rodar periodicamente (ex: diariamente) via GitHub Actions.

Abordagem (baseada em conteúdo, por múltiplos gêneros/tags):
  1. Para cada usuário, calcula a "afinidade por gênero" combinando tempo
     jogado e feedback explícito -- igual antes, mas agora por TAG
     (game_catalog.tags, a lista completa de gêneros que a Steam retorna),
     não só o gênero primário. Um jogo com 3 tags contribui seu tempo
     jogado inteiro pras 3 -- um MMORPG de 500h é evidência forte de
     afinidade por RPG *e* por MMO, não uma evidência fraca dividida em 3.
  2. Para cada jogo candidato, mistura a afinidade do usuário por TODAS as
     tags do jogo (não só uma): 60% do maior valor entre as tags (pra um
     jogo que bate forte no gênero favorito não ser diluído por outra tag
     sem dado) + 40% da média entre as tags (pra sobreposição em várias
     tags, ex. RPG+MMO, valer mais que bater só uma).
  3. Um pequeno ajuste de popularidade do jogo (log do tempo jogado
     agregado por todos os usuários) desempata jogos com o mesmo conjunto
     de tags, que antes ficavam sempre com score idêntico.
  4. Usuário com pouquíssimo dado (poucas horas, sem feedback) cai no
     fallback: popularidade geral por tag entre todos os usuários.

Isso não é sofisticado (não é collaborative filtering), mas é suficiente
para um primeiro modelo funcional e fácil de auditar/explicar.

Variáveis de ambiente esperadas:
  DATABASE_URL     -- connection string do Postgres (Neon)
  TOP_N_POR_USUARIO -- quantas recomendações gravar por usuário (default: 50)
"""

import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

TOP_N_POR_USUARIO = int(os.environ.get("TOP_N_POR_USUARIO", "50"))

# Peso relativo de cada sinal na afinidade por gênero/tag.
PESO_TEMPO_JOGADO = 1.0
PESO_FEEDBACK = 3.0  # feedback explícito é sinal mais confiável que tempo jogado

# Peso de cada componente ao misturar a afinidade do usuário pelas várias
# tags de um jogo candidato num único "score de conteúdo".
PESO_AFINIDADE_MAX = 0.6
PESO_AFINIDADE_MEDIA = 0.4

# Peso final: afinidade de gênero continua dominante, popularidade do jogo
# só desempata jogos com o mesmo conjunto de tags.
PESO_SCORE_CONTEUDO = 0.85
PESO_POPULARIDADE_JOGO = 0.15


def carregar_dados(conn):
    # Uma linha por (usuário, jogo, TAG) -- um jogo com várias tags aparece
    # uma vez por tag, com o tempo jogado inteiro em cada uma (ver docstring).
    biblioteca = pd.read_sql(
        """
        select gl.user_id, gl.app_id, gl.playtime_minutos, unnest(gc.tags) as genero
        from game_library gl
        join game_catalog gc on gc.app_id = gl.app_id
        where gc.tags is not null and array_length(gc.tags, 1) > 0
        """,
        conn,
    )

    feedback = pd.read_sql(
        """
        select f.user_id, unnest(gc.tags) as genero, coalesce(f.user_rating, f.predicted_score) as nota
        from feedback f
        join game_catalog gc on gc.app_id = f.app_id
        where gc.tags is not null and array_length(gc.tags, 1) > 0
        """,
        conn,
    )

    # Catálogo com a lista de tags inteira (não explodida) -- cada candidato
    # precisa das próprias tags pra calcular seu score de conteúdo.
    catalogo = pd.read_sql(
        "select app_id, tags from game_catalog where tags is not null and array_length(tags, 1) > 0",
        conn,
    )

    # Popularidade por JOGO (não por tag) -- soma o tempo jogado por todos os
    # usuários num único número por app_id, usado só como desempate.
    popularidade_jogos = pd.read_sql(
        "select app_id, sum(playtime_minutos) as minutos_totais from game_library group by app_id",
        conn,
    )

    usuarios = pd.read_sql("select id as user_id from users where deleted_at is null", conn)

    return biblioteca, feedback, catalogo, popularidade_jogos, usuarios


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
    """Fallback para usuários sem dado suficiente: popularidade por gênero/tag entre todos."""
    pop = biblioteca.groupby("genero")["playtime_minutos"].sum().reset_index()
    pop["popularidade"] = 100 * pop["playtime_minutos"] / pop["playtime_minutos"].max()
    return pop[["genero", "popularidade"]]


def calcular_popularidade_por_jogo(popularidade_jogos):
    """[app_id, minutos_totais] -> [app_id, popularidade_jogo] 0-100,
    log-escalado pra um outlier de playtime não achatar todo o resto."""
    df = popularidade_jogos.copy()
    df["log_minutos"] = np.log1p(df["minutos_totais"])
    maximo = df["log_minutos"].max()
    df["popularidade_jogo"] = 100 * df["log_minutos"] / maximo if maximo > 0 else 0
    return df[["app_id", "popularidade_jogo"]]


def calcular_score_conteudo(candidatos, afinidade_por_genero, coluna_sinal):
    """candidatos: [app_id, tags]. afinidade_por_genero: [genero, coluna_sinal].
    Mistura, por jogo, o máximo e a média da afinidade do usuário entre TODAS
    as tags do jogo -- serve tanto pra afinidade pessoal quanto pro fallback
    de popularidade global (mesma função, coluna de sinal diferente).
    Retorna [app_id, score_conteudo, genero_motivo] (genero_motivo = a tag
    que mais contribuiu, pra explicar a recomendação ao usuário)."""
    explodido = candidatos[["app_id", "tags"]].explode("tags").rename(columns={"tags": "genero"})
    explodido = explodido.merge(afinidade_por_genero, on="genero", how="left").fillna(0)

    agregado = explodido.groupby("app_id")[coluna_sinal].agg(["max", "mean"]).reset_index()
    agregado["score_conteudo"] = (
        PESO_AFINIDADE_MAX * agregado["max"] + PESO_AFINIDADE_MEDIA * agregado["mean"]
    )

    motivo = (
        explodido.loc[explodido.groupby("app_id")[coluna_sinal].idxmax()]
        [["app_id", "genero"]]
        .rename(columns={"genero": "genero_motivo"})
    )

    return agregado[["app_id", "score_conteudo"]].merge(motivo, on="app_id", how="left")


def gerar_recomendacoes(biblioteca, feedback, catalogo, popularidade_jogos, usuarios, top_n):
    afinidade = calcular_afinidade_por_genero(biblioteca, feedback)
    popularidade_global = calcular_popularidade_global_por_genero(biblioteca)
    popularidade_por_jogo = calcular_popularidade_por_jogo(popularidade_jogos)

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
            score_conteudo = calcular_score_conteudo(candidatos, afinidade_usuario, "afinidade")
        else:
            score_conteudo = calcular_score_conteudo(candidatos, popularidade_global, "popularidade")

        candidatos = candidatos.merge(score_conteudo, on="app_id", how="left")
        candidatos = candidatos.merge(popularidade_por_jogo, on="app_id", how="left")
        candidatos[["score_conteudo", "popularidade_jogo"]] = candidatos[
            ["score_conteudo", "popularidade_jogo"]
        ].fillna(0)

        candidatos["score"] = (
            PESO_SCORE_CONTEUDO * candidatos["score_conteudo"].astype(float)
            + PESO_POPULARIDADE_JOGO * candidatos["popularidade_jogo"].astype(float)
        ).clip(0, 100)

        top = candidatos.nlargest(top_n, "score")[["app_id", "score", "genero_motivo"]]
        top["user_id"] = user_id
        linhas_finais.append(top)

    if not linhas_finais:
        return pd.DataFrame(columns=["user_id", "app_id", "score", "genero_motivo"])

    return pd.concat(linhas_finais, ignore_index=True)[["user_id", "app_id", "score", "genero_motivo"]]


def gravar_recomendacoes(conn, recomendacoes):
    if recomendacoes.empty:
        return

    agora = datetime.now(timezone.utc)
    valores = [
        (int(linha.user_id), int(linha.app_id), round(float(linha.score), 2), linha.genero_motivo, agora)
        for linha in recomendacoes.itertuples(index=False)
    ]

    with conn.cursor() as cur:
        # Grava em lote (execute_values) em vez de um INSERT por linha: com
        # TOP_N_POR_USUARIO x número de usuários, um INSERT por linha vira
        # milhares de idas sequenciais ao Neon pela rede a partir do runner do
        # GitHub Actions -- mesmo problema resolvido no /me/sync do Worker.
        execute_values(
            cur,
            """
            insert into recommendations (user_id, app_id, score, genero_motivo, generated_at)
            values %s
            on conflict (user_id, app_id) do update
                set score = excluded.score,
                    genero_motivo = excluded.genero_motivo,
                    generated_at = excluded.generated_at
            """,
            valores,
        )

        # Remove recomendações antigas que saíram do top-N desta rodada --
        # sem isso, um jogo que cai do top-50 de alguém fica pra sempre com
        # um score de uma rodada (ou fórmula) anterior, potencialmente
        # ultrapassando os scores novos se a escala mudar. Só limpa usuários
        # processados nesta execução (quem foi pulado por candidatos vazios
        # mantém as recomendações antigas, corretamente).
        usuarios_processados = recomendacoes["user_id"].unique().tolist()
        cur.execute(
            "delete from recommendations where user_id = any(%s) and generated_at < %s",
            (usuarios_processados, agora),
        )
    conn.commit()


def main():
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(database_url)
    try:
        biblioteca, feedback, catalogo, popularidade_jogos, usuarios = carregar_dados(conn)
        recomendacoes = gerar_recomendacoes(
            biblioteca, feedback, catalogo, popularidade_jogos, usuarios, TOP_N_POR_USUARIO
        )
        gravar_recomendacoes(conn, recomendacoes)
    finally:
        conn.close()

    print(f"[recommend] {len(recomendacoes)} recomendações gravadas para {usuarios_unicos(recomendacoes)} usuário(s)")


def usuarios_unicos(recomendacoes):
    return recomendacoes["user_id"].nunique() if not recomendacoes.empty else 0


if __name__ == "__main__":
    main()
