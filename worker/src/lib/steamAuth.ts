// Steam usa OpenID 2.0, não OAuth. O fluxo é:
//  1. Redirecionar o usuário para steamcommunity.com/openid/login com os
//     parâmetros openid.* apontando de volta para o nosso /auth/steam/callback.
//  2. Steam redireciona de volta com openid.* preenchidos, incluindo
//     openid.claimed_id (contém o SteamID64).
//  3. Precisamos revalidar esses parâmetros direto com a Steam
//     (openid.mode=check_authentication), porque qualquer um poderia forjar
//     um callback com claimed_id de outra pessoa.

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

export function buildSteamLoginUrl(returnToUrl: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnToUrl,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

export async function verifySteamCallback(query: URLSearchParams): Promise<string | null> {
  const claimedId = query.get("openid.claimed_id");
  if (!claimedId) return null;

  const match = CLAIMED_ID_RE.exec(claimedId);
  if (!match) return null;
  const steamId64 = match[1];

  // Revalida com a Steam, trocando openid.mode para check_authentication e
  // reenviando os mesmos parâmetros que vieram no callback.
  const verifyParams = new URLSearchParams(query);
  verifyParams.set("openid.mode", "check_authentication");

  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });
  const text = await response.text();

  const isValid = /is_valid\s*:\s*true/.test(text);
  return isValid ? steamId64 : null;
}

export type SteamPlayerSummary = {
  steamid: string;
  personaname: string;
  avatarfull: string;
};

export async function fetchSteamPlayerSummary(
  steamId64: string,
  apiKey: string
): Promise<SteamPlayerSummary | null> {
  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamids", steamId64);

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = (await response.json()) as {
    response?: { players?: SteamPlayerSummary[] };
  };
  return data.response?.players?.[0] ?? null;
}

export type SteamOwnedGame = {
  appid: number;
  name: string;
  playtime_forever: number;
};

export async function fetchOwnedGames(
  steamId64: string,
  apiKey: string
): Promise<SteamOwnedGame[]> {
  const url = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamid", steamId64);
  url.searchParams.set("include_appinfo", "true");
  url.searchParams.set("include_played_free_games", "true");

  const response = await fetch(url.toString());
  if (!response.ok) return [];

  const data = (await response.json()) as {
    response?: { games?: SteamOwnedGame[] };
  };
  return data.response?.games ?? [];
}
