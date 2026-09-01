// Proxy same-origin pro Worker: o frontend chama /api/* no próprio domínio
// (Cloudflare Pages) em vez do domínio do Worker diretamente. Isso faz o
// cookie de sessão ser de primeira parte pro navegador, contornando o
// bloqueio de cookies de terceiros (Safari, Firefox estrito, Chrome) que
// quebrava o login com SameSite=None cross-origin.
const WORKER_URL = "https://steam-recomendador-api.juanrfigueiredo.workers.dev";

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(url.pathname.slice("/api".length) + url.search, WORKER_URL);

  const headers = new Headers(request.headers);
  headers.delete("host");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    // "manual" pra repassar redirects (login/callback da Steam) pro
    // navegador seguir, em vez do proxy segui-los ele mesmo.
    redirect: "manual",
  });

  return new Response(upstream.body, upstream);
}
