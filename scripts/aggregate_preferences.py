"""
Job de agregação e anonimização de preferências declaradas.

Le a tabela `feedback` (só de usuários com consent_commercial = true),
agrupa por gênero/tag e por semana, aplica k-anonimato e grava um arquivo
CSV agregado, pronto para ser publicado no AWS Data Exchange e no Datarade.

Nunca lê ou grava dado individual identificável. O que sai deste script
é sempre uma linha por (gênero, semana), nunca por usuário.

Variáveis de ambiente esperadas:
  DATABASE_URL   -- connection string do Postgres (Neon)
  K_ANONYMITY    -- limiar mínimo de usuários por grupo (default: 5)
  OUTPUT_PATH    -- caminho do arquivo CSV de saída (default: ./export/preferencias_agregadas.csv)
"""

import csv
import os
from pathlib import Path

import psycopg2

K_ANONYMITY = int(os.environ.get("K_ANONYMITY", "5"))
OUTPUT_PATH = Path(os.environ.get("OUTPUT_PATH", "export/preferencias_agregadas.csv"))

# Agrupa por gênero do jogo e por semana (ISO), calculando média de nota
# declarada e contagem de usuários distintos que contribuíram.
# A contagem de usuários é o que decide se o grupo passa no k-anonimato.
AGGREGATION_QUERY = """
    select
        gc.genero as genero,
        date_trunc('week', f.created_at)::date as semana,
        count(distinct f.user_id) as num_usuarios,
        avg(coalesce(f.user_rating, f.predicted_score))::numeric(5,2) as nota_media,
        avg(case when f.confirmed then 1 else 0 end)::numeric(4,3) as taxa_acerto_previsao
    from feedback f
    join users u on u.id = f.user_id
    join game_catalog gc on gc.app_id = f.app_id
    where u.consent_commercial = true
      and u.deleted_at is null
    group by gc.genero, date_trunc('week', f.created_at)
"""


def buscar_dados_agregados(conn):
    with conn.cursor() as cur:
        cur.execute(AGGREGATION_QUERY)
        colunas = [desc[0] for desc in cur.description]
        linhas = cur.fetchall()
    return colunas, linhas


def aplicar_k_anonimato(colunas, linhas, k):
    """Remove qualquer grupo com menos de k usuários distintos.

    Essa é a barreira principal contra reidentificação: nenhuma linha do
    arquivo final pode representar menos de k pessoas.
    """
    idx_num_usuarios = colunas.index("num_usuarios")
    return [linha for linha in linhas if linha[idx_num_usuarios] >= k]


def gravar_csv(colunas, linhas, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # num_usuarios não é exportado no arquivo final: ele serve só para o
    # filtro de k-anonimato, não deve compor o dataset vendido, porque
    # colunas de contagem muito baixa por si só ajudam a reidentificar.
    colunas_exportadas = [c for c in colunas if c != "num_usuarios"]
    idx_exportadas = [colunas.index(c) for c in colunas_exportadas]

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(colunas_exportadas)
        for linha in linhas:
            writer.writerow([linha[i] for i in idx_exportadas])


def main():
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(database_url)
    try:
        colunas, linhas = buscar_dados_agregados(conn)
    finally:
        conn.close()

    linhas_filtradas = aplicar_k_anonimato(colunas, linhas, K_ANONYMITY)

    descartadas = len(linhas) - len(linhas_filtradas)
    if descartadas:
        print(f"[aggregate] {descartadas} grupo(s) descartado(s) por não atingir k={K_ANONYMITY}")

    gravar_csv(colunas, linhas_filtradas, OUTPUT_PATH)
    print(f"[aggregate] {len(linhas_filtradas)} linha(s) gravada(s) em {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
