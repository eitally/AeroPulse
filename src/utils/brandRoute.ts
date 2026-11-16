import { useCallback, useEffect, useState } from 'react';

/**
 * Matches `/brand`, `/brand/`, `#brand`, or `/#brand` so the Brand & Style Guide
 * works cleanly both as a zero-auth public route and from in-app footer links.
 */
export function isBrandStudioLocation(pathname: string, hash: string): boolean {
  const cleanPath = (pathname || '').trim().replace(/\/+$/, '').toLowerCase();
  const cleanHash = (hash || '').trim().replace(/^#/, '').toLowerCase();
  return cleanPath === '/brand' || cleanHash === 'brand';
}

export function openBrandStudioRoute(): void {
  if (typeof window === 'undefined') return;
  if (!isBrandStudioLocation(window.location.pathname, window.location.hash)) {
    window.history.pushState({}, '', '/brand');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function exitBrandStudioRoute(targetHash?: string): void {
  if (typeof window === 'undefined') return;
  const cleanHash = targetHash ? targetHash.replace(/^#/, '').trim() : '';
  const nextUrl = cleanHash ? `/#${cleanHash}` : '/';
  window.history.pushState({}, '', nextUrl);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (cleanHash && typeof HashChangeEvent !== 'undefined') {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function useBrandStudioRoute(): {
  isBrandRoute: boolean;
  openBrand: () => void;
  closeBrand: (targetHash?: string) => void;
} {
  const [isBrandRoute, setIsBrandRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isBrandStudioLocation(window.location.pathname, window.location.hash);
  });

  useEffect(() => {
    const sync = () => {
      setIsBrandRoute(isBrandStudioLocation(window.location.pathname, window.location.hash));
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  const openBrand = useCallback(() => {
    openBrandStudioRoute();
    setIsBrandRoute(true);
  }, []);

  const closeBrand = useCallback((targetHash?: string) => {
    exitBrandStudioRoute(targetHash);
    setIsBrandRoute(false);
  }, []);

  return { isBrandRoute, openBrand, closeBrand };
}
