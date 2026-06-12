import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  verifyJwtWithKeys,
  verifyAccessJwt,
  teamOrigin,
  __setJwksCacheForTests,
} from '../src/access';

// We sign a real RS256 JWT with a generated keypair, then feed both
// the JWT and the matching public JWK into verifyJwtWithKeys to exercise
// the full verification path without any network IO.

const TEAM = 'testteam';
const EXPECTED_ISS = teamOrigin(TEAM);
const EXPECTED_AUD = 'test-aud';
const KID = 'test-kid';

const b64urlEncode = (data: string | Uint8Array): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
};

type Claims = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  email?: string;
  sub?: string;
};

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;
let otherPrivateKey: CryptoKey;

const generateRsaKeypair = async (): Promise<CryptoKeyPair> => {
  const kp = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  // `generateKey` returns `CryptoKey | CryptoKeyPair`; for asymmetric algs
  // it's always a pair, narrow the type.
  return kp as CryptoKeyPair;
};

beforeAll(async () => {
  const kp = await generateRsaKeypair();
  privateKey = kp.privateKey;
  publicJwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  (publicJwk as JsonWebKey & { kid: string }).kid = KID;

  // A second keypair we never trust — used to forge a signature.
  const other = await generateRsaKeypair();
  otherPrivateKey = other.privateKey;
});

const signJwt = async (
  claims: Claims,
  opts: { alg?: string; kid?: string; signer?: CryptoKey } = {},
): Promise<string> => {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const hSeg = b64urlEncode(JSON.stringify(header));
  const pSeg = b64urlEncode(JSON.stringify(claims));
  const signingInput = `${hSeg}.${pSeg}`;
  const sigBuf = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    opts.signer ?? privateKey,
    new TextEncoder().encode(signingInput),
  );
  const sSeg = b64urlEncode(new Uint8Array(sigBuf));
  return `${signingInput}.${sSeg}`;
};

const validClaims = (overrides: Partial<Claims> = {}): Claims => ({
  aud: EXPECTED_AUD,
  iss: EXPECTED_ISS,
  exp: Math.floor(Date.now() / 1000) + 600,
  email: 'user@example.com',
  sub: 'sub-123',
  ...overrides,
});

describe('verifyJwtWithKeys', () => {
  it('accepts a valid JWT and returns identity', async () => {
    const jwt = await signJwt(validClaims());
    const identity = await verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]);
    expect(identity.email).toBe('user@example.com');
    expect(identity.sub).toBe('sub-123');
  });

  it('rejects malformed JWT (wrong segment count)', async () => {
    await expect(
      verifyJwtWithKeys('not.a.jwt.really', EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/malformed/);
  });

  it('rejects expired JWT', async () => {
    const jwt = await signJwt(validClaims({ exp: Math.floor(Date.now() / 1000) - 60 }));
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/expired/);
  });

  it('rejects JWT missing exp', async () => {
    const jwt = await signJwt(validClaims({ exp: undefined }));
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/expired/);
  });

  it('rejects wrong aud', async () => {
    const jwt = await signJwt(validClaims({ aud: 'other-aud' }));
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/aud mismatch/);
  });

  it('accepts aud as array containing expected', async () => {
    const jwt = await signJwt(validClaims({ aud: ['other', EXPECTED_AUD, 'third'] }));
    const identity = await verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]);
    expect(identity.email).toBe('user@example.com');
  });

  it('rejects wrong iss', async () => {
    // The audit finding: previously `.includes(team)` would let this pass.
    // After tightening to strict equality, it must be rejected.
    const jwt = await signJwt(
      validClaims({ iss: `https://malicious-${TEAM}-clone.cloudflareaccess.com` }),
    );
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/iss mismatch/);
  });

  it('rejects unsupported alg (HS256)', async () => {
    // We can't actually sign with HS256 via WebCrypto here, but we can
    // hand-craft a JWT whose header says alg=HS256 — the verifier should
    // reject before attempting signature check.
    const header = b64urlEncode(JSON.stringify({ alg: 'HS256', kid: KID, typ: 'JWT' }));
    const payload = b64urlEncode(JSON.stringify(validClaims()));
    const jwt = `${header}.${payload}.AAAA`;
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/unsupported alg/);
  });

  it('rejects alg=none', async () => {
    const header = b64urlEncode(JSON.stringify({ alg: 'none', kid: KID, typ: 'JWT' }));
    const payload = b64urlEncode(JSON.stringify(validClaims()));
    const jwt = `${header}.${payload}.`;
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/unsupported alg/);
  });

  it('rejects when kid does not match any known key', async () => {
    const jwt = await signJwt(validClaims(), { kid: 'unknown-kid' });
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/no jwk for kid/);
  });

  it('rejects when signed with a different key (forged signature)', async () => {
    // Signed by a key we never trust, even though kid matches.
    const jwt = await signJwt(validClaims(), { signer: otherPrivateKey });
    await expect(
      verifyJwtWithKeys(jwt, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/signature verify failed/);
  });

  it('rejects when payload is tampered after signing', async () => {
    const jwt = await signJwt(validClaims());
    const [h, , s] = jwt.split('.');
    const tamperedPayload = b64urlEncode(
      JSON.stringify(validClaims({ email: 'evil@example.com' })),
    );
    const tampered = `${h}.${tamperedPayload}.${s}`;
    await expect(
      verifyJwtWithKeys(tampered, EXPECTED_AUD, EXPECTED_ISS, [publicJwk]),
    ).rejects.toThrow(/signature verify failed/);
  });
});

