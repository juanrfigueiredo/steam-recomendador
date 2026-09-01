import pandas as pd
import pytest

from generate_recommendations import (
    calcular_afinidade_por_genero,
    calcular_popularidade_global_por_genero,
    calcular_popularidade_por_jogo,
    calcular_score_conteudo,
    gerar_recomendacoes,
)


def _vazio(colunas):
    return pd.DataFrame(columns=colunas)


def test_calcular_afinidade_pondera_tempo_e_feedback():
    biblioteca = pd.DataFrame(
        {
            "user_id": [1, 1],
            "genero": ["RPG", "Terror"],
            "playtime_minutos": [100, 50],
        }
    )
    feedback = pd.DataFrame({"user_id": [1], "genero": ["RPG"], "nota": [80]})

    afinidade = calcular_afinidade_por_genero(biblioteca, feedback)

    rpg = afinidade.loc[afinidade["genero"] == "RPG", "afinidade"].iloc[0]
    terror = afinidade.loc[afinidade["genero"] == "Terror", "afinidade"].iloc[0]

    # sinal RPG = 100*1.0 (tempo) + 80*3.0 (feedback) = 340 -> normalizado = 100
    # sinal Terror = 50*1.0 (tempo) + 0 (sem feedback) = 50 -> normalizado = 50/340*100
    assert rpg == pytest.approx(100)
    assert terror == pytest.approx(50 / 340 * 100)


def test_calcular_score_conteudo_soma_credito_multi_genero():
    afinidade_usuario = pd.DataFrame(
        {"genero": ["RPG", "MMO", "Terror"], "afinidade": [100, 80, 0]}
    )
    candidatos = pd.DataFrame({"app_id": [1], "tags": [["RPG", "MMO"]]})

    resultado = calcular_score_conteudo(candidatos, afinidade_usuario, "afinidade")

    # max(RPG=100, MMO=80)=100, media=(100+80)/2=90 -> 0.6*100 + 0.4*90 = 96
    assert resultado.loc[0, "score_conteudo"] == pytest.approx(96)
    assert resultado.loc[0, "genero_motivo"] == "RPG"


def test_usuario_mmo_ranqueia_jogos_mmo_acima_de_genero_nao_relacionado():
    # Usuário 1 só possui um jogo, mas com bastante tempo jogado, marcado
    # tanto Action quanto MMO -- credita afinidade forte pros dois.
    biblioteca = pd.DataFrame(
        {
            "user_id": [1, 1],
            "app_id": [100, 100],
            "playtime_minutos": [10000, 10000],
            "genero": ["Action", "MMO"],
        }
    )
    feedback = _vazio(["user_id", "genero", "nota"])
    catalogo = pd.DataFrame(
        {
            "app_id": [100, 200, 300],
            "tags": [["Action", "MMO"], ["MMO", "RPG"], ["Puzzle"]],
        }
    )
    popularidade_jogos = pd.DataFrame({"app_id": [100], "minutos_totais": [10000]})
    usuarios = pd.DataFrame({"user_id": [1]})

    recomendacoes = gerar_recomendacoes(biblioteca, feedback, catalogo, popularidade_jogos, usuarios, top_n=50)

    # app 100 já é possuído -- não deve aparecer como recomendação.
    assert 100 not in recomendacoes["app_id"].values

    score_mmo = recomendacoes.loc[recomendacoes["app_id"] == 200, "score"].iloc[0]
    score_puzzle = recomendacoes.loc[recomendacoes["app_id"] == 300, "score"].iloc[0]
    assert score_mmo > score_puzzle


def test_cold_start_sem_dado_usa_popularidade_global():
    # Usuário 2 dá dado pro catálogo global; usuário 1 (o testado) não tem
    # nenhuma biblioteca/feedback -- cai no fallback de popularidade global.
    biblioteca = pd.DataFrame(
        {
            "user_id": [2],
            "app_id": [50],
            "playtime_minutos": [1000],
            "genero": ["Strategy"],
        }
    )
    feedback = _vazio(["user_id", "genero", "nota"])
    catalogo = pd.DataFrame({"app_id": [60], "tags": [["Strategy"]]})
    popularidade_jogos = pd.DataFrame({"app_id": [50], "minutos_totais": [1000]})
    usuarios = pd.DataFrame({"user_id": [1]})

    recomendacoes = gerar_recomendacoes(biblioteca, feedback, catalogo, popularidade_jogos, usuarios, top_n=50)

    assert len(recomendacoes) == 1
    linha = recomendacoes.iloc[0]
    assert linha["user_id"] == 1
    assert linha["app_id"] == 60
    assert pd.notna(linha["score"])


def test_candidatos_vazio_nao_gera_recomendacao_nem_erro():
    # Usuário já possui o catálogo inteiro -- não há candidato, e isso não
    # deve gerar erro (nlargest numa lista vazia quebrava antes disso ser
    # corrigido).
    biblioteca = pd.DataFrame(
        {"user_id": [1], "app_id": [1], "playtime_minutos": [100], "genero": ["Action"]}
    )
    feedback = _vazio(["user_id", "genero", "nota"])
    catalogo = pd.DataFrame({"app_id": [1], "tags": [["Action"]]})
    popularidade_jogos = pd.DataFrame({"app_id": [1], "minutos_totais": [100]})
    usuarios = pd.DataFrame({"user_id": [1]})

    recomendacoes = gerar_recomendacoes(biblioteca, feedback, catalogo, popularidade_jogos, usuarios, top_n=50)

    assert recomendacoes.empty


def test_popularidade_por_jogo_normaliza_e_achatada_por_log():
    popularidade_jogos = pd.DataFrame(
        {"app_id": [1, 2, 3], "minutos_totais": [1_000_000, 100, 500]}
    )

    resultado = calcular_popularidade_por_jogo(popularidade_jogos)

    pop_outlier = resultado.loc[resultado["app_id"] == 1, "popularidade_jogo"].iloc[0]
    pop_pequeno = resultado.loc[resultado["app_id"] == 2, "popularidade_jogo"].iloc[0]

    assert pop_outlier == pytest.approx(100)
    # Em escala linear, app 2 seria ~0.01 (100/1_000_000) -- log-escala
    # garante que ele fica claramente acima disso.
    assert pop_pequeno > 20
