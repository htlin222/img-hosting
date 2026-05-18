// Cloudflare Access JWT verification.
//
// When the Worker sits behind a Cloudflare Access application, Cloudflare
// injects a signed JWT in the `Cf-Access-Jwt-Assertion` request header.
// We verify it against the team's JWKS, check aud / iss / exp, and extract
// the user's email.
//
// Activated only when env.ACCESS_AUD is set. Otherwise the verify step is
// skipped and write endpoints fall back to bearer-token auth.

const JWKS_CACHE = new Map<string, { keys: JsonWebKey[]; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type JwtHeader = { alg: string; kid: string; typ?: string };
type JwtPayload = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  email?: string;
  identity_nonce?: string;
  sub?: string;
};

export type AccessIdentity = {
  email: string;
  sub: string;
};

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const decodeJson = <T>(seg: string): T =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(seg))) as T;

const teamDomain = (team: string): string =>
  team.startsWith('http')
    ? team.replace(/\/$/, '')
    : team.endsWith('.cloudflareaccess.com')
    ? `https://${team}`
    : `https://${team}.cloudflareaccess.com`;

const fetchJwks = async (team: string): Promise<JsonWebKey[]> => {
  const cached = JWKS_CACHE.get(team);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const url = `${teamDomain(team)}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`access: jwks fetch failed ${res.status}`);
  const body = (await res.json()) as { keys: JsonWebKey[] };
  JWKS_CACHE.set(team, { keys: body.keys, expires: Date.now() + CACHE_TTL_MS });
  return body.keys;
};

const importRsaKey = (jwk: JsonWebKey): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

const audMatches = (claim: JwtPayload['aud'], expected: string): boolean =>
  Array.isArray(claim) ? claim.includes(expected) : claim === expected;

export const verifyAccessJwt = async (
  jwt: string,
  team: string,
  aud: string,
): Promise<AccessIdentity> => {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('access: malformed jwt');
  const [hSeg, pSeg, sSeg] = parts;
  const header = decodeJson<JwtHeader>(hSeg);
  const payload = decodeJson<JwtPayload>(pSeg);
  if (header.alg !== 'RS256') throw new Error(`access: unsupported alg ${header.alg}`);
  if (!payload.exp || payload.exp * 1000 < Date.now())
    throw new Error('access: jwt expired');
  if (!audMatches(payload.aud, aud)) throw new Error('access: aud mismatch');
  if (!payload.iss || !payload.iss.includes(team))
    throw new Error('access: iss mismatch');

  const keys = await fetchJwks(team);
  const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error(`access: no jwk for kid ${header.kid}`);
  const key = await importRsaKey(jwk);

  const sig = b64urlToBytes(sSeg);
  const data = new TextEncoder().encode(`${hSeg}.${pSeg}`);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    sig,
    data,
  );
  if (!ok) throw new Error('access: signature verify failed');

  return { email: payload.email ?? '', sub: payload.sub ?? '' };
};
