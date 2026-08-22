// Abre o login da Steam num popup em vez de navegar a página inteira pra
// fora do site -- menos disruptivo pro usuário. auth-callback.html avisa
// esta janela quando o login termina (postMessage); se o popup for
// bloqueado, cai de volta pra navegação normal de página inteira.
function iniciarLoginSteam(loginUrl) {
  const popup = window.open(loginUrl, "steam-login", "width=500,height=650");

  if (!popup) {
    window.location.href = loginUrl;
    return;
  }

  const aoReceberMensagem = (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data !== "steam-login-sucesso") return;
    window.removeEventListener("message", aoReceberMensagem);
    window.location.href = "dashboard.html";
  };
  window.addEventListener("message", aoReceberMensagem);
}
