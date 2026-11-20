import crypto from 'crypto';
import { timingSafeStringEqual } from './securityUtils.ts';
import { loadTenantVaultAsync, saveTenantVaultAsync, withVaultLock } from './tokenVault.ts';

function readCborLength(buf: Buffer, addtl: number, offset: number): { length: number; nextOffset: number } {
  if (addtl < 24) {
    return { length: addtl, nextOffset: offset };
  }
  if (addtl === 24) {
    if (offset + 1 > buf.length) throw new Error('Truncated CBOR 1-byte length.');
    return { length: buf.readUInt8(offset), nextOffset: offset + 1 };
  }
  if (addtl === 25) {
    if (offset + 2 > buf.length) throw new Error('Truncated CBOR 2-byte length.');
    return { length: buf.readUInt16BE(offset), nextOffset: offset + 2 };
  }
  if (addtl === 26) {
    if (offset + 4 > buf.length) throw new Error('Truncated CBOR 4-byte length.');
    return { length: buf.readUInt32BE(offset), nextOffset: offset + 4 };
  }
  if (addtl === 27) {
    if (offset + 8 > buf.length) throw new Error('Truncated CBOR 8-byte length.');
    const big = buf.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('CBOR integer exceeds JS safe integer range.');
    }
    return { length: Number(big), nextOffset: offset + 8 };
  }
  throw new Error(`Unsupported CBOR additional info: ${addtl}`);
}

/**
 * Minimal RFC-8949 CBOR decoder supporting integers, byte strings, UTF-8 strings,
 * arrays, maps, tags, and simple booleans/nulls used in WebAuthn attestation/COSE keys.
 */
export function decodeCborValue(
  buf: Buffer,
  offset = 0,
  depth = 0
): { value: unknown; nextOffset: number } {
  if (depth > 16) throw new Error('CBOR nesting limit exceeded.');
  if (offset >= buf.length) throw new Error('Unexpected end of CBOR input.');

  const initial = buf.readUInt8(offset);
  const major = initial >> 5;
  const addtl = initial & 0x1f;
  let pos = offset + 1;

  if (major === 0) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    return { value: length, nextOffset };
  }
  if (major === 1) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    return { value: -1 - length, nextOffset };
  }
  if (major === 2) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    if (nextOffset + length > buf.length) throw new Error('Truncated CBOR byte string.');
    return { value: Buffer.from(buf.subarray(nextOffset, nextOffset + length)), nextOffset: nextOffset + length };
  }
  if (major === 3) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    if (nextOffset + length > buf.length) throw new Error('Truncated CBOR UTF-8 string.');
    return { value: buf.subarray(nextOffset, nextOffset + length).toString('utf8'), nextOffset: nextOffset + length };
  }
  if (major === 4) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    pos = nextOffset;
    const arr: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const item = decodeCborValue(buf, pos, depth + 1);
      arr.push(item.value);
      pos = item.nextOffset;
    }
    return { value: arr, nextOffset: pos };
  }
  if (major === 5) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    pos = nextOffset;
    const map = new Map<unknown, unknown>();
    for (let i = 0; i < length; i++) {
      const key = decodeCborValue(buf, pos, depth + 1);
      const val = decodeCborValue(buf, key.nextOffset, depth + 1);
      map.set(key.value, val.value);
      pos = val.nextOffset;
    }
    return { value: map, nextOffset: pos };
  }
  if (major === 6) {
    const { nextOffset } = readCborLength(buf, addtl, pos);
    return decodeCborValue(buf, nextOffset, depth + 1);
  }
  if (major === 7) {
    if (addtl === 20) return { value: false, nextOffset: pos };
    if (addtl === 21) return { value: true, nextOffset: pos };
    if (addtl === 22) return { value: null, nextOffset: pos };
    if (addtl === 23) return { value: undefined, nextOffset: pos };
    if (addtl === 24) {
      if (pos + 1 > buf.length) throw new Error('Truncated CBOR simple value.');
      return { value: buf.readUInt8(pos), nextOffset: pos + 1 };
    }
  }
  throw new Error(`Unsupported CBOR major type ${major} / addtl ${addtl}`);
}

