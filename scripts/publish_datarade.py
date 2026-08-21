"""
Prepara a entrega do arquivo agregado para o Datarade.

Datarade é um marketplace de intermediação: ele não hospeda o dataset,
apenas conecta você ao comprador. Não existe uma API pública de "upload"
de dataset -- o provedor cadastra a listagem uma vez no Provider Studio
(https://providers.datarade.ai/apply) e define ali como o dado é entregue.

O que este script automatiza é a parte que depende de nós: gerar um link
de download temporário e assinado para o arquivo agregado mais recente, e
um manifesto com metadados do dataset. Esse link é o que se cola na
listagem do Datarade ou se manda para o comprador quando fecha negócio.

Variáveis de ambiente esperadas:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION
  S3_BUCKET               -- reaproveita o mesmo bucket do AWS Data Exchange
  INPUT_PATH               -- caminho do CSV agregado
  DATARADE_LINK_TTL_HOURS  -- validade do link assinado (default: 168 = 7 dias)
"""

import json
import os
from datetime import date
from pathlib import Path

import boto3

INPUT_PATH = Path(os.environ.get("INPUT_PATH", "export/preferencias_agregadas.csv"))
LINK_TTL_HOURS = int(os.environ.get("DATARADE_LINK_TTL_HOURS", "168"))
S3_KEY_PREFIX = "datarade-delivery"


def upload_e_assinar(s3_client, bucket, input_path, ttl_hours):
    key = f"{S3_KEY_PREFIX}/{date.today().isoformat()}.csv"
    s3_client.upload_file(str(input_path), bucket, key)

    url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=ttl_hours * 3600,
    )
    return key, url


def gerar_manifesto(csv_path, download_url, ttl_hours):
    with csv_path.open(encoding="utf-8") as f:
        cabecalho = f.readline().strip().split(",")

    manifesto = {
        "dataset": "Preferências de jogos agregadas (Steam)",
        "descricao": "Preferência declarada por gênero de jogo, agregada semanalmente, com k-anonimato (k>=5).",
        "colunas": cabecalho,
        "frequencia_atualizacao": "semanal",
        "url_download": download_url,
        "url_valida_ate_horas": ttl_hours,
        "gerado_em": date.today().isoformat(),
    }
    return manifesto


def main():
    bucket = os.environ["S3_BUCKET"]
    s3_client = boto3.client("s3")

    _, url = upload_e_assinar(s3_client, bucket, INPUT_PATH, LINK_TTL_HOURS)
    manifesto = gerar_manifesto(INPUT_PATH, url, LINK_TTL_HOURS)

    manifesto_path = INPUT_PATH.parent / "datarade_manifest.json"
    manifesto_path.write_text(json.dumps(manifesto, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[datarade] link assinado (válido por {LINK_TTL_HOURS}h): {url}")
    print(f"[datarade] manifesto gravado em {manifesto_path}")
    print("[datarade] cole o link e os metadados na listagem do Provider Studio, "
          "ou envie diretamente ao comprador conforme o acordo comercial.")


if __name__ == "__main__":
    main()
