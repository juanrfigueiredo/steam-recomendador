// Wrapper fino sobre fetch: sempre manda o cookie de sessão e trata 401 de
// forma consistente em todas as páginas autenticadas.
async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    window.location.href = "index.html";
    throw new Error("não autenticado");
  }

  return response;
}

async function apiGetJson(path) {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(`falha ao buscar ${path}: ${response.status}`);
  return response.json();
}
