import { useEffect, useState } from 'react';
import { abilityDef } from '../../config/abilities';
import { HELD_ITEM_IDS, ITEMS, isHeldItemId } from '../../config/items';
import { NATURES } from '../../config/natures';
import { RULES } from '../../config/rules';
import { STAT_LABEL, TYPE_COLOR, prettySlug, typeLabel } from '../../config/text';
import { getGrowth } from '../../data/repository';
import { displayName } from '../../engine/creature';
import { expForLevel, expProgress } from '../../engine/experience';
import { STAT_KEYS, type Creature, type GrowthTable } from '../../engine/types';
import { loadMovesSafe } from '../../services/creatureService';
import { evolutionInfo, itemEvolutionFor, levelEvolutionFor, type EvolutionInfo } from '../../services/evolutionService';
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
  const nature = NATURES[c.nature];
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
        {STAT_KEYS.map((k) => {
          const up = nature?.increased === k;
          const down = nature?.decreased === k;
          return (
            <div key={k} data-testid={`stat-${k}`}>
              <span className="muted">
                {STAT_LABEL[k]}
                {up && <span className="nature-up"> ▲</span>}
                {down && <span className="nature-down"> ▼</span>}
              </span>
              <b>{c.stats[k]}</b>
            </div>
          );
        })}
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
      <div className="stack small" style={{ gap: 4 }}>
        <div data-testid="creature-nature">
          <span className="muted">Natura:</span> <b>{nature?.name ?? c.nature}</b>{' '}
          <span className="muted">
            {nature?.increased && nature.decreased
              ? `(+10% ${STAT_LABEL[nature.increased]}, −10% ${STAT_LABEL[nature.decreased]})`
              : '(neutralna)'}
          </span>
        </div>
        <AbilityLine abilityId={c.abilityId} />
        <HeldItemLine c={c} />
        <EvolutionSection c={c} />
        <div className="muted">
          Spotkany: {c.metAt}, poz. {c.metLevel}
          {c.mighty ? ' · Potężny okaz' : ''}
        </div>
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

function AbilityLine({ abilityId }: { abilityId: string }) {
  const def = abilityDef(abilityId);
  return (
    <div data-testid="creature-ability">
      <span className="muted">Zdolność:</span>{' '}
      {def ? (
        <>
          <b>{def.name}</b> <span className="muted">— {def.description}</span>
        </>
      ) : (
        <>
          <b>{prettySlug(abilityId)}</b> <span className="muted">(jeszcze nie działa w grze)</span>
        </>
      )}
    </div>
  );
}

/** Przedmiot trzymany: założenie z torby (1 sztuka) i zdjęcie (wraca do torby). */
function HeldItemLine({ c }: { c: Creature }) {
  const bag = useGame((s) => s.bag);
  const [picking, setPicking] = useState(false);
  const held = isHeldItemId(c.heldItemId) ? ITEMS[c.heldItemId] : null;
  const available = HELD_ITEM_IDS.filter((id) => (bag[id] ?? 0) > 0);
  const toast = (t: string) => useUi.getState().showToast(t);
  return (
    <div className="stack" style={{ gap: 4 }} data-testid="creature-held">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="muted">Przedmiot:</span>
        {held ? <b>{held.name}</b> : <span>brak</span>}
        {held && (
          <button
            className="btn btn-small"
            onClick={() => {
              if (useGame.getState().unequipItem(c.uid)) toast(`${held.name} wraca do torby.`);
            }}
          >
            Zdejmij
          </button>
        )}
        <button className="btn btn-small" onClick={() => setPicking(!picking)} disabled={!available.length && !picking}>
          {held ? 'Zmień' : 'Załóż'}
        </button>
      </div>
      {held && <div className="muted">{held.description}</div>}
      {picking && (
        <div className="stack" style={{ gap: 4 }}>
          {available.length === 0 && <div className="muted">Brak przedmiotów do trzymania w torbie (kupisz je w Kramie).</div>}
          {available.map((id) => (
            <button
              key={id}
              className="btn btn-small btn-block"
              style={{ justifyContent: 'space-between' }}
              onClick={() => {
                const err = useGame.getState().equipItem(c.uid, id);
                toast(err ?? `${displayName(c)} trzyma: ${ITEMS[id].name}.`);
                setPicking(false);
              }}
            >
              <span>{ITEMS[id].name}</span>
              <span className="muted">×{bag[id]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Drogi ewolucji i stan warunków (dane z bufora — pobierane raz, przy rozwinięciu szczegółów). */
function EvolutionSection({ c }: { c: Creature }) {
  const bag = useGame((s) => s.bag);
  const [info, setInfo] = useState<EvolutionInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    evolutionInfo(c)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [c]);

  const offerLevel = async () => {
    const req = await levelEvolutionFor(c, true).catch(() => null);
    if (req) useUi.getState().pushEvolutions([req]);
    else useUi.getState().showToast('Warunek ewolucji nie jest spełniony.');
  };
  const offerItem = async (itemId: Parameters<typeof itemEvolutionFor>[1]) => {
    const req = await itemEvolutionFor(c, itemId).catch(() => null);
    if (req) useUi.getState().pushEvolutions([req]);
  };

  if (error) return <div className="muted">Ewolucja: brak danych (połącz się z siecią, aby je pobrać).</div>;
  if (!info) return <div className="muted">Ewolucja: wczytywanie…</div>;
  if (!info.checks.length) return <div className="muted" data-testid="creature-evolution">Ewolucja: brak dalszych ewolucji.</div>;
  return (
    <div className="stack" style={{ gap: 4 }} data-testid="creature-evolution">
      {info.checks.map((x, i) => {
        const target = prettySlug(x.option.to);
        if (x.status === 'READY')
          return (
            <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span>
                Ewolucja → <b>{target}</b>: {x.condition} <span className="nature-up">✓ warunek spełniony</span>
              </span>
              <button className="btn btn-small btn-primary" onClick={() => void offerLevel()}>
                Ewoluuj
              </button>
            </div>
          );
        if (x.status === 'WAITING')
          return (
            <div key={i}>
              Ewolucja → <b>{target}</b>: {x.condition} <span className="muted">(brakuje {(x.option.minLevel ?? 0) - c.level} poz.)</span>
            </div>
          );
        if (x.status === 'NEEDS_ITEM' && x.itemId) {
          const have = bag[x.itemId] ?? 0;
          return (
            <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span>
                Ewolucja → <b>{target}</b>: przedmiot {ITEMS[x.itemId].name} <span className="muted">(masz: {have})</span>
              </span>
              {have > 0 && (
                <button className="btn btn-small btn-primary" onClick={() => void offerItem(x.itemId!)}>
                  Użyj kamienia
                </button>
              )}
            </div>
          );
        }
        return (
          <div key={i} className="muted">
            Ewolucja → <b>{target}</b>: {x.condition} (NOT_IMPLEMENTED)
          </div>
        );
      })}
    </div>
  );
}
