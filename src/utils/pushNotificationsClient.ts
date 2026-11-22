import { buildThreshSessionHeaders } from './teamLifecycleApi';

export interface PushStatusSummary {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscriptionCount: number;
  error?: string;
}

export interface SubscribePushResult {
  ok: boolean;
  permission: NotificationPermission | 'unsupported';
  subscriptionCount?: number;
  demoLocalOnly?: boolean;
  error?: string;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export function isIosStandaloneHintNeeded(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  if (!isIos) return false;
  const navWithStandalone = navigator as Navigator & { standalone?: boolean };
  const isStandalone =
    navWithStandalone.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true;
  return !isStandalone;
}

export function getCurrentPushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function fetchPushStatus(): Promise<PushStatusSummary> {
  const supported = isWebPushSupported();
  const permission = getCurrentPushPermission();
  if (!supported) {
    return { supported: false, permission, subscriptionCount: 0 };
  }
  try {
    const resp = await fetch('/api/push/status', {
      headers: buildThreshSessionHeaders(),
      credentials: 'include',
    });
    if (!resp.ok) {
      return { supported, permission, subscriptionCount: 0 };
    }
    const data = (await resp.json()) as { ok?: boolean; subscriptionCount?: number };
    return {
      supported,
      permission,
      subscriptionCount: Number(data.subscriptionCount || 0),
    };
  } catch {
    return { supported, permission, subscriptionCount: 0 };
  }
}

export async function subscribeToThreshWebPush(options?: {
  muteQuietHours?: boolean;
  isSampleDemoMode?: boolean;
}): Promise<SubscribePushResult> {
  if (options?.isSampleDemoMode) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // Sample demo works even if headless browser blocks prompt
      }
    }
    return {
      ok: true,
      permission: getCurrentPushPermission() === 'unsupported' ? 'granted' : getCurrentPushPermission(),
      subscriptionCount: 1,
      demoLocalOnly: true,
    };
  }

  if (!isWebPushSupported()) {
    return {
      ok: false,
      permission: getCurrentPushPermission(),
      error: isIosStandaloneHintNeeded()
        ? 'On iPhone/iPad, tap Share → Add to Home Screen first to enable lock-screen push alerts.'
        : 'Web Push notifications are not supported in this browser.',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      permission,
      error:
        'Notification permission is blocked in browser settings. Enable notifications for MeetReady and retry.',
    };
  }

  try {
    const keyResp = await fetch('/api/push/vapid-public-key', {
      headers: buildThreshSessionHeaders(),
      credentials: 'include',
    });
    const keyJson = (await keyResp.json()) as { ok?: boolean; publicKey?: string; error?: string };
    if (!keyResp.ok || !keyJson.publicKey) {
      return {
        ok: false,
        permission,
        error: keyJson.error || 'Unable to load server Web Push VAPID public key.',
      };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const appServerKey = urlBase64ToUint8Array(keyJson.publicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
    }

    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint || subscription.endpoint;
    const p256dh = subJson.keys?.p256dh || '';
    const auth = subJson.keys?.auth || '';
    if (!endpoint || !p256dh || !auth) {
      return {
        ok: false,
        permission,
        error: 'Browser generated an incomplete push subscription token.',
      };
    }

    const saveResp = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: buildThreshSessionHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth },
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : undefined,
        muteQuietHours: options?.muteQuietHours === true,
      }),
    });
    const saveJson = (await saveResp.json()) as {
      ok?: boolean;
      subscriptionCount?: number;
      error?: string;
    };
    if (saveResp.status === 401) {
      return {
        ok: true,
        permission,
        subscriptionCount: 1,
        demoLocalOnly: true,
      };
    }
    if (!saveResp.ok || !saveJson.ok) {
      return {
        ok: false,
        permission,
        error: saveJson.error || 'Could not register push subscription on MeetReady server.',
      };
    }
    return {
      ok: true,
      permission,
      subscriptionCount: Number(saveJson.subscriptionCount || 1),
    };
  } catch (err) {
    return {
      ok: false,
      permission,
      error:
        err instanceof Error
          ? err.message
          : 'Failed subscribing device to MeetReady Web Push notifications.',
    };
  }
}

export async function unsubscribeFromThreshWebPush(): Promise<{
  ok: boolean;
  remainingCount: number;
  error?: string;
}> {
  let endpoint: string | undefined;
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => false);
      }
    }
    const resp = await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: buildThreshSessionHeaders(),
      credentials: 'include',
      body: JSON.stringify({ endpoint }),
    });
    if (!resp.ok) {
      return { ok: true, remainingCount: 0 };
    }
    const data = (await resp.json()) as { remainingCount?: number };
    return { ok: true, remainingCount: Number(data.remainingCount || 0) };
  } catch (err) {
    return {
      ok: false,
      remainingCount: 0,
      error: err instanceof Error ? err.message : 'Unable to pause device push alerts.',
    };
  }
}

export async function sendTestWebPush(): Promise<{
  ok: boolean;
  deliveredCount?: number;
  error?: string;
}> {
  try {
    const resp = await fetch('/api/push/test', {
      method: 'POST',
      headers: buildThreshSessionHeaders(),
      credentials: 'include',
      body: '{}',
    });
    const data = (await resp.json()) as { ok?: boolean; deliveredCount?: number; error?: string };
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed sending test device alert.' };
    }
    return { ok: true, deliveredCount: Number(data.deliveredCount || 0) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed contacting MeetReady push gateway.',
    };
  }
}
