import { useEffect, useRef } from 'react';

export interface UploadBlockedProps {
  filename: string;
  onDismiss: () => void;
}

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.8 20 6v5.7c0 5-3.25 8.4-8 9.75-4.75-1.35-8-4.75-8-9.75V6l8-3.2Z" />
      <path d="M9.2 9.2 14.8 14.8M14.8 9.2 9.2 14.8" />
    </svg>
  );
}

export function UploadBlocked({ filename, onDismiss }: UploadBlockedProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown, true);
    primaryRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onDismiss]);

  return (
    <div className="si-scrim">
      <button
        className="si-backdrop"
        type="button"
        aria-label="Dismiss warning"
        onClick={onDismiss}
      />
      <section
        className="si-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="si-upload-title"
      >
        <div className="si-brand">
          <span className="si-brand-mark">
            <ShieldMark />
          </span>
          <span>SecureIntent</span>
          <span className="si-brand-ai">.ai</span>
        </div>
        <div className="si-divider" />
        <div className="si-alert-mark">
          <ShieldMark />
        </div>
        <h1 id="si-upload-title">Upload blocked</h1>
        <p>
          <strong>{filename}</strong> looks like a private key (PEM). It was not sent to this page.
          The file never left your machine.
        </p>
        <button ref={primaryRef} className="si-primary" type="button" onClick={onDismiss}>
          Got it
        </button>
        <span className="si-footnote">Scanned locally · Zero retention</span>
      </section>
    </div>
  );
}
