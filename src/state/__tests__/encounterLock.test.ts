import { beforeEach, describe, expect, it } from 'vitest';
import { isOverworldBlocked, useUi } from '../uiStore';

function resetUi() {
  useUi.setState({
    mode: 'overworld',
    modal: null,
    dialog: null,
    transition: false,
    learnQueue: [],
    gameMode: 'EXPLORATION',
    activeEncounterId: null,
    sourceEntityId: null,
    inputLocked: false,
    encounterCooldown: 0,
    lastEncounter: null,
  });
}

beforeEach(resetUi);

describe('centralna blokada spotkań', () => {
  it('tryStartEncounter przejmuje blokadę atomowo: ENCOUNTER_STARTING, id, źródło, blokada wejścia', () => {
    const id = useUi.getState().tryStartEncounter('wild-1', 1000);
    expect(id).not.toBeNull();
    const s = useUi.getState();
    expect(s.gameMode).toBe('ENCOUNTER_STARTING');
    expect(s.activeEncounterId).toBe(id);
    expect(s.sourceEntityId).toBe('wild-1');
    expect(s.inputLocked).toBe(true);
    expect(isOverworldBlocked()).toBe(true);
  });

  it('dwa triggery w tej samej klatce: tylko pierwszy dostaje spotkanie', () => {
    const ui = useUi.getState();
    const a = ui.tryStartEncounter('wild-1', 1000);
    const b = ui.tryStartEncounter('wild-2', 1000);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(useUi.getState().sourceEntityId).toBe('wild-1');
  });

  it('wielokrotne wywołanie tego samego triggera nie tworzy drugiego spotkania', () => {
    const ui = useUi.getState();
    const a = ui.tryStartEncounter('wild-1', 1000);
    for (let i = 0; i < 10; i++) expect(useUi.getState().tryStartEncounter('wild-1', 1000 + i)).toBeNull();
    expect(useUi.getState().activeEncounterId).toBe(a);
  });

  it('w trakcie walki i kończenia nie można rozpocząć nowego spotkania', () => {
    const ui = useUi.getState();
    const id = ui.tryStartEncounter('wild-1', 0)!;
    expect(ui.confirmBattle(id)).toBe(true);
    expect(useUi.getState().gameMode).toBe('BATTLE');
    expect(useUi.getState().tryStartEncounter('wild-2', 0)).toBeNull();
    expect(useUi.getState().beginEncounterEnd(id)).toBe(true);
    expect(useUi.getState().gameMode).toBe('ENCOUNTER_ENDING');
    expect(useUi.getState().tryStartEncounter('wild-2', 0)).toBeNull();
  });

  it('zakończenie przejmowane jest dokładnie raz', () => {
    const ui = useUi.getState();
    const id = ui.tryStartEncounter('wild-1', 0)!;
    ui.confirmBattle(id);
    expect(useUi.getState().beginEncounterEnd(id)).toBe(true);
    expect(useUi.getState().beginEncounterEnd(id)).toBe(false);
    expect(useUi.getState().beginEncounterEnd('enc-obce')).toBe(false);
  });

  it('obce lub przestarzałe identyfikatory nie zmieniają stanu', () => {
    const ui = useUi.getState();
    const id = ui.tryStartEncounter('wild-1', 0)!;
    expect(ui.confirmBattle('enc-obce')).toBe(false);
    expect(ui.beginEncounterEnd('enc-obce')).toBe(false);
    expect(ui.releaseEncounter('enc-obce', 'cancel', 'ui-closed')).toBe(false);
    expect(useUi.getState().activeEncounterId).toBe(id);
    expect(useUi.getState().gameMode).toBe('ENCOUNTER_STARTING');
  });

  it('pełny cykl: ENDING → zwolnienie → odnowienie → EXPLORATION i odblokowanie wejścia', () => {
    const ui = useUi.getState();
    const id = ui.tryStartEncounter('wild-1', 0)!;
    ui.confirmBattle(id);
    ui.beginEncounterEnd(id);
    expect(useUi.getState().enterExploration()).toBe(false); // spotkanie jeszcze nie zwolnione
    expect(useUi.getState().releaseEncounter(id, 'win', 'result')).toBe(true);
    expect(useUi.getState().activeEncounterId).toBeNull();
    expect(useUi.getState().gameMode).toBe('ENCOUNTER_ENDING');
    useUi.getState().setEncounterCooldown(5000);
    expect(useUi.getState().enterExploration()).toBe(true);
    const s = useUi.getState();
    expect(s.gameMode).toBe('EXPLORATION');
    expect(s.inputLocked).toBe(false);
    expect(s.lastEncounter).toEqual({ id, sourceEntityId: 'wild-1', outcome: 'win', reason: 'result' });
    expect(isOverworldBlocked()).toBe(false);
  });

  it('odnowienie blokuje nowe spotkanie do upływu czasu', () => {
    useUi.setState({ encounterCooldown: 5000 });
    expect(useUi.getState().tryStartEncounter('wild-1', 4999)).toBeNull();
    expect(useUi.getState().tryStartEncounter('wild-1', 5000)).not.toBeNull();
  });

  it('spotkanie nie startuje poza mapą ani przy otwartym oknie, dialogu lub przejściu', () => {
    useUi.setState({ mode: 'battle' });
    expect(useUi.getState().tryStartEncounter('a', 0)).toBeNull();
    resetUi();
    useUi.setState({ modal: 'bag' });
    expect(useUi.getState().tryStartEncounter('a', 0)).toBeNull();
    resetUi();
    useUi.setState({ dialog: { lines: ['x'], index: 0 } });
    expect(useUi.getState().tryStartEncounter('a', 0)).toBeNull();
    resetUi();
    useUi.setState({ transition: true });
    expect(useUi.getState().tryStartEncounter('a', 0)).toBeNull();
    resetUi();
    expect(useUi.getState().tryStartEncounter('a', 0)).not.toBeNull();
  });
});