function padFixedCoord(buf: Buffer, size: number): Buffer {
  if (buf.length === size) return buf;
  if (buf.length < size) {
    return Buffer.concat([Buffer.alloc(size - buf.length, 0), buf]);
  }
  // Allow optional leading zero sign byte if it trims cleanly to size
  if (buf.length === size + 1 && buf[0] === 0) {
    return buf.subarray(1);
  }
  throw new Error(`Invalid EC coordinate byte length: ${buf.length}`);
}

export function coseKeyMapToSpki(coseMap: Map<unknown, unknown>): {
  publicKeySpkiBase64: string;
  coseAlg: number;
} {
  const kty = Number(coseMap.get(1));
  const alg = Number(coseMap.get(3));

  if (kty === 2 && alg === -7) {
    // EC2 P-256 (ES256)
    const crv = Number(coseMap.get(-1));
    const xBuf = coseMap.get(-2);
    const yBuf = coseMap.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(xBuf) || !Buffer.isBuffer(yBuf)) {
      throw new Error('Invalid COSE EC2 P-256 public key parameters.');
    }
    const pubKey = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: padFixedCoord(xBuf, 32).toString('base64url'),
        y: padFixedCoord(yBuf, 32).toString('base64url'),
      },
      format: 'jwk',
    });
    const spkiDer = pubKey.export({ format: 'der', type: 'spki' });
    return {
      publicKeySpkiBase64: Buffer.from(spkiDer).toString('base64'),
      coseAlg: alg,
    };
  }

  if (kty === 3 && alg === -257) {
    // RSA RS256
    const nBuf = coseMap.get(-1);
    const eBuf = coseMap.get(-2);
    if (!Buffer.isBuffer(nBuf) || !Buffer.isBuffer(eBuf)) {
      throw new Error('Invalid COSE RSA public key parameters.');
    }
    const pubKey = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: nBuf.toString('base64url'),
        e: eBuf.toString('base64url'),
      },
      format: 'jwk',
    });
    const spkiDer = pubKey.export({ format: 'der', type: 'spki' });
    return {
      publicKeySpkiBase64: Buffer.from(spkiDer).toString('base64'),
      coseAlg: alg,
    };
  }

  if (kty === 1 && alg === -8) {
    // OKP Ed25519 (EdDSA)
    const crv = Number(coseMap.get(-1));
    const xBuf = coseMap.get(-2);
    if (crv !== 6 || !Buffer.isBuffer(xBuf)) {
      throw new Error('Invalid COSE Ed25519 public key parameters.');
    }
    const pubKey = crypto.createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: padFixedCoord(xBuf, 32).toString('base64url'),
      },
      format: 'jwk',
    });
    const spkiDer = pubKey.export({ format: 'der', type: 'spki' });
    return {
      publicKeySpkiBase64: Buffer.from(spkiDer).toString('base64'),
      coseAlg: alg,
    };
  }

  throw new Error(`Unsupported COSE key type (${kty}) or algorithm (${alg}).`);
}

function parseClientDataJson(
  rawB64Url: unknown,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: string,
  expectedOrigins: string[]
): { clientDataBytes: Buffer; origin: string } {
  if (typeof rawB64Url !== 'string' || !rawB64Url.trim()) {
    throw new Error('Missing WebAuthn clientDataJSON.');
  }
  const clientDataBytes = Buffer.from(rawB64Url.trim(), 'base64url');
  if (clientDataBytes.length === 0) {
    throw new Error('Empty WebAuthn clientDataJSON.');
  }
  let parsed: { type?: string; challenge?: string; origin?: string };
  try {
    parsed = JSON.parse(clientDataBytes.toString('utf8')) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
  } catch {
    throw new Error('Malformed WebAuthn clientDataJSON.');
  }
  if (parsed.type !== expectedType) {
    throw new Error(`Unexpected WebAuthn ceremony type: ${String(parsed.type)}.`);
  }
  if (!parsed.challenge || !timingSafeStringEqual(parsed.challenge, expectedChallenge)) {
    throw new Error('WebAuthn challenge mismatch.');
  }
  const origin = String(parsed.origin || '').trim();
  if (!origin || !expectedOrigins.includes(origin)) {
    throw new Error(`Untrusted WebAuthn origin: ${origin || 'missing'}.`);
  }
  return { clientDataBytes, origin };
}

