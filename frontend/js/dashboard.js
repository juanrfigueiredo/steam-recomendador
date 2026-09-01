function scoreClass(score) {
  if (score >= 80) return "score-verde";
  if (score >= 50) return "score-amarelo";
  if (score >= 30) return "score-neutro";
  return "score-vermelho";
}

function formatarTempo(minutos) {
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = Math.round(minutos % 60);
  return `${horas}:${String(minutosRestantes).padStart(2, "0")}`;
}

function mostrarMensagem(elId, texto, tipo) {
  const el = document.getElementById(elId);
  el.textContent = texto;
  el.className = `mensagem ${tipo}`;
}

async function carregarPerfil() {
  const perfil = await apiGetJson("/me");
  document.getElementById("perfil-nome").textContent = perfil.display_name || "Sua conta";
  if (perfil.avatar_url) {
    const avatar = document.getElementById("perfil-avatar");
    avatar.src = perfil.avatar_url;
    avatar.hidden = false;
  }
  return perfil;
}

const ITENS_POR_PAGINA = 20;
let bibliotecaJogos = [];
let bibliotecaPagina = 1;

async function carregarBiblioteca() {
  const { jogos } = await apiGetJson("/me/library");
  bibliotecaJogos = jogos;
  bibliotecaPagina = 1;

  const vazio = document.getElementById("biblioteca-vazia");
  vazio.hidden = jogos.length > 0;

  renderizarPaginaBiblioteca();
}

function renderizarPaginaBiblioteca() {
  const linhas = document.getElementById("biblioteca-linhas");
  const paginacao = document.getElementById("biblioteca-paginacao");
  linhas.textContent = "";

  const totalPaginas = Math.max(1, Math.ceil(bibliotecaJogos.length / ITENS_POR_PAGINA));
  bibliotecaPagina = Math.min(bibliotecaPagina, totalPaginas);

  const inicio = (bibliotecaPagina - 1) * ITENS_POR_PAGINA;
  const pagina = bibliotecaJogos.slice(inicio, inicio + ITENS_POR_PAGINA);

  for (const jogo of pagina) {
    const tr = document.createElement("tr");
    const tdNome = document.createElement("td");
    tdNome.textContent = jogo.nome;
    const tdHoras = document.createElement("td");
    tdHoras.textContent = formatarTempo(jogo.playtime_minutos);
    tr.append(tdNome, tdHoras);
    linhas.appendChild(tr);
  }

  paginacao.hidden = bibliotecaJogos.length <= ITENS_POR_PAGINA;
  document.getElementById("biblioteca-pagina-info").textContent =
    `Página ${bibliotecaPagina} de ${totalPaginas}`;
  document.getElementById("biblioteca-anterior").disabled = bibliotecaPagina <= 1;
  document.getElementById("biblioteca-proxima").disabled = bibliotecaPagina >= totalPaginas;
}

function formatarPreco(centavos, moeda) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: moeda || "BRL",
  }).format(centavos / 100);
}

function criarSeloPreco(rec) {
  if (rec.gratuito) {
    const selo = document.createElement("span");
    selo.className = "recomendacao-selo selo-gratis";
    selo.textContent = "Grátis";
    return selo;
  }

  if (rec.preco_final_centavos == null) return null;

  const selo = document.createElement("span");
  selo.className = "recomendacao-selo";

  if (rec.desconto_percentual > 0) {
    selo.classList.add("selo-promocao");
    const precoInicial = document.createElement("s");
    precoInicial.textContent = formatarPreco(rec.preco_inicial_centavos, rec.preco_moeda);
    selo.append(
      `-${rec.desconto_percentual}% `,
      formatarPreco(rec.preco_final_centavos, rec.preco_moeda),
      " ",
      precoInicial
    );
  } else {
    selo.textContent = formatarPreco(rec.preco_final_centavos, rec.preco_moeda);
  }

  return selo;
}

function criarLinhaRecomendacao(rec) {
  const score = Number(rec.score);

  const item = document.createElement("div");
  item.className = "recomendacao-item";

  if (rec.imagem_url) {
    const capa = document.createElement("div");
    capa.className = "recomendacao-capa";
    const img = document.createElement("img");
    img.src = rec.imagem_url;
    img.alt = "";
    img.loading = "lazy";
    capa.appendChild(img);
    item.appendChild(capa);
  }

  const info = document.createElement("div");
  info.className = "recomendacao-info";

  const nome = document.createElement("a");
  nome.className = "recomendacao-nome";
  nome.href = `https://store.steampowered.com/app/${rec.app_id}`;
  nome.target = "_blank";
  nome.rel = "noopener";
  nome.textContent = rec.nome;
  info.appendChild(nome);

  const selo = criarSeloPreco(rec);
  if (selo) info.appendChild(selo);

  if (rec.genero_motivo) {
    const motivo = document.createElement("p");
    motivo.className = "recomendacao-motivo";
    motivo.textContent = `Recomendado porque você joga muito ${rec.genero_motivo}`;
    info.appendChild(motivo);
  }

  const acoes = document.createElement("div");
  acoes.className = "recomendacao-acoes";

  const dial = criarDialCompatibilidade({
    valorInicial: score,
    classeCor: scoreClass,
    aoEnviar: async (valor, mudou) => {
      const resposta = await enviarFeedback(rec.app_id, score, !mudou, mudou ? valor : undefined);
      if (resposta.ok) dial.congelar();
    },
  });
  acoes.appendChild(dial.elemento);

  item.append(info, acoes);
  return item;
}

