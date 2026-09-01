// Controle circular pra confirmar/corrigir o score previsto de uma
// recomendação: arraste a alça (mouse, toque ou setas do teclado) até a
// porcentagem que parece certa, depois envie. Componente "burro" -- só
// geometria e eventos, sem saber nada da API; quem cria passa `aoEnviar` e
// decide o que fazer com o resultado (ver frontend/js/dashboard.js).
//
// Checklist de verificação manual sempre que este arquivo mudar (sem
// automação de navegador neste projeto -- ver plano da reformulação):
//   - arrastar com mouse até 0%, 50%, 100%
//   - arrastar com toque (emulação do devtools)
//   - foco + setas (±1), Shift+setas (±5), Home, End
//   - alternar tema (Alt esquerdo+Shift+D) com um dial visível e conferir
//     que as cores acompanham
//   - confirmar sem mexer vs. mover e enviar correção -- conferir o payload
//     de POST /feedback em cada caso
//   - depois de enviar, conferir que o dial trava (não reage mais a
//     arraste/teclado) e mostra "Obrigado pelo feedback!"

const DIAL_RAIO = 42;
const DIAL_CIRCUNFERENCIA = 2 * Math.PI * DIAL_RAIO;

function dialClamp(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

function dialValorParaAngulo(valor) {
  return (dialClamp(valor, 0, 100) / 100) * 360;
}

function dialAnguloParaValor(anguloGraus) {
  const normalizado = ((anguloGraus % 360) + 360) % 360;
  return Math.round((normalizado / 360) * 100);
}

// clientX/clientY do ponteiro -> ângulo em graus, 0 = 12h, crescendo no
// sentido horário (mesma referência do arco/alça desenhados no SVG).
function dialAnguloDoPonteiro(clientX, clientY, centro) {
  const dx = clientX - centro.x;
  const dy = clientY - centro.y;
  const anguloDesde3h = Math.atan2(dy, dx) * (180 / Math.PI);
  return anguloDesde3h + 90;
}

function criarDialCompatibilidade({ valorInicial, classeCor, aoEnviar }) {
  const valorOriginal = Math.round(valorInicial);
  let valor = valorOriginal;
  let arrastando = false;
  let congelado = false;

  const wrapper = document.createElement("div");
  wrapper.className = "dial-wrapper";

  const dial = document.createElement("div");
  dial.className = "dial-compatibilidade";
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-valuemin", "0");
  dial.setAttribute("aria-valuemax", "100");
  dial.setAttribute(
    "aria-label",
    "Compatibilidade prevista, arraste ou use as setas para corrigir"
  );
  dial.innerHTML = `
    <svg viewBox="0 0 100 100" width="72" height="72">
      <circle class="dial-trilho" cx="50" cy="50" r="${DIAL_RAIO}" fill="none" stroke-width="6" />
      <circle class="dial-arco" cx="50" cy="50" r="${DIAL_RAIO}" fill="none" stroke-width="6"
              stroke-dasharray="${DIAL_CIRCUNFERENCIA}" transform="rotate(-90 50 50)" />
      <rect class="dial-alca" width="10" height="10" x="45" y="4" />
    </svg>
    <span class="dial-valor"></span>
  `;

  const svg = dial.querySelector("svg");
  const arco = dial.querySelector(".dial-arco");
  const alca = dial.querySelector(".dial-alca");
  const rotuloValor = dial.querySelector(".dial-valor");

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "dial-submit";

  // Centro do dial na tela, capturado uma vez no início do arraste (ver
  // pointerdown abaixo) em vez de recalculado a cada pointermove: o texto
  // do botão muda de tamanho durante o arraste ("Confirmar" ->
  // "Enviar correção: N%"), o que reflow a coluna flex e desloca a posição
  // do SVG na tela -- recalcular a cada movimento fazia a matemática do
  // ângulo ficar errada conforme o arraste progredia.
  let centro = null;

  function atualizarVisual() {
    arco.setAttribute("stroke-dashoffset", String(DIAL_CIRCUNFERENCIA * (1 - valor / 100)));
    alca.setAttribute("transform", `rotate(${dialValorParaAngulo(valor)} 50 50)`);
    rotuloValor.textContent = `${valor}%`;
    dial.setAttribute("aria-valuenow", String(valor));

    dial.classList.remove("score-verde", "score-amarelo", "score-neutro", "score-vermelho");
    dial.classList.add(classeCor(valor));

    botao.textContent = valor === valorOriginal ? "Confirmar" : `Enviar correção: ${valor}%`;
  }

  function moverPara(clientX, clientY) {
    valor = dialAnguloParaValor(dialAnguloDoPonteiro(clientX, clientY, centro));
    atualizarVisual();
  }

  function aoMoverPonteiro(e) {
    if (!arrastando) return;
    moverPara(e.clientX, e.clientY);
  }

  function aoSoltarPonteiro() {
    arrastando = false;
    window.removeEventListener("pointermove", aoMoverPonteiro);
    window.removeEventListener("pointerup", aoSoltarPonteiro);
  }

  dial.addEventListener("pointerdown", (e) => {
    if (congelado) return;
    const rect = svg.getBoundingClientRect();
    centro = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    arrastando = true;
    moverPara(e.clientX, e.clientY);
    window.addEventListener("pointermove", aoMoverPonteiro);
    window.addEventListener("pointerup", aoSoltarPonteiro);
  });

  dial.addEventListener("keydown", (e) => {
    if (congelado) return;
    const passo = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      valor = dialClamp(valor + passo, 0, 100);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      valor = dialClamp(valor - passo, 0, 100);
    } else if (e.key === "Home") {
      valor = 0;
    } else if (e.key === "End") {
      valor = 100;
    } else {
      return;
    }
    e.preventDefault();
    atualizarVisual();
  });

  botao.addEventListener("click", () => {
    if (congelado) return;
    aoEnviar(valor, valor !== valorOriginal);
  });

  atualizarVisual();
  wrapper.append(dial, botao);

  return {
    elemento: wrapper,
    congelar() {
      congelado = true;
      dial.tabIndex = -1;
      dial.style.pointerEvents = "none";
      botao.remove();
      const obrigado = document.createElement("span");
      obrigado.className = "dial-obrigado";
      obrigado.textContent = "Obrigado pelo feedback!";
      wrapper.appendChild(obrigado);
    },
  };
}
