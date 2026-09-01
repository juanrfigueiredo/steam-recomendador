// Caminho relativo (mesmo domínio do Pages): as chamadas passam pelo proxy
// same-origin em frontend/functions/api/, que repassa pro Worker. Isso
// mantém o cookie de sessão como primeira parte pro navegador.
const API_BASE_URL = "/api";
