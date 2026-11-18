import { useEffect, useState } from 'react';
import { RULES } from '../../config/rules';
import { STAT_LABEL, TYPE_COLOR, prettySlug, typeLabel } from '../../config/text';
import { getGrowth } from '../../data/repository';
import { displayName } from '../../engine/creature';
import { expForLevel, expProgress } from '../../engine/experience';
import { STAT_KEYS, type Creature, type GrowthTable } from '../../engine/types';
import { loadMovesSafe } from '../../services/creatureService';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { ExpBar, GenderMark, HpBar, Modal, StatusBadge, TypeBadges, usePokemonData } from '../components/common';
import { CreatureSprite } from '../components/CreatureSprite';

export function PartyMenu() {
  const party = useGame((s) => s.party);
  const storage = useGame((s) => s.storage);
  const [tab, setTab] = useState<'party' | 'storage'>('party');
  const [open, setOpen] = useState<string | null>(null);
  const list = tab === 'party' ? party : storage;

  return (
    <Modal title="Drużyna">
      <div className="tabs">
        <button className={tab === 'party' ? 'on' : ''} onClick={() => setTab('party')}>
          Drużyna {party.length}/{RULES.maxPartySize}
        </button>
        <button className={tab === 'storage' ? 'on' : ''} onClick={() => setTab('storage')}>
          Magazyn {storage.length}
        </button>
      </div>
      {list.length === 0 && <div className="muted small">Pusto. Złapane stworzenia trafiają tu, gdy drużyna jest pełna.</div>}
      {list.map((c, i) => (
        <div key={c.uid} className="stack" style={{ gap: 6 }}>
          <CreatureRow c={c} lead={tab === 'party' && i === 0} onClick={() => setOpen(open === c.uid ? null : c.uid)} />
          {open === c.uid && <CreatureDetail c={c} index={i} where={tab} />}
        </div>
      ))}
    </Modal>
  );
}

export function CreatureRow({ c, lead, onClick, disabled }: { c: Creature; lead?: boolean; onClick?: () => void; disabled?: boolean }) {
  const data = usePokemonData(c.pokemon);
  return (
    <button className={`creature-row ${lead ? 'lead' : ''} ${c.hp <= 0 ? 'fainted' : ''}`} onClick={onClick} disabled={disabled}>
      <div className="sprite-box" style={{ height: 56 }}>
        <CreatureSprite sprites={data?.sprites} shiny={c.shiny} types={c.types} name={c.name} scale={0.6} maxSize={56} fallbackSize={48} />
      </div>
      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.shiny ? '✦ ' : ''}
            {displayName(c)}
          </b>
          <GenderMark gender={c.gender} />
          <StatusBadge status={c.status} />
        </div>
        <HpBar hp={c.hp} max={c.stats.hp} />
        <TypeBadges types={c.types} />
      </div>
      <div className="stack small" style={{ alignItems: 'flex-end', gap: 2 }}>
        <span>Poz. {c.level}</span>
        <span className="muted">
          {c.hp}/{c.stats.hp}
        </span>
        {lead && <span style={{ color: 'var(--accent)' }}>prowadzi</span>}
      </div>
    </button>
  );
}

function CreatureDetail({ c, index, where }: { c: Creature; index: number; where: 'party' | 'storage' }) {
  const [growth, setGrowth] = useState<GrowthTable | null>(null);
  const [moveInfo, setMoveInfo] = useState<Record<string, { type: string; name: string }>>({});

  useEffect(() => {
    let alive = true;
    getGrowth(c.growthRate)
      .then((g) => alive && setGrowth(g))
      .catch(() => undefined);
    loadMovesSafe(c.moves.map((m) => m.name)).then((map) => {
      if (!alive) return;
      const info: Record<string, { type: string; name: string }> = {};
      for (const [k, m] of Object.entries(map)) info[k] = { type: m.type, name: m.displayName };
      setMoveInfo(info);
    });
    return () => {
      alive = false;
    };
  }, [c.growthRate, c.moves]);

  const toast = (t: string) => useUi.getState().showToast(t);
  return (
    <div className="detail">
      {growth && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row between small muted">
            <span>Doświadczenie</span>
            <span>
              {c.level >= RULES.maxLevel ? 'maks.' : `${Math.max(0, expForLevel(growth, c.level + 1) - c.exp)} do poz. ${c.level + 1}`}
            </span>
          </div>
          <ExpBar progress={expProgress(growth, c.level, c.exp)} />
        </div>
      )}
      <div className="stat-grid">
        {STAT_KEYS.map((k) => (
          <div key={k}>
            <span className="muted">{STAT_LABEL[k]}</span>
            <b>{c.stats[k]}</b>
          </div>
        ))}
      </div>
      <div className="move-list">
        {c.moves.map((m) => {
          const info = moveInfo[m.name];
          return (
            <div key={m.name} className="move-chip" style={{ borderLeftColor: TYPE_COLOR[info?.type ?? ''] ?? 'var(--line)' }}>
              <b>{info?.name ?? prettySlug(m.name)}</b>
              <div className="muted small">
                {info ? typeLabel(info.type) : '—'} · PP {m.pp}/{m.maxPp}
              </div>
            </div>
          );
        })}
      </div>
      <div className="small muted">
        Zdolność: {prettySlug(c.ability)} (działanie w kolejnym etapie) · Spotkany: {c.metAt}, poz. {c.metLevel}
        {c.mighty ? ' · Potężny okaz' : ''}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {where === 'party' && index > 0 && (
          <button className="btn btn-small" onClick={() => useGame.getState().setLead(index)}>
            Ustaw jako prowadzącego
          </button>
        )}
        {where === 'party' && (
          <button
            className="btn btn-small"
            onClick={() => (useGame.getState().moveToStorage(index) ? toast('Przeniesiono do magazynu.') : toast('W drużynie musi zostać co najmniej jedno stworzenie.'))}
          >
            Do magazynu
          </button>
        )}
        {where === 'storage' && (
          <button
            className="btn btn-small btn-primary"
            onClick={() => (useGame.getState().moveToParty(index) ? toast('Dołączono do drużyny.') : toast('Drużyna jest pełna (maks. 6).'))}
          >
            Do drużyny
          </button>
        )}
      </div>
    </div>
  );
}
