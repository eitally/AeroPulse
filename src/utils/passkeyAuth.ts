import type { ThreshUser } from '../types';

/**
 * THRESH Client-Side Passkey & WebAuthn Utilities
 * Pure browser standard APIs with zero external vendor dependencies ($0 SaaS).
 */

function base64urlToUint8Array(base64urlString: string): Uint8Array {
  const padding = '='.repeat((4 - (base64urlString.length % 4)) % 4);
  const base64 = (base64urlString + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function isPasskeySupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return false;
  }
  try {
    if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    // fallback
  }
  return true;
}

export async function registerPasskey(
  email: string,
  name?: string
): Promise<{ ok: boolean; user?: ThreshUser; error?: string }> {
  try {
    const optRes = await fetch('/api/auth/passkey/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });

    if (!optRes.ok) {
      const err = await optRes.json();
      return { ok: false, error: err.error || 'Failed obtaining passkey registration options.' };
    }

    const { options, challengeToken } = await optRes.json();

    // Prepare options for WebAuthn API
    const creationOptions: PublicKeyCredentialCreationOptions = {
      ...options,
      challenge: base64urlToUint8Array(options.challenge),
      user: {
        ...options.user,
        id: base64urlToUint8Array(options.user.id),
      },
    };

    const credential = (await navigator.credentials.create({
      publicKey: creationOptions,
    })) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, error: 'Passkey creation cancelled.' };
    }

    const rawResponse = credential.response as AuthenticatorAttestationResponse;
    const credPayload = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(rawResponse.clientDataJSON),
        attestationObject: bufferToBase64url(rawResponse.attestationObject),
      },
    };

    const verifyRes = await fetch('/api/auth/passkey/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: credPayload,
        challengeToken,
        email,
        name,
      }),
    });

    if (!verifyRes.ok) {
      const err = await verifyRes.json();
      return { ok: false, error: err.error || 'Passkey verification failed.' };
    }

    const result = await verifyRes.json();
    try {
      localStorage.removeItem('aeropulse_logged_out');
      if (result.sessionToken) {
        localStorage.setItem('aeropulse_session_token', String(result.sessionToken));
      }
    } catch {
      // ignore storage quota errors
    }
    return { ok: true, user: result.user };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('The operation either timed out or was not allowed') || msg.includes('abort')) {
      return { ok: false, error: 'Passkey registration cancelled.' };
    }
    return { ok: false, error: msg };
  }
}

export async function authenticateWithPasskey(): Promise<{
  ok: boolean;
  user?: ThreshUser;
  error?: string;
}> {
  try {
    const optRes = await fetch('/api/auth/passkey/auth-options', {
      method: 'POST',
    });

    if (!optRes.ok) {
      const err = await optRes.json();
      return { ok: false, error: err.error || 'Failed obtaining passkey authentication challenge.' };
    }

    const { options, challengeToken } = await optRes.json();

    const requestOptions: PublicKeyCredentialRequestOptions = {
      ...options,
      challenge: base64urlToUint8Array(options.challenge),
    };

    const assertion = (await navigator.credentials.get({
      publicKey: requestOptions,
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return { ok: false, error: 'Passkey authentication cancelled.' };
    }

    const rawResponse = assertion.response as AuthenticatorAssertionResponse;
    const credPayload = {
      id: assertion.id,
      rawId: bufferToBase64url(assertion.rawId),
      type: assertion.type,
      response: {
        clientDataJSON: bufferToBase64url(rawResponse.clientDataJSON),
        authenticatorData: bufferToBase64url(rawResponse.authenticatorData),
        signature: bufferToBase64url(rawResponse.signature),
      },
    };

    const verifyRes = await fetch('/api/auth/passkey/auth-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: credPayload,
        challengeToken,
      }),
    });

    if (!verifyRes.ok) {
      const err = await verifyRes.json();
      return { ok: false, error: err.error || 'Passkey authentication failed.' };
    }

    const result = await verifyRes.json();
    try {
      localStorage.removeItem('aeropulse_logged_out');
      if (result.sessionToken) {
        localStorage.setItem('aeropulse_session_token', String(result.sessionToken));
      }
    } catch {
      // ignore storage quota errors
    }
    return { ok: true, user: result.user };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('The operation either timed out or was not allowed') || msg.includes('abort')) {
      return { ok: false, error: 'Passkey sign-in cancelled.' };
    }
    return { ok: false, error: msg };
  }
}
