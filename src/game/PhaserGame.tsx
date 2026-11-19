import * as Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { expose } from '../debug';
import { BootScene } from './scenes/BootScene';
import { OverworldScene } from './scenes/OverworldScene';

/** Kontener gry Phaser osadzony w React. Tworzy grę raz i niszczy ją przy odmontowaniu. */
export function PhaserGame() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#10201a',
      pixelArt: true,
      roundPixels: true,
      banner: false,
      disableContextMenu: true,
      input: { activePointers: 3 },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: parent.clientWidth || 360,
        height: parent.clientHeight || 640,
      },
      scene: [BootScene, OverworldScene],
    });
    expose('game', game);

    // Phaser 3.90 po zmianie orientacji odczytuje rozmiar rodzica, zanim przeglądarka przeliczy układ,
    // i zostaje o jeden obrót „w tyle”. Obserwujemy rzeczywisty rozmiar kontenera i wymuszamy przeliczenie.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!game.isBooted) return;
        const r = parent.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (Math.abs(r.width - game.scale.width) >= 1 || Math.abs(r.height - game.scale.height) >= 1) {
          game.scale.getParentBounds();
          game.scale.refresh();
        }
      });
      ro.observe(parent);
    }

    return () => {
      ro?.disconnect();
      game.destroy(true);
    };
  }, []);

  return <div ref={ref} className="phaser-root" aria-label="Mapa gry" />;
}