describe('verifyAccessJwt JWKS rotation (P2)', () => {
  const TEAM2 = 'rotationteam';
  const ISS2 = teamOrigin(TEAM2);

  afterEach(() => vi.unstubAllGlobals());

  const exportPublic = async (kp: CryptoKeyPair, kid: string): Promise<JsonWebKey> => {
    const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey & { kid: string };
    jwk.kid = kid;
    return jwk;
  };

  it('refetches JWKS when the token kid is missing from cache (key rotation)', async () => {
    // Cache holds only the *old* signing key — the lockout scenario.
    const oldKp = await generateRsaKeypair();
    __setJwksCacheForTests(TEAM2, [await exportPublic(oldKp, 'old-kid')]);

    // The token is signed by a freshly-rotated key the cache hasn't seen.
    const newKp = await generateRsaKeypair();
    const newJwk = await exportPublic(newKp, 'new-kid');
    const jwt = await signJwt(validClaims({ iss: ISS2 }), {
      kid: 'new-kid',
      signer: newKp.privateKey,
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ keys: [newJwk] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const identity = await verifyAccessJwt(jwt, TEAM2, EXPECTED_AUD);
    expect(identity.email).toBe('user@example.com');
    // Exactly one forced refresh — not a refetch storm.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT refetch for an ordinarily-invalid token (e.g. expired)', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests(TEAM2, [await exportPublic(kp, 'k1')]);
    const jwt = await signJwt(
      validClaims({ iss: ISS2, exp: Math.floor(Date.now() / 1000) - 30 }),
      { kid: 'k1', signer: kp.privateKey },
    );

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyAccessJwt(jwt, TEAM2, EXPECTED_AUD)).rejects.toThrow(/expired/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('teamOrigin', () => {
  it('prepends https and suffix for a bare team name', () => {
    expect(teamOrigin('htlin')).toBe('https://htlin.cloudflareaccess.com');
  });
  it('leaves fully-qualified hostnames alone', () => {
    expect(teamOrigin('htlin.cloudflareaccess.com')).toBe(
      'https://htlin.cloudflareaccess.com',
    );
  });
  it('respects explicit URLs', () => {
    expect(teamOrigin('https://htlin.cloudflareaccess.com/')).toBe(
      'https://htlin.cloudflareaccess.com',
    );
  });
});
