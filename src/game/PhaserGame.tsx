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
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div ref={ref} className="phaser-root" aria-label="Mapa gry" />;
}
