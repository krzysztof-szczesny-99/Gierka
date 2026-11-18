import { useEffect, useRef, useState } from 'react';
import { ITEMS, type ItemId } from '../../config/items';
import { TYPE_COLOR, prettySlug, typeLabel } from '../../config/text';
import { getActive } from '../../engine/battle/battleEngine';
import { catchProbability } from '../../engine/battle/catch';
import type { SideIndex } from '../../engine/battle/types';
import { displayName } from '../../engine/creature';
import { expProgress } from '../../engine/experience';
import { effectiveness } from '../../engine/typeChart';
import type { GrowthTable, PokemonData } from '../../engine/types';
import { finishBattle } from '../../services/encounterService';
import { useBattle, type AnimKind, type ViewCreature } from '../../state/battleStore';
import { useGame } from '../../state/gameStore';
import { CapsuleIcon, ExpBar, GenderMark, HpBar, StatusBadge, TypeBadges } from '../components/common';
import { CreatureSprite } from '../components/CreatureSprite';

const CLASS_SHORT: Record<string, string> = { physical: 'fiz.', special: 'spec.', status: 'status' };

function keyframesFor(kind: AnimKind, side: SideIndex): [Keyframe[], KeyframeAnimationOptions] {
  switch (kind) {
    case 'enter':
      return [
        [
          { transform: 'translateY(14px) scale(0.6)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 400, easing: 'ease-out' },
      ];
    case 'attack': {
      const t = side === 1 ? 'translate(-18px, 8px)' : 'translate(18px, -8px)';
      return [[{ transform: 'none' }, { transform: t, offset: 0.4 }, { transform: 'none' }], { duration: 300, easing: 'ease-out' }];
    }
    case 'hit':
      return [[{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }], { duration: 500 }];
    case 'faint':
      return [
        [
          { transform: 'none', opacity: 1 },
          { transform: 'translateY(40px)', opacity: 0 },
        ],
        { duration: 600, easing: 'ease-in', fill: 'forwards' },
      ];
    case 'withdraw':
      return [
        [
          { transform: 'none', opacity: 1 },
          { transform: 'scale(0.2)', opacity: 0 },
        ],
        { duration: 350, easing: 'ease-in', fill: 'forwards' },
      ];
    case 'boost-up':
      return [
        [{ filter: 'none' }, { filter: 'brightness(1.6) drop-shadow(0 -6px 6px rgba(79,209,165,0.8))' }, { filter: 'none' }],
        { duration: 420 },
      ];
    case 'boost-down':
      return [
        [{ filter: 'none' }, { filter: 'brightness(0.6) drop-shadow(0 6px 6px rgba(80,120,255,0.8))' }, { filter: 'none' }],
        { duration: 420 },
      ];
  }
}

function Combatant({
  side,
  c,
  anim,
  hidden,
  data,
}: {
  side: SideIndex;
  c: ViewCreature;
  anim?: { kind: AnimKind; key: number };
  hidden: boolean;
  data?: PokemonData;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !anim || typeof el.animate !== 'function') return;
    el.getAnimations().forEach((a) => a.cancel());
    const [frames, opts] = keyframesFor(anim.kind, side);
    el.animate(frames, opts);
  }, [anim?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`combatant ${side === 1 ? 'enemy' : 'player'} ${c.mighty ? 'mighty' : ''}`}>
      <div ref={ref} className={`sprite-wrap ${hidden ? 'is-hidden' : ''}`}>
        <CreatureSprite
          sprites={data?.sprites}
          shiny={c.shiny}
          types={c.types}
          name={c.name}
          facing={side === 1 ? 'front' : 'back'}
          animated
          scale={side === 1 ? 2 : 2.3}
          maxSize={side === 1 ? 190 : 230}
          fallbackSize={side === 1 ? 120 : 150}
        />
      </div>
    </div>
  );
}

function InfoCard({ side, c, growth }: { side: SideIndex; c: ViewCreature; growth?: GrowthTable }) {
  return (
    <div className={`info-card ${side === 1 ? 'enemy' : 'player'}`}>
      <div className="row between">
        <span className="name">
          {c.mighty && side === 1 ? '★ ' : ''}
          {c.name}
          <GenderMark gender={c.gender} />
        </span>
        <span className="lv">Poz. {c.level}</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <StatusBadge status={c.status} />
        <div style={{ flex: 1 }}>
          <HpBar hp={c.hp} max={c.maxHp} />
        </div>
      </div>
      {side === 0 && (
        <>
          <div className="hpnum">
            {c.hp} / {c.maxHp} PŻ
          </div>
          {growth && <ExpBar progress={expProgress(growth, c.level, c.exp)} />}
        </>
      )}
    </div>
  );
}

