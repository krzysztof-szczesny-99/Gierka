import * as Phaser from 'phaser';
import { TYPE_NAMES } from '../../engine/types';
import { createHeroTextures, createTileset, ensureBlobTexture } from '../textures';

/** Generuje wszystkie proceduralne tekstury i uruchamia scenę eksploracji. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    createTileset(this);
    createHeroTextures(this);
    for (const t of TYPE_NAMES) ensureBlobTexture(this, t);
    this.scene.start('Overworld');
  }
}
