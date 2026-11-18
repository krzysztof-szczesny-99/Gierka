import { useEffect } from 'react';
import { bootApp } from './services/bootService';
import { useUi } from './state/uiStore';
import { DialogBox, ErrorBoundary, Toast, TransitionOverlay } from './ui/components/Overlays';
import { GemLogo } from './ui/components/common';
import { LearnMoveModal } from './ui/menus/LearnMoveModal';
import { ModalHost } from './ui/menus/ModalHost';
import { BattleScreen } from './ui/screens/BattleScreen';
import { OverworldScreen } from './ui/screens/OverworldScreen';
import { StarterScreen } from './ui/screens/StarterScreen';
import { TitleScreen } from './ui/screens/TitleScreen';

export default function App() {
  const mode = useUi((s) => s.mode);

  useEffect(() => {
    void bootApp();
  }, []);

  return (
    <ErrorBoundary>
      <div className="app">
        {mode === 'boot' && (
          <div className="screen">
            <div className="title-wrap">
              <GemLogo className="title-gem" />
              <div className="muted">Wczytywanie…</div>
            </div>
          </div>
        )}
        {mode === 'title' && <TitleScreen />}
        {mode === 'starter' && <StarterScreen />}
        {(mode === 'overworld' || mode === 'battle') && <OverworldScreen />}
        {mode === 'battle' && <BattleScreen />}
        <ModalHost />
        <LearnMoveModal />
        <DialogBox />
        <TransitionOverlay />
        <Toast />
      </div>
    </ErrorBoundary>
  );
}