export function BattleScreen() {
  const view = useBattle((s) => s.view);
  const engine = useBattle((s) => s.engine);
  if (!view || !engine) return null;
  const enemyUid = view.active[1];
  const playerUid = view.active[0];
  const enemy = enemyUid ? view.creatures[enemyUid] : null;
  const player = playerUid ? view.creatures[playerUid] : null;
  const skip = () => useBattle.getState().skip();

  return (
    <div className="battle">
      <div className="arena" onClick={skip}>
        <div className="platform enemy" />
        <div className="platform player" />
        {enemy && (
          <Combatant
            key={enemy.uid}
            side={1}
            c={enemy}
            anim={view.anim[enemy.uid]}
            hidden={!!view.hidden[enemy.uid]}
            data={engine.pokemon[enemy.pokemon]}
          />
        )}
        {player && (
          <Combatant
            key={player.uid}
            side={0}
            c={player}
            anim={view.anim[player.uid]}
            hidden={!!view.hidden[player.uid]}
            data={engine.pokemon[player.pokemon]}
          />
        )}
        {view.capsule && (
          <div className={`capsule-anim ${view.capsule.phase}`} key={`${view.capsule.phase}-${view.capsule.shake}`}>
            <CapsuleIcon plus={view.capsule.item === 'capsule-plus'} />
          </div>
        )}
        {enemy && <InfoCard side={1} c={enemy} />}
        {player && <InfoCard side={0} c={player} growth={engine.growth[player.growthRate]} />}
      </div>
      <div className="battle-ui">
        <div className="msgbox" onClick={skip} aria-live="polite">
          {view.message || ' '}
        </div>
        <Commands />
      </div>
    </div>
  );
}

function Commands() {
  const phase = useBattle((s) => s.phase);
  const menu = useBattle((s) => s.menu);
  const setMenu = useBattle((s) => s.setMenu);

  if (phase === 'ended') {
    return (
      <button className="btn btn-primary btn-block" style={{ minHeight: 58 }} onClick={() => void finishBattle()}>
        Dalej
      </button>
    );
  }
  if (phase === 'forcedSwitch') return <PartyPicker forced />;
  if (phase !== 'choose') {
    return (
      <div className="cmd-grid" style={{ visibility: 'hidden' }} aria-hidden>
        <button className="btn">.</button>
        <button className="btn">.</button>
        <button className="btn">.</button>
        <button className="btn">.</button>
      </div>
    );
  }
  if (menu === 'fight') return <FightMenu />;
  if (menu === 'bag') return <BattleBag />;
  if (menu === 'party') return <PartyPicker />;
  return (
    <div className="cmd-grid">
      <button className="btn cmd-fight" onClick={() => setMenu('fight')}>
        Walcz
      </button>
      <button className="btn cmd-bag" onClick={() => setMenu('bag')}>
        Torba
      </button>
      <button className="btn cmd-party" onClick={() => setMenu('party')}>
        Drużyna
      </button>
      <RunButton />
    </div>
  );
}

function RunButton() {
  const engine = useBattle((s) => s.engine);
  const canRun = engine?.sides[1].kind === 'wild';
  return (
    <button className="btn cmd-run" disabled={!canRun} onClick={() => useBattle.getState().submit({ kind: 'run' })}>
      Ucieczka
    </button>
  );
}

function BackButton() {
  return (
    <button className="btn btn-small" onClick={() => useBattle.getState().setMenu('root')}>
      ← Wróć
    </button>
  );
}

