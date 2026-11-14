import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const activeDialogStack: symbol[] = [];
let savedBodyOverflow: string | null = null;

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    // Check visibility in real DOM while tolerating jsdom (where offsetParent is null)
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export interface UseModalDialogOptions {
  isOpen: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  disableEscape?: boolean;
}

/**
 * Shared accessible modal/drawer lifecycle hook:
 * - Locks background document scroll (stack-aware for nested modals)
 * - Moves initial focus inside the dialog
 * - Traps Tab / Shift+Tab within focusable descendants of the topmost dialog
 * - Dismisses topmost dialog on Escape (unless disabled)
 * - Restores focus to the triggering element on close/unmount
 */
export function useModalDialog({
  isOpen,
  onClose,
  dialogRef,
  initialFocusRef,
  disableEscape = false,
}: UseModalDialogOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const disableEscapeRef = useRef(disableEscape);
  disableEscapeRef.current = disableEscape;

  const initialFocusRefHolder = useRef(initialFocusRef);
  initialFocusRefHolder.current = initialFocusRef;

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const dialogToken = Symbol('thresh-modal-dialog');
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (activeDialogStack.length === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    activeDialogStack.push(dialogToken);

    const focusFrame = window.requestAnimationFrame(() => {
      const container = dialogRef.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return;

      const explicitTarget = initialFocusRefHolder.current?.current;
      if (explicitTarget && !explicitTarget.hasAttribute('disabled')) {
        explicitTarget.focus();
        return;
      }

      const focusables = getFocusableElements(container);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        if (!container.hasAttribute('tabindex')) {
          container.setAttribute('tabindex', '-1');
        }
        container.focus();
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      const isTopmost = activeDialogStack[activeDialogStack.length - 1] === dialogToken;
      if (!isTopmost) return;

      const container = dialogRef.current;
      if (!container) return;

      if (e.key === 'Escape') {
        if (
          disableEscapeRef.current ||
          e.defaultPrevented ||
          document.querySelector('[data-thresh-popover-open="true"]')
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);

      const idx = activeDialogStack.lastIndexOf(dialogToken);
      if (idx !== -1) {
        activeDialogStack.splice(idx, 1);
      }

      if (activeDialogStack.length === 0 && savedBodyOverflow !== null) {
        document.body.style.overflow = savedBodyOverflow;
        savedBodyOverflow = null;
      }

      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === 'function' &&
        document.contains(previouslyFocused)
      ) {
        window.requestAnimationFrame(() => {
          try {
            previouslyFocused.focus();
          } catch {
            // ignore focus restoration failures on detached nodes
          }
        });
      }
    };
  }, [isOpen, dialogRef]);
}
