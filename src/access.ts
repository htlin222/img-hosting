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
// Tolerance for clock drift between Cloudflare's edge and this Worker when
// evaluating the `exp` / `nbf` time claims.
const CLOCK_SKEW_MS = 60 * 1000; // 60 seconds

type JwtHeader = { alg: string; kid: string; typ?: string };
type JwtPayload = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
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

/**
 * Resolve a team name to the canonical Cloudflare Access origin.
 * Accepts plain team names (`htlin`), fully-qualified hostnames
 * (`htlin.cloudflareaccess.com`), or full URLs.
 */
export const teamOrigin = (team: string): string => {
  const trimmed = team.replace(/\/$/, '');
  if (trimmed.startsWith('http')) return trimmed;
  if (trimmed.endsWith('.cloudflareaccess.com')) return `https://${trimmed}`;
  return `https://${trimmed}.cloudflareaccess.com`;
};

const fetchJwks = async (team: string, force = false): Promise<JsonWebKey[]> => {
  const cached = JWKS_CACHE.get(team);
  if (!force && cached && cached.expires > Date.now()) return cached.keys;
  const url = `${teamOrigin(team)}/cdn-cgi/access/certs`;
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

/**
 * Pure verification: given the JWT, the expected aud, the expected issuer,
 * and the set of trusted public keys, returns the identity or throws.
 *
 * No network calls — testable in isolation. Real callers should use
 * `verifyAccessJwt`, which resolves the team's JWKS first.
 */
export const verifyJwtWithKeys = async (
  jwt: string,
  expectedAud: string,
  expectedIss: string,
  keys: JsonWebKey[],
  now: number = Date.now(),
): Promise<AccessIdentity> => {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('access: malformed jwt');
  const [hSeg, pSeg, sSeg] = parts;

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeJson<JwtHeader>(hSeg);
    payload = decodeJson<JwtPayload>(pSeg);
  } catch {
    throw new Error('access: malformed jwt');
  }

  if (header.alg !== 'RS256') throw new Error(`access: unsupported alg ${header.alg}`);
  // Allow a small clock skew on both ends of the validity window.
  if (!payload.exp || payload.exp * 1000 < now - CLOCK_SKEW_MS) {
    throw new Error('access: jwt expired');
  }
  if (payload.nbf && payload.nbf * 1000 > now + CLOCK_SKEW_MS) {
    throw new Error('access: jwt not yet valid');
  }
  if (!audMatches(payload.aud, expectedAud)) throw new Error('access: aud mismatch');
  // Strict equality on iss — `.includes()` would allow attacker-controlled
  // team names that happen to contain the expected substring.
  if (payload.iss !== expectedIss) throw new Error('access: iss mismatch');

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

/**
 * Verify a Cloudflare Access JWT for the given team / aud. Fetches and
 * caches the team's JWKS, then delegates to `verifyJwtWithKeys`.
 */
export const verifyAccessJwt = async (
  jwt: string,
  team: string,
  aud: string,
): Promise<AccessIdentity> => {
  const expectedIss = teamOrigin(team);
  const keys = await fetchJwks(team);
  try {
    return await verifyJwtWithKeys(jwt, aud, expectedIss, keys);
  } catch (e) {
    // When Access rotates signing keys, a token's `kid` won't be in our cached
    // JWKS and every request fails until the 1h TTL lapses — effectively
    // locking the user out. On a kid miss specifically, force a single refresh
    // and retry. Other failures (expired, bad sig, aud/iss) are not retried.
    if ((e as Error).message.includes('no jwk for kid')) {
      const fresh = await fetchJwks(team, true);
      return verifyJwtWithKeys(jwt, aud, expectedIss, fresh);
    }
    throw e;
  }
};

// Test seam: lets tests prime the JWKS cache without going to network.
export const __setJwksCacheForTests = (team: string, keys: JsonWebKey[]) => {
  JWKS_CACHE.set(team, { keys, expires: Date.now() + CACHE_TTL_MS });
};