function assertRpIdHashAndFlags(authData: Buffer, expectedRpId: string, requireAtFlag: boolean): number {
  const minLen = requireAtFlag ? 55 : 37;
  if (!Buffer.isBuffer(authData) || authData.length < minLen) {
    throw new Error('Truncated WebAuthn authenticatorData.');
  }
  const expectedRpHash = crypto.createHash('sha256').update(expectedRpId).digest();
  const actualRpHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(actualRpHash, expectedRpHash)) {
    throw new Error('WebAuthn RP ID hash mismatch.');
  }
  const flags = authData.readUInt8(32);
  const up = (flags & 0x01) !== 0;
  const at = (flags & 0x40) !== 0;
  if (!up) {
    throw new Error('WebAuthn user-present (UP) flag is not set.');
  }
  if (requireAtFlag && !at) {
    throw new Error('WebAuthn attested-credential-data (AT) flag is missing.');
  }
  return authData.readUInt32BE(33);
}

export interface WebAuthnCredentialPayload {
  id?: unknown;
  rawId?: unknown;
  response?: {
    clientDataJSON?: unknown;
    attestationObject?: unknown;
    authenticatorData?: unknown;
    signature?: unknown;
  };
}

export function verifyWebAuthnRegistration(params: {
  credential: WebAuthnCredentialPayload;
  expectedChallenge: string;
  expectedRpId: string;
  expectedOrigins: string[];
}): {
  credId: string;
  publicKeySpkiBase64: string;
  coseAlg: number;
  signCount: number;
} {
  const cred = params.credential;
  if (!cred || typeof cred !== 'object') {
    throw new Error('Missing credential payload.');
  }
  const claimedCredId = String(cred.id || cred.rawId || '').trim();
  if (!claimedCredId) {
    throw new Error('Missing WebAuthn credential ID.');
  }

  parseClientDataJson(
    cred.response?.clientDataJSON,
    'webauthn.create',
    params.expectedChallenge,
    params.expectedOrigins
  );

  const attObjB64 = cred.response?.attestationObject;
  if (typeof attObjB64 !== 'string' || !attObjB64.trim()) {
    throw new Error('Missing WebAuthn attestationObject.');
  }
  const attBytes = Buffer.from(attObjB64.trim(), 'base64url');
  const decodedAtt = decodeCborValue(attBytes).value;
  if (!(decodedAtt instanceof Map)) {
    throw new Error('Malformed WebAuthn attestationObject CBOR map.');
  }
  const authData = decodedAtt.get('authData');
  if (!Buffer.isBuffer(authData)) {
    throw new Error('Missing authData inside attestationObject.');
  }

  const signCount = assertRpIdHashAndFlags(authData, params.expectedRpId, true);
  const credIdLen = authData.readUInt16BE(53);
  const credIdEnd = 55 + credIdLen;
  if (credIdLen <= 0 || credIdEnd >= authData.length) {
    throw new Error('Invalid attested credential ID length.');
  }
  const credIdBuf = authData.subarray(55, credIdEnd);
  const attestedCredId = credIdBuf.toString('base64url');
  if (attestedCredId !== claimedCredId) {
    throw new Error('Attested credential ID does not match submitted credential.id.');
  }

  const coseDecoded = decodeCborValue(authData, credIdEnd).value;
  if (!(coseDecoded instanceof Map)) {
    throw new Error('Malformed COSE public key in attestationObject.');
  }
  const { publicKeySpkiBase64, coseAlg } = coseKeyMapToSpki(coseDecoded);

  return {
    credId: attestedCredId,
    publicKeySpkiBase64,
    coseAlg,
    signCount,
  };
}

