import { useEffect, useRef } from 'react';
import { modalKey } from './browser';

/** Keeps keyboard interaction inside the active modal and restores its opener. */
export function useModalAccessibility(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs.item(dialogs.length - 1);
    if (!dialog) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
    const firstField = dialog.querySelector<HTMLElement>(
      'input:not([disabled]),textarea:not([disabled]),select:not([disabled])',
    );
    (firstField || focusable()[0] || dialog).focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      const controls = event.key === 'Tab' ? focusable() : [];
      const active = document.activeElement as HTMLElement;
      const action = modalKey(
        event.key,
        event.shiftKey,
        controls.length,
        controls.indexOf(active),
        dialog.contains(active),
      );
      if (action === 'default') return;
      event.preventDefault();
      if (action === 'close') closeRef.current();
      else if (action === 'first') controls[0]?.focus();
      else if (action === 'last') controls.at(-1)?.focus();
      else dialog.focus();
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      document.body.style.overflow = oldOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
}
