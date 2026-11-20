// Nakładki globalne: dialog, komunikaty, przejście do walki, błąd krytyczny.

import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { forceUpdate } from '../../services/updateService';
import { useUi } from '../../state/uiStore';
import { CapsuleIcon } from './common';

export function DialogBox() {
  const dialog = useUi((s) => s.dialog);
  const advance = useUi((s) => s.advanceDialog);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, advance]);

  if (!dialog) return null;
  const last = dialog.index >= dialog.lines.length - 1;
  return (
    <button className="dialog" onClick={advance} aria-live="polite">
      {dialog.lines[dialog.index]}
      <span className="next">{last ? '✓ zamknij' : '▼ dalej'}</span>
    </button>
  );
}

export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  );
}

/** Baner „nowa wersja gry” — gdy serwer ma nowszą wersję, a telefon wciąż uruchamia starą. */
export function UpdateBanner() {
  const target = useUi((s) => s.updateAvailable);
  const mode = useUi((s) => s.mode);
  const busy = useUi((s) => s.transition);
  if (!target || busy || (mode !== 'title' && mode !== 'overworld')) return null;
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span>Jest nowa wersja gry ({target}).</span>
      <button
        className="btn btn-small btn-primary"
        onClick={async () => {
          const r = await forceUpdate(target);
          if (r === 'unsafe') useUi.getState().showToast('Aktualizacja będzie możliwa po walce.');
          else if (r === 'unavailable') useUi.getState().showToast('Zamknij i otwórz grę ponownie, aby ją zaktualizować.');
        }}
      >
        Aktualizuj teraz
      </button>
    </div>
  );
}

export function TransitionOverlay() {
  const on = useUi((s) => s.transition);
  if (!on) return null;
  return (
    <div className="transition" aria-hidden>
      <CapsuleIcon className="spinner" size={46} />
    </div>
  );
}

interface EBState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Błąd interfejsu', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen">
        <div className="title-wrap">
          <h2>Ups — coś poszło nie tak</h2>
          <p className="muted small">{this.state.error.message}</p>
          <p className="muted small">Postęp jest zapisywany automatycznie, więc ponowne uruchomienie jest bezpieczne.</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Uruchom ponownie
          </button>
        </div>
      </div>
    );
  }
}
