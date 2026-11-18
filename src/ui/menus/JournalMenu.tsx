import { useShallow } from 'zustand/react/shallow';
import { ITEMS, type ItemId } from '../../config/items';
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
