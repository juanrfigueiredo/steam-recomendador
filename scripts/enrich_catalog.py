"""
Enriquece `game_catalog` com gênero e tags via Steam Store API.

O motor de recomendação (generate-recommendations.py) é baseado em gênero,
mas `/me/sync` só grava app_id e nome -- o gênero nunca era preenchido em
lugar nenhum. Este script fecha essa lacuna: busca, para cada jogo do
catálogo ainda sem gênero, os dados na Steam Store API (endpoint público
appdetails) e grava gênero primário + lista de gêneros como tags.

Pensado para rodar antes de generate-recommendations.py no mesmo workflow
diário -- roda só sobre o que estiver pendente, não refaz todos os jogos
toda vez.

Variáveis de ambiente esperadas:
  DATABASE_URL           -- connection string do Postgres (Neon)
  ENRICH_DELAY_SECONDS    -- intervalo entre chamadas à Steam Store API,
                              que não documenta um limite oficial de taxa
                              (default: 1.2)
  ENRICH_MAX_APPS         -- teto de jogos processados por execução, para
                              manter o tempo de execução previsível
                              (default: 300)
"""

import os
import time

import psycopg2
import requests
from psycopg2.extras import execute_values

STEAM_APPDETAILS_URL = "https://store.steampowered.com/api/appdetails"


def buscar_app_ids_pendentes(conn, limite):
    with conn.cursor() as cur:
        cur.execute("select app_id from game_catalog where genero is null order by app_id limit %s", (limite,))
        return [row[0] for row in cur.fetchall()]


def buscar_genero_e_tags(app_id, session):
    """Retorna (genero_primario, tags) ou None se o jogo não tiver gênero
    classificado na Steam Store (delisted, bloqueio regional, etc.) ou se a
    chamada falhar -- em ambos os casos fica pendente para a próxima execução."""
    try:
        resp = session.get(
            STEAM_APPDETAILS_URL,
            params={"appids": app_id, "cc": "BR", "l": "portuguese"},
            timeout=10,
        )
        resp.raise_for_status()
        entrada = resp.json().get(str(app_id))
    except (requests.RequestException, ValueError):
        return None

    if not entrada or not entrada.get("success"):
        return None

    generos = entrada.get("data", {}).get("genres", [])
    nomes = [g["description"] for g in generos if g.get("description")]
    if not nomes:
        return None

    return nomes[0], nomes


def gravar_generos(conn, atualizacoes):
    if not atualizacoes:
        return
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            update game_catalog as gc
            set genero = dados.genero, tags = dados.tags
            from (values %s) as dados(app_id, genero, tags)
            where gc.app_id = dados.app_id
            """,
            atualizacoes,
            template="(%s, %s, %s::text[])",
        )
    conn.commit()


def main():
    database_url = os.environ["DATABASE_URL"]
    delay = float(os.environ.get("ENRICH_DELAY_SECONDS", "1.2"))
    limite = int(os.environ.get("ENRICH_MAX_APPS", "300"))

    conn = psycopg2.connect(database_url)
    try:
        pendentes = buscar_app_ids_pendentes(conn, limite)
        if not pendentes:
            print("[enrich] nenhum jogo pendente de gênero")
            return

        session = requests.Session()
        atualizacoes = []
        sem_genero = 0

        for i, app_id in enumerate(pendentes):
            resultado = buscar_genero_e_tags(app_id, session)
            if resultado:
                genero, tags = resultado
                atualizacoes.append((app_id, genero, tags))
            else:
                sem_genero += 1
            if i < len(pendentes) - 1:
                time.sleep(delay)

        gravar_generos(conn, atualizacoes)
        print(f"[enrich] {len(atualizacoes)} jogo(s) atualizado(s), {sem_genero} sem gênero disponível (ficam pendentes)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
