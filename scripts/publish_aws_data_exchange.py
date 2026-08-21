"""
Publica o arquivo agregado no S3 e cria uma nova revision no AWS Data
Exchange. Roda depois de aggregate_preferences.py.

Pressupõe que o dataset (`data set`) já foi criado uma vez manualmente no
console do AWS Data Exchange (Provider Studio) -- este script só cuida de
publicar revisions novas para um dataset já existente.

Variáveis de ambiente esperadas:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION
      -- credenciais AWS (via secrets do GitHub Actions)
  ADX_DATASET_ID       -- ID do dataset já criado no AWS Data Exchange
  S3_BUCKET             -- bucket usado como origem dos assets
  INPUT_PATH            -- caminho do CSV agregado (default: export/preferencias_agregadas.csv)
"""

import os
from pathlib import Path

import boto3

INPUT_PATH = Path(os.environ.get("INPUT_PATH", "export/preferencias_agregadas.csv"))
S3_KEY_PREFIX = "preferencias-agregadas"


def upload_para_s3(s3_client, bucket, input_path):
    from datetime import date

    key = f"{S3_KEY_PREFIX}/{date.today().isoformat()}.csv"
    s3_client.upload_file(str(input_path), bucket, key)
    print(f"[adx] arquivo enviado para s3://{bucket}/{key}")
    return key


def criar_revision(adx_client, dataset_id, bucket, s3_key):
    revision = adx_client.create_revision(
        DataSetId=dataset_id,
        Comment="Atualização periódica de preferências agregadas (job automatizado)",
    )
    revision_id = revision["Id"]

    job = adx_client.create_job(
        Type="IMPORT_ASSETS_FROM_S3",
        Details={
            "ImportAssetsFromS3": {
                "DataSetId": dataset_id,
                "RevisionId": revision_id,
                "AssetSources": [{"Bucket": bucket, "Key": s3_key}],
            }
        },
    )
    adx_client.start_job(JobId=job["Id"])
    print(f"[adx] job {job['Id']} iniciado para importar asset na revision {revision_id}")

    # Em produção, esperar o job concluir (poll em get_job) antes de finalizar
    # a revision. Aqui deixamos como próximo passo manual/monitorado no
    # workflow do GitHub Actions, para não travar a execução do job.
    return revision_id


def finalizar_revision(adx_client, dataset_id, revision_id):
    adx_client.update_revision(DataSetId=dataset_id, RevisionId=revision_id, Finalized=True)
    print(f"[adx] revision {revision_id} finalizada e publicada")


def main():
    dataset_id = os.environ["ADX_DATASET_ID"]
    bucket = os.environ["S3_BUCKET"]

    s3_client = boto3.client("s3")
    adx_client = boto3.client("dataexchange")

    s3_key = upload_para_s3(s3_client, bucket, INPUT_PATH)
    revision_id = criar_revision(adx_client, dataset_id, bucket, s3_key)

    # A finalização fica separada da criação porque o job de import é
    # assíncrono -- ver nota em criar_revision(). Para automatizar
    # completamente, adicionar um polling em get_job antes de chamar isso.
    finalizar_revision(adx_client, dataset_id, revision_id)


if __name__ == "__main__":
    main()
