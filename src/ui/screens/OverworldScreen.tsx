import { useShallow } from 'zustand/react/shallow';
import { QUESTS } from '../../config/quests';
import { CURRENCY } from '../../config/text';
import { MAPS, TEST_MAP } from '../../game/maps/testMap';
import { PhaserGame } from '../../game/PhaserGame';
import { useGame } from '../../state/gameStore';
import { useUi, type ModalId } from '../../state/uiStore';
import { ActionButtons, Joystick } from '../components/Controls';

/** Mapa (Phaser) + nakładka HUD. Phaser pozostaje zamontowany także podczas walki. */
export function OverworldScreen() {
  const mode = useUi((s) => s.mode);
  return (
    <>
      <PhaserGame />
      {mode === 'overworld' && <Hud />}
    </>
  );
}

function useZoneName(): string {
  return useGame((s) => {
    const map = MAPS[s.player.mapId] ?? TEST_MAP;
    const z = map.zones.find(
      (zone) =>
        s.player.x >= zone.rect.x &&
        s.player.x < zone.rect.x + zone.rect.w &&
        s.player.y >= zone.rect.y &&
        s.player.y < zone.rect.y + zone.rect.h,
    );
    return z ? z.name : map.name;
  });
}

function useClaimableQuests(): number {
  const d = useGame(
    useShallow((s) => ({ stats: s.stats, dex: s.dex, party: s.party, flags: s.flags, claimed: s.questsClaimed })),
  );
  return QUESTS.filter((q) => !d.claimed[q.id] && q.progress(d) >= q.goal).length;
}

function Hud() {
  const zone = useZoneName();
  const money = useGame((s) => s.player.money);
  const online = useUi((s) => s.online);
  const blocked = useUi(
    (s) =>
      s.gameMode !== 'EXPLORATION' || s.inputLocked || s.modal !== null || s.dialog !== null || s.learnQueue.length > 0 || s.transition,
  );
  const claimable = useClaimableQuests();
  const open = (m: ModalId) => useUi.getState().openModal(m);

  return (
    <div className="hud">
      <div className="hud-top">
        <span className="chip">📍 {zone}</span>
        <span className="row" style={{ gap: 6 }}>
          {!online && <span className="chip offline">offline</span>}
          <span className="chip">
            {CURRENCY} {money}
          </span>
        </span>
      </div>
      {!blocked && (
        <>
          <nav className="hud-menu" aria-label="Menu gry">
            <button onClick={() => open('party')}>Drużyna</button>
            <button onClick={() => open('bag')}>Torba</button>
            <button onClick={() => open('atlas')}>Atlas</button>
            <button onClick={() => open('journal')}>Dziennik{claimable > 0 ? ` (${claimable}!)` : ''}</button>
            <button onClick={() => open('options')}>☰</button>
          </nav>
          <div className="controls">
            <Joystick />
            <ActionButtons />
          </div>
        </>
      )}
    </div>
  );
}