export function verifyWebAuthnAssertion(params: {
  credential: WebAuthnCredentialPayload;
  expectedChallenge: string;
  expectedRpId: string;
  expectedOrigins: string[];
  publicKeySpkiBase64: string;
  coseAlg?: number;
  storedCounter: number;
}): { verified: boolean; newSignCount: number; error?: string } {
  try {
    const cred = params.credential;
    if (!cred || typeof cred !== 'object') {
      return { verified: false, newSignCount: params.storedCounter, error: 'Missing credential.' };
    }
    const { clientDataBytes } = parseClientDataJson(
      cred.response?.clientDataJSON,
      'webauthn.get',
      params.expectedChallenge,
      params.expectedOrigins
    );

    const authDataB64 = cred.response?.authenticatorData;
    const sigB64 = cred.response?.signature;
    if (typeof authDataB64 !== 'string' || !authDataB64.trim() || typeof sigB64 !== 'string' || !sigB64.trim()) {
      return {
        verified: false,
        newSignCount: params.storedCounter,
        error: 'Missing authenticatorData or signature.',
      };
    }

    const authData = Buffer.from(authDataB64.trim(), 'base64url');
    const sigBuf = Buffer.from(sigB64.trim(), 'base64url');
    const newSignCount = assertRpIdHashAndFlags(authData, params.expectedRpId, false);

    if ((params.storedCounter > 0 || newSignCount > 0) && newSignCount <= params.storedCounter) {
      return {
        verified: false,
        newSignCount,
        error: 'Passkey signature counter regression detected.',
      };
    }

    if (!params.publicKeySpkiBase64) {
      return {
        verified: false,
        newSignCount,
        error: 'Passkey record lacks stored public key.',
      };
    }

    const pubKey = crypto.createPublicKey({
      key: Buffer.from(params.publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });

    const clientDataHash = crypto.createHash('sha256').update(clientDataBytes).digest();
    const signedData = Buffer.concat([authData, clientDataHash]);
    const algDigest = params.coseAlg === -8 ? null : 'sha256';
    const isValidSig = crypto.verify(algDigest, signedData, pubKey, sigBuf);
    if (!isValidSig) {
      return {
        verified: false,
        newSignCount,
        error: 'Invalid WebAuthn assertion signature.',
      };
    }

    return { verified: true, newSignCount };
  } catch (err) {
    return {
      verified: false,
      newSignCount: params.storedCounter,
      error: err instanceof Error ? err.message : 'WebAuthn verification failed.',
    };
  }
}

const consumedJtiInMemory = new Set<string>();

export async function consumePasskeyChallengeJti(jti?: string): Promise<boolean> {
  const cleanJti = String(jti || '').trim().replace(/[^0-9a-zA-Z_-]/g, '');
  if (!cleanJti || cleanJti.length < 8) return false;
  if (consumedJtiInMemory.has(cleanJti)) return false;

  const vaultKey = `passkey_jti_${cleanJti}`;
  return withVaultLock(vaultKey, async () => {
    if (consumedJtiInMemory.has(cleanJti)) return false;
    const existing = await loadTenantVaultAsync<{ usedAt?: number } | null>(vaultKey, null);
    if (existing?.usedAt) {
      consumedJtiInMemory.add(cleanJti);
      return false;
    }
    if (consumedJtiInMemory.size > 5000) {
      const oldest = consumedJtiInMemory.values().next().value;
      if (oldest) consumedJtiInMemory.delete(oldest);
    }
    consumedJtiInMemory.add(cleanJti);
    await saveTenantVaultAsync(vaultKey, { usedAt: Date.now() });
    return true;
  });
}
