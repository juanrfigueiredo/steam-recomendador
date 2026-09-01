"""
Enriquece `game_catalog` com dados da Steam Store API (endpoint público
appdetails): gêneros/tags, imagem e preço/desconto.

O motor de recomendação é baseado em gênero/tags, mas `/me/sync` só grava
app_id e nome -- este script fecha essa lacuna. Uma mesma chamada a
appdetails já retorna gêneros, imagem e preço juntos, mas eles têm
cadência de mudança bem diferente: gênero praticamente nunca muda (enriquecer
uma vez basta), preço muda todo dia (promoções). Por isso o script roda em
dois modos:

  ENRICH_MODO=pendentes (default) -- jogos que ainda não têm gênero/tags,
    ou que falharam menos de 5 vezes. Cada jogo só é reprocessado até parar
    de falhar ou atingir o limite de tentativas.
  ENRICH_MODO=preco -- todo o catálogo já classificado, dos preços mais
    desatualizados pros mais recentes (cursor rotativo), pra manter os
    selos de promoção corretos.

Pensado pra rodar antes de generate_recommendations.py no mesmo workflow
diário.

Variáveis de ambiente esperadas:
  DATABASE_URL           -- connection string do Postgres (Neon)
  ENRICH_MODO             -- "pendentes" (default) ou "preco"
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
MAX_TENTATIVAS = 5


def buscar_app_ids_pendentes(conn, limite):
    with conn.cursor() as cur:
        cur.execute(
            "select app_id from game_catalog "
            "where tags is null and tentativas_enriquecimento < %s "
            "order by app_id limit %s",
            (MAX_TENTATIVAS, limite),
        )
        return [row[0] for row in cur.fetchall()]


def buscar_app_ids_para_atualizar_preco(conn, limite):
    with conn.cursor() as cur:
        cur.execute(
            "select app_id from game_catalog "
            "where tags is not null "
            "order by preco_atualizado_em asc nulls first limit %s",
            (limite,),
        )
        return [row[0] for row in cur.fetchall()]


def buscar_dados_loja(app_id, session):
    """Retorna um dict com genero/tags/imagem/preço, ou None se o jogo não
    tiver gênero classificado na Steam Store (delisted, bloqueio regional,
    etc.) ou se a chamada falhar -- em ambos os casos fica pendente para a
    próxima execução."""
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

    dados = entrada.get("data", {})
    generos = dados.get("genres", [])
    nomes = [g["description"] for g in generos if g.get("description")]
    if not nomes:
        return None

    preco = dados.get("price_overview")
    return {
        "genero": nomes[0],
        "tags": nomes,
        "imagem_url": dados.get("header_image"),
        "gratuito": dados.get("is_free"),
        "preco_moeda": preco["currency"] if preco else None,
        "preco_inicial_centavos": preco["initial"] if preco else None,
        "preco_final_centavos": preco["final"] if preco else None,
        "desconto_percentual": preco["discount_percent"] if preco else None,
    }


def gravar_dados_loja(conn, atualizacoes):
    if not atualizacoes:
        return
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            update game_catalog as gc
            set genero = dados.genero,
                tags = dados.tags,
                imagem_url = dados.imagem_url,
                gratuito = dados.gratuito,
                preco_moeda = dados.preco_moeda,
                preco_inicial_centavos = dados.preco_inicial_centavos,
                preco_final_centavos = dados.preco_final_centavos,
                desconto_percentual = dados.desconto_percentual,
                preco_atualizado_em = now()
            from (values %s) as dados(
                app_id, genero, tags, imagem_url, gratuito,
                preco_moeda, preco_inicial_centavos, preco_final_centavos, desconto_percentual
            )
            where gc.app_id = dados.app_id
            """,
            atualizacoes,
            template="(%s, %s, %s::text[], %s, %s, %s, %s, %s, %s)",
        )
    conn.commit()


def incrementar_tentativas(conn, app_ids):
    if not app_ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            "update game_catalog set tentativas_enriquecimento = tentativas_enriquecimento + 1 "
            "where app_id = any(%s)",
            (app_ids,),
        )
    conn.commit()


def processar(conn, app_ids, delay, modo):
    session = requests.Session()
    atualizacoes = []
    falhas = []

    for i, app_id in enumerate(app_ids):
        resultado = buscar_dados_loja(app_id, session)
        if resultado:
            atualizacoes.append(
                (
                    app_id,
                    resultado["genero"],
                    resultado["tags"],
                    resultado["imagem_url"],
                    resultado["gratuito"],
                    resultado["preco_moeda"],
                    resultado["preco_inicial_centavos"],
                    resultado["preco_final_centavos"],
                    resultado["desconto_percentual"],
                )
            )
        else:
            falhas.append(app_id)
        if i < len(app_ids) - 1:
            time.sleep(delay)

    gravar_dados_loja(conn, atualizacoes)
    if modo == "pendentes":
        incrementar_tentativas(conn, falhas)

    return len(atualizacoes), len(falhas)


def main():
    database_url = os.environ["DATABASE_URL"]
    modo = os.environ.get("ENRICH_MODO", "pendentes")
    delay = float(os.environ.get("ENRICH_DELAY_SECONDS", "1.2"))
    limite = int(os.environ.get("ENRICH_MAX_APPS", "300"))

    conn = psycopg2.connect(database_url)
    try:
        if modo == "preco":
            app_ids = buscar_app_ids_para_atualizar_preco(conn, limite)
            if not app_ids:
                print("[enrich] nenhum jogo classificado ainda para atualizar preço")
                return
            atualizados, falhas = processar(conn, app_ids, delay, modo)
            print(f"[enrich:preco] {atualizados} jogo(s) com preço atualizado, {falhas} falha(s)")
        else:
            app_ids = buscar_app_ids_pendentes(conn, limite)
            if not app_ids:
                print("[enrich] nenhum jogo pendente de gênero")
                return
            atualizados, falhas = processar(conn, app_ids, delay, modo)
            print(f"[enrich] {atualizados} jogo(s) atualizado(s), {falhas} sem gênero disponível (contam como tentativa)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