async function enviarFeedback(appId, predictedScore, confirmed, userRating) {
  return apiFetch("/feedback", {
    method: "POST",
    body: JSON.stringify({
      app_id: appId,
      predicted_score: predictedScore,
      confirmed,
      ...(confirmed ? {} : { user_rating: userRating }),
    }),
  });
}

const ITENS_POR_PAGINA_RECOMENDACOES = 10;
let recomendacoesLista = [];
let recomendacoesPagina = 1;

async function carregarRecomendacoes() {
  const { recomendacoes } = await apiGetJson("/recommendations");
  recomendacoesLista = recomendacoes;
  recomendacoesPagina = 1;

  document.getElementById("recomendacoes-vazia").hidden = recomendacoes.length > 0;

  renderizarPaginaRecomendacoes();
}

function renderizarPaginaRecomendacoes() {
  const lista = document.getElementById("recomendacoes-lista");
  const paginacao = document.getElementById("recomendacoes-paginacao");
  lista.textContent = "";

  const totalPaginas = Math.max(1, Math.ceil(recomendacoesLista.length / ITENS_POR_PAGINA_RECOMENDACOES));
  recomendacoesPagina = Math.min(recomendacoesPagina, totalPaginas);

  const inicio = (recomendacoesPagina - 1) * ITENS_POR_PAGINA_RECOMENDACOES;
  const pagina = recomendacoesLista.slice(inicio, inicio + ITENS_POR_PAGINA_RECOMENDACOES);

  for (const rec of pagina) {
    lista.appendChild(criarLinhaRecomendacao(rec));
  }

  paginacao.hidden = recomendacoesLista.length <= ITENS_POR_PAGINA_RECOMENDACOES;
  document.getElementById("recomendacoes-pagina-info").textContent =
    `Página ${recomendacoesPagina} de ${totalPaginas}`;
  document.getElementById("recomendacoes-anterior").disabled = recomendacoesPagina <= 1;
  document.getElementById("recomendacoes-proxima").disabled = recomendacoesPagina >= totalPaginas;
}

async function carregarConsentimento() {
  const consent = await apiGetJson("/me/consent");
  document.getElementById("consent-toggle").checked = Boolean(consent.consent_commercial);
}

function configurarAcoes() {
  document.getElementById("btn-sair").onclick = async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    window.location.href = "index.html";
  };

  document.getElementById("btn-sync").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const response = await apiFetch("/me/sync", { method: "POST" });
      const data = await response.json();
      mostrarMensagem("sync-mensagem", `${data.jogos_sincronizados} jogo(s) sincronizado(s).`, "sucesso");
      await carregarBiblioteca();
    } catch {
      mostrarMensagem("sync-mensagem", "Falha ao sincronizar. Tente de novo.", "erro");
    } finally {
      e.target.disabled = false;
    }
  };

  document.getElementById("recomendacoes-anterior").onclick = () => {
    recomendacoesPagina -= 1;
    renderizarPaginaRecomendacoes();
  };

  document.getElementById("recomendacoes-proxima").onclick = () => {
    recomendacoesPagina += 1;
    renderizarPaginaRecomendacoes();
  };

  document.getElementById("biblioteca-anterior").onclick = () => {
    bibliotecaPagina -= 1;
    renderizarPaginaBiblioteca();
  };

  document.getElementById("biblioteca-proxima").onclick = () => {
    bibliotecaPagina += 1;
    renderizarPaginaBiblioteca();
  };

  document.getElementById("consent-toggle").onchange = async (e) => {
    const response = await apiFetch("/me/consent", {
      method: "POST",
      body: JSON.stringify({ consent_commercial: e.target.checked }),
    });
    if (response.ok) {
      mostrarMensagem("consent-mensagem", "Preferência salva.", "sucesso");
    } else {
      e.target.checked = !e.target.checked;
      mostrarMensagem("consent-mensagem", "Falha ao salvar. Tente de novo.", "erro");
    }
  };

  document.getElementById("btn-export").onclick = async () => {
    const response = await apiFetch("/me/export");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meus-dados-steam-recomendador.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById("btn-delete").onclick = async () => {
    const confirmado = window.confirm(
      "Tem certeza? Sua conta será marcada para exclusão definitiva em até 30 dias."
    );
    if (!confirmado) return;

    const response = await apiFetch("/me/delete", { method: "POST" });
    if (response.ok) {
      mostrarMensagem("conta-mensagem", "Conta marcada para exclusão. Saindo...", "sucesso");
      await apiFetch("/auth/logout", { method: "POST" });
      setTimeout(() => (window.location.href = "index.html"), 2000);
    } else {
      mostrarMensagem("conta-mensagem", "Falha ao processar exclusão. Tente de novo.", "erro");
    }
  };
}

async function iniciar() {
  configurarAcoes();
  await carregarPerfil();
  await Promise.all([carregarBiblioteca(), carregarRecomendacoes(), carregarConsentimento()]);
}

iniciar();
