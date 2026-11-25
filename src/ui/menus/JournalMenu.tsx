import { useShallow } from 'zustand/react/shallow';
import { ITEMS, type ItemId } from '../../config/items';
import { getLocation } from '../../game/world';
import { badgesInOrder, challengeState, getChallenge, missingRequirements } from '../../game/challenges';
import { HIDDEN_LOCATIONS } from '../../config/hiddenLocations';
import { getSpecialEncounter } from '../../game/specialEncounters';
import { QUESTS } from '../../config/quests';
import { CURRENCY } from '../../config/text';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { Modal } from '../components/common';

export function JournalMenu() {
  const d = useGame(useShallow((s) => ({ stats: s.stats, dex: s.dex, party: s.party, flags: s.flags, claimed: s.questsClaimed })));
  const player = useGame((s) => s.player);

  return (
    <Modal title="Dziennik">
      <div className="card small muted">
        Kroki: {player.steps} · Czas gry: {Math.floor(player.playTimeMs / 60000)} min · Wygrane walki: {d.stats.battlesWon} · Złapane:{' '}
        {d.stats.caught}
      </div>
      <BadgeCase />
      <DiscoveredPlaces />
      {QUESTS.map((q) => {
        const progress = Math.min(q.goal, q.progress(d));
        const done = progress >= q.goal;
        const claimed = !!d.claimed[q.id];
        const rewardItems = (Object.entries(q.reward.items) as [ItemId, number][])
          .map(([id, n]) => `${ITEMS[id].name} ×${n}`)
          .join(', ');
        return (
          <div key={q.id} className={`card quest ${claimed ? 'done' : ''}`}>
            <div className="row between">
              <b>{q.title}</b>
              <span className="muted small">
                {progress}/{q.goal}
              </span>
            </div>
            <div className="small">{q.description}</div>
            <div className="progress">
              <div style={{ width: `${(progress / q.goal) * 100}%` }} />
            </div>
            <div className="row between">
              <span className="muted small">
                Nagroda: {q.reward.money} {CURRENCY}
                {rewardItems ? `, ${rewardItems}` : ''}
              </span>
              {claimed ? (
                <span className="small" style={{ color: 'var(--accent)' }}>
                  odebrano ✓
                </span>
              ) : (
                <button
                  className="btn btn-small btn-amber"
                  disabled={!done}
                  onClick={() => {
                    if (useGame.getState().claimQuest(q.id)) useUi.getState().showToast(`Nagroda za „${q.title}” odebrana!`);
                  }}
                >
                  Odbierz
                </button>
              )}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

/** Odznaki Prób Szlaku (Sprint 6): zdobyte i do zdobycia — z miejscem Próby, wymaganiami i odblokowaniami. */
function BadgeCase() {
  const p = useGame(
    useShallow((s) => ({
      flags: s.flags,
      bag: s.bag,
      earnedBadges: s.earnedBadges,
      completedChallenges: s.completedChallenges,
      unlockedConnections: s.unlockedConnections,
    })),
  );
  const badges = badgesInOrder();
  return (
    <div className="card badge-case" aria-label="Odznaki">
      <div className="row between">
        <b>Odznaki</b>
        <span className="muted small">
          {p.earnedBadges.filter((id) => badges.some((b) => b.id === id)).length}/{badges.length}
        </span>
      </div>
      {badges.map((b) => {
        const ch = getChallenge(b.challengeId);
        const earned = p.earnedBadges.includes(b.id);
        const where = ch ? getLocation(ch.locationId)?.name : null;
        const state = ch ? challengeState(ch, p) : 'UNAVAILABLE';
        const missing = ch && state === 'LOCKED' ? missingRequirements(ch, p) : [];
        return (
          <div key={b.id} className={`badge-row ${earned ? 'earned' : 'missing'}`} data-badge={b.id}>
            <span className="badge-icon" aria-hidden="true">
              {earned ? '◆' : '◇'}
            </span>
            <div className="badge-text">
              <div>
                <b>{earned ? b.name : `${b.name} — jeszcze nie zdobyta`}</b>
              </div>
              <div className="small muted">
                {ch ? `${ch.name}${where ? ` · ${where}` : ''}` : ''}
              </div>
              {earned ? (
                b.unlockEffects.map((e) => (
                  <div key={e.connectionId} className="small">
                    Otwiera: {e.description}
                  </div>
                ))
              ) : missing.length ? (
                <div className="small">Wymagania: {missing.join(', ')}</div>
              ) : state === 'AVAILABLE' ? (
                <div className="small">Możesz podjąć Próbę.</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const RESULT_LABEL: Record<string, string> = {
  CAUGHT: 'złapane',
  DEFEATED: 'pokonane',
  ESCAPED: 'uciekłeś — wciąż czeka',
  LOST: 'przegrana — wciąż czeka',
};

/** Odkryte ukryte lokacje (Sprint 7) — tylko odkryte i widoczne po odkryciu; ze stanem spotkań specjalnych. */
function DiscoveredPlaces() {
  const p = useGame(useShallow((s) => ({ flags: s.flags, records: s.specialEncounters })));
  const found = HIDDEN_LOCATIONS.filter((h) => h.visibleAfterDiscovery && p.flags[h.discoveryEventId]);
  if (!found.length) return null;
  return (
    <div className="card badge-case" aria-label="Odkryte miejsca">
      <b>Odkryte miejsca</b>
      {found.map((h) => (
        <div key={h.id} className="badge-row earned" data-hidden={h.id}>
          <span className="badge-icon" aria-hidden="true">
            ✦
          </span>
          <div className="badge-text">
            <div>
              <b>{getLocation(h.id)?.name ?? h.id}</b>
            </div>
            <div className="small muted">Wejście: {getLocation(h.parentLocationId)?.name ?? h.parentLocationId}</div>
            {h.specialEncounterIds.map((id) => {
              const def = getSpecialEncounter(id);
              if (!def) return null;
              const rec = p.records[id];
              const done = !!p.flags[def.completionEventId];
              const label = rec ? RESULT_LABEL[rec.result] : done ? 'ukończone' : 'jeszcze nie spotkane';
              return (
                <div key={id} className="small" data-special={id}>
                  {def.name}: {label}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
