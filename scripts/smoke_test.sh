#!/usr/bin/env bash
# Testes de fumaça contra o site em produção (não são testes unitários --
# rodam depois de cada deploy pra confirmar que o essencial não quebrou).
# Cobrem especificamente as duas classes de bug já vistas neste projeto:
#   1. proxy same-origin (frontend/functions/api) não sendo detectado pelo
#      wrangler e caindo no fallback de SPA (serve index.html pra tudo);
#   2. cookie de sessão cross-origin sendo bloqueado como cookie de terceiro.
set -uo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://steam-recomendador.pages.dev}"
FALHAS=0

status_de() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
status_post_de() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$1"; }
headers_de() { curl -s -D - -o /dev/null "$1"; }
content_type_de() { headers_de "$1" | grep -i '^content-type:' | tr -d '\r'; }

checar() {
  local descricao="$1" esperado="$2" obtido="$3"
  if [ "$esperado" = "$obtido" ]; then
    echo "OK     - $descricao"
  else
    echo "FALHOU - $descricao (esperado: $esperado, obtido: $obtido)"
    FALHAS=$((FALHAS + 1))
  fi
}

contem() {
  local descricao="$1" trecho="$2" texto="$3"
  if printf '%s' "$texto" | grep -qF "$trecho"; then
    echo "OK     - $descricao"
  else
    echo "FALHOU - $descricao (esperava conter: $trecho)"
    FALHAS=$((FALHAS + 1))
  fi
}

echo "== Testando $FRONTEND_URL =="

# --- Health check do Worker via proxy ---
checar "GET /api/health responde 200" "200" "$(status_de "$FRONTEND_URL/api/health")"
contem "GET /api/health responde ok:true" '"ok":true' "$(curl -s "$FRONTEND_URL/api/health")"

# --- Login da Steam: o proxy tem que redirecionar pra Steam, não servir a landing ---
login_headers=$(headers_de "$FRONTEND_URL/api/auth/steam/login")
checar "GET /api/auth/steam/login responde 302 (não a landing page)" "302" "$(status_de "$FRONTEND_URL/api/auth/steam/login")"
contem "Location aponta pro OpenID da Steam" "https://steamcommunity.com/openid/login" "$login_headers"
contem "return_to aponta pro proxy same-origin (não pro domínio do Worker)" "openid.return_to=https%3A%2F%2Fsteam-recomendador.pages.dev%2Fapi%2Fauth%2Fsteam%2Fcallback" "$login_headers"

# --- Rotas autenticadas sem cookie: tem que voltar 401 JSON do Worker, nunca
#     200 HTML (200 HTML = sinal do bug do fallback de SPA voltando) ---
for rota in "/api/me" "/api/me/library" "/api/recommendations" "/api/score/570"; do
  checar "GET $rota sem cookie responde 401" "401" "$(status_de "$FRONTEND_URL$rota")"
  contem "GET $rota sem cookie responde JSON (não HTML da landing)" "application/json" "$(content_type_de "$FRONTEND_URL$rota")"
done

checar "POST /api/feedback sem cookie responde 401" "401" "$(status_post_de "$FRONTEND_URL/api/feedback")"

# --- Páginas estáticas do frontend continuam servindo normal ---
checar "GET / responde 200" "200" "$(status_de "$FRONTEND_URL/")"
checar "GET /dashboard.html responde 200 (seguindo redirect de URL limpa)" "200" "$(curl -s -L -o /dev/null -w '%{http_code}' "$FRONTEND_URL/dashboard.html")"

echo "=================================="
if [ "$FALHAS" -eq 0 ]; then
  echo "Todos os testes de fumaça passaram."
  exit 0
else
  echo "$FALHAS teste(s) falharam."
  exit 1
fi