function FightMenu() {
  const engine = useBattle((s) => s.engine)!;
  const me = getActive(engine, 0);
  const foe = getActive(engine, 1);
  if (!me) return null;
  const noPp = me.moves.every((m) => m.pp <= 0);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="cmd-grid">
        {noPp ? (
          <button className="move-btn" style={{ background: TYPE_COLOR.normal }} onClick={() => useBattle.getState().submit({ kind: 'move', moveIndex: 0 })}>
            <span className="mname">Szamotanina</span>
            <span className="mmeta">brak PP — ruch awaryjny</span>
          </button>
        ) : (
          me.moves.map((slot, i) => {
            const m = engine.moves[slot.name];
            const type = m?.type ?? 'normal';
            const eff = m && foe && m.damageClass !== 'status' ? effectiveness(engine.typeChart, type, foe.types) : 1;
            const hint = eff === 0 ? 'brak efektu' : eff > 1 ? 'skuteczny!' : eff < 1 ? 'słaby' : '';
            return (
              <button
                key={slot.name}
                className="move-btn"
                style={{ background: TYPE_COLOR[type] ?? '#777' }}
                disabled={slot.pp <= 0}
                onClick={() => useBattle.getState().submit({ kind: 'move', moveIndex: i })}
              >
                <span className="mname">{m?.displayName ?? prettySlug(slot.name)}</span>
                <span className="mmeta">
                  <span>
                    {typeLabel(type)} · {CLASS_SHORT[m?.damageClass ?? 'physical']}
                    {hint ? ` · ${hint}` : ''}
                  </span>
                  <span>
                    {slot.pp}/{slot.maxPp}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
      <BackButton />
    </div>
  );
}

function BattleBag() {
  const engine = useBattle((s) => s.engine)!;
  const bag = useGame((s) => s.bag);
  const [pending, setPending] = useState<ItemId | null>(null);
  const foe = getActive(engine, 1);
  const wild = engine.sides[1].kind === 'wild';
  const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => (bag[id] ?? 0) > 0 && ITEMS[id].usableInBattle);

  if (pending) {
    const def = ITEMS[pending];
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="muted small">Na kim użyć: {def.name}?</div>
        <div className="sublist">
          {engine.sides[0].party.map((c) => {
            const ok = def.kind === 'heal' ? c.hp > 0 && c.hp < c.stats.hp : c.hp > 0 && !!c.status;
            return (
              <button
                key={c.uid}
                className="creature-row"
                style={{ gridTemplateColumns: '1fr auto', minHeight: 56 }}
                disabled={!ok}
                onClick={() => useBattle.getState().submit({ kind: 'item', item: pending, targetUid: c.uid })}
              >
                <span>
                  <b>{displayName(c)}</b> <span className="muted small">Poz. {c.level}</span>
                  <HpBar hp={c.hp} max={c.stats.hp} />
                </span>
                <span className="small muted">
                  {c.hp}/{c.stats.hp} <StatusBadge status={c.status} />
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-small" onClick={() => setPending(null)}>
          ← Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="sublist">
        {items.length === 0 && <div className="muted small">Torba jest pusta.</div>}
        {items.map((id) => {
          const def = ITEMS[id];
          const disabled = def.kind === 'capture' && !wild;
          let hint = '';
          if (def.kind === 'capture' && foe && wild) {
            const p = catchProbability({
              maxHp: foe.stats.hp,
              hp: foe.hp,
              captureRate: engine.captureRate,
              catchBonus: def.catchBonus ?? 1,
              status: foe.status,
            });
            hint = `szansa ok. ${Math.round(p * 100)}%`;
          }
          return (
            <button
              key={id}
              className="btn btn-block"
              style={{ justifyContent: 'space-between' }}
              disabled={disabled}
              onClick={() =>
                def.kind === 'capture' ? useBattle.getState().submit({ kind: 'item', item: id }) : setPending(id)
              }
            >
              <span className="row" style={{ gap: 8 }}>
                {def.kind === 'capture' && <CapsuleIcon size={18} plus={id === 'capsule-plus'} />}
                {def.name}
                {hint && <span className="muted small">({hint})</span>}
              </span>
              <span className="muted">×{bag[id]}</span>
            </button>
          );
        })}
      </div>
      <BackButton />
    </div>
  );
}

function PartyPicker({ forced = false }: { forced?: boolean }) {
  const engine = useBattle((s) => s.engine)!;
  const side = engine.sides[0];
  const activeIdx = side.active[0];
  return (
    <div className="stack" style={{ gap: 8 }}>
      {forced && <div className="small">Wybierz następne stworzenie:</div>}
      <div className="sublist">
        {side.party.map((c, i) => (
          <button
            key={c.uid}
            className={`creature-row ${c.hp <= 0 ? 'fainted' : ''} ${i === activeIdx ? 'lead' : ''}`}
            style={{ gridTemplateColumns: '1fr auto', minHeight: 58 }}
            disabled={c.hp <= 0 || i === activeIdx}
            onClick={() => useBattle.getState().chooseSwitch(i)}
          >
            <span className="stack" style={{ gap: 4 }}>
              <span>
                <b>{displayName(c)}</b> <span className="muted small">Poz. {c.level}</span>{' '}
                {i === activeIdx && <span className="muted small">(w walce)</span>}
              </span>
              <HpBar hp={c.hp} max={c.stats.hp} />
            </span>
            <span className="stack small muted" style={{ alignItems: 'flex-end', gap: 4 }}>
              {c.hp}/{c.stats.hp}
              <span className="row" style={{ gap: 4 }}>
                <StatusBadge status={c.status} />
                <TypeBadges types={c.types} />
              </span>
            </span>
          </button>
        ))}
      </div>
      {!forced && <BackButton />}
    </div>
  );
}
