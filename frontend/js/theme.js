// Tema escuro é o padrão. Alternância manual só, sem seguir preferência do
// SO -- atalho Alt (esquerdo) + Shift + D, persistido por navegador.
(function () {
  const STORAGE_KEY = "tema";

  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
  }

  const salvo = localStorage.getItem(STORAGE_KEY);
  aplicarTema(salvo === "light" ? "light" : "dark");

  document.addEventListener("keydown", (e) => {
    if (e.code !== "KeyD" || !e.shiftKey || !e.altKey) return;
    // getModifierState("AltGraph") distingue Alt direito (AltGr, usado em
    // teclados ABNT2/europeus para acentos) do Alt esquerdo -- só o
    // esquerdo deve disparar o atalho.
    if (e.getModifierState("AltGraph")) return;

    const atual = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const novo = atual === "light" ? "dark" : "light";
    aplicarTema(novo);
    localStorage.setItem(STORAGE_KEY, novo);
  });
})();
