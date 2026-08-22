function scoreClass(score) {
  if (score >= 80) return "score-verde";
  if (score >= 50) return "score-amarelo";
  if (score >= 30) return "score-neutro";
  return "score-vermelho";
}

function formatarHoras(minutos) {
  return (minutos / 60).toFixed(1).replace(".0", "");
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

async function carregarBiblioteca() {
  const { jogos } = await apiGetJson("/me/library");
  const linhas = document.getElementById("biblioteca-linhas");
  const vazio = document.getElementById("biblioteca-vazia");
  linhas.textContent = "";

  if (jogos.length === 0) {
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;

  for (const jogo of jogos) {
    const tr = document.createElement("tr");
    const tdNome = document.createElement("td");
    tdNome.textContent = jogo.nome;
    const tdHoras = document.createElement("td");
    tdHoras.textContent = `${formatarHoras(jogo.playtime_minutos)}h`;
    tr.append(tdNome, tdHoras);
    linhas.appendChild(tr);
  }
}

function criarLinhaRecomendacao(rec) {
  const score = Number(rec.score);

  const item = document.createElement("div");
  item.className = "card-header";
  item.style.borderBottom = "1px solid var(--border)";
  item.style.paddingBottom = "10px";
  item.style.marginBottom = "10px";

  const info = document.createElement("div");
  const nome = document.createElement("strong");
  nome.textContent = rec.nome;
  const badge = document.createElement("span");
  badge.className = `score-badge ${scoreClass(score)}`;
  badge.style.marginLeft = "10px";
  badge.textContent = `${score.toFixed(0)}%`;
  info.append(nome, badge);

  const acoes = document.createElement("div");
  acoes.className = "acoes-conta";

  const btnConfirmar = document.createElement("button");
  btnConfirmar.textContent = "✓ Compatibilidade certa";
  btnConfirmar.onclick = () => enviarFeedback(rec.app_id, score, true, null, acoes);

  const inputNota = document.createElement("input");
  inputNota.type = "number";
  inputNota.min = "0";
  inputNota.max = "100";
  inputNota.placeholder = "0-100";
  inputNota.style.width = "70px";

  const btnCorrigir = document.createElement("button");
  btnCorrigir.textContent = "Corrigir";
  btnCorrigir.onclick = () => {
    const nota = Number(inputNota.value);
    if (!Number.isInteger(nota) || nota < 0 || nota > 100) {
      inputNota.focus();
      return;
    }
    enviarFeedback(rec.app_id, score, false, nota, acoes);
  };

  acoes.append(btnConfirmar, inputNota, btnCorrigir);
  item.append(info, acoes);
  return item;
}

async function enviarFeedback(appId, predictedScore, confirmed, userRating, acoesEl) {
  const response = await apiFetch("/feedback", {
    method: "POST",
    body: JSON.stringify({
      app_id: appId,
      predicted_score: predictedScore,
      confirmed,
      ...(confirmed ? {} : { user_rating: userRating }),
    }),
  });
  if (response.ok) {
    acoesEl.textContent = "Obrigado pelo feedback!";
  }
}

async function carregarRecomendacoes() {
  const { recomendacoes } = await apiGetJson("/recommendations");
  const lista = document.getElementById("recomendacoes-lista");
  const vazio = document.getElementById("recomendacoes-vazia");
  lista.textContent = "";

  if (recomendacoes.length === 0) {
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;

  for (const rec of recomendacoes) {
    lista.appendChild(criarLinhaRecomendacao(rec));
  }
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
