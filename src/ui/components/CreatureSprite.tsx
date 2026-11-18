import { useEffect, useRef, useState } from 'react';
import { TYPE_COLOR } from '../../config/text';
import type { SpriteSet } from '../../engine/types';
import { drawBlob } from '../../game/art';
import { useGame } from '../../state/gameStore';

interface Candidate {
  url: string;
  mirror: boolean;
}

/** Kolejność prób: animowany → statyczny; tył → (awaryjnie) przód w lustrzanym odbiciu. */
export function spriteCandidates(
  sprites: SpriteSet | null | undefined,
  facing: 'front' | 'back',
  shiny: boolean,
  animated: boolean,
): Candidate[] {
  if (!sprites) return [];
  const front = [
    animated && shiny ? sprites.animFrontShiny : null,
    animated ? sprites.animFront : null,
    shiny ? sprites.frontShiny : null,
    sprites.front,
  ];
  const back = [
    animated && shiny ? sprites.animBackShiny : null,
    animated ? sprites.animBack : null,
    shiny ? sprites.backShiny : null,
    sprites.back,
  ];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (list: (string | null)[], mirror: boolean) => {
    for (const url of list) {
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({ url, mirror });
      }
    }
  };
  if (facing === 'back') {
    add(back, false);
    add(front, true);
  } else {
    add(front, false);
  }
  return out;
}

/** Oryginalna sylwetka zastępcza (pikselowa, w kolorze typu). */
export function BlobSprite({ type, size = 80, back = false }: { type: string; size?: number; back?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 32);
    drawBlob(ctx, TYPE_COLOR[type] ?? '#9a9a86', 0, 0, back);
  }, [type, back]);
  return <canvas ref={ref} width={32} height={32} className="sprite-img" style={{ width: size, height: size }} aria-hidden />;
}

interface Props {
  sprites?: SpriteSet | null;
  shiny?: boolean;
  types: readonly string[];
  name: string;
  facing?: 'front' | 'back';
  animated?: boolean;
  /** Mnożnik naturalnego rozmiaru obrazka (pikselowe sprite'y wyglądają najlepiej w wielokrotnościach). */
  scale?: number;
  /** Maksymalna szerokość w px. */
  maxSize?: number;
  /** Rozmiar sylwetki zastępczej. */
  fallbackSize?: number;
}

export function CreatureSprite(props: Props) {
  const useApi = useGame((s) => s.settings.useApiSprites);
  const candidates = useApi ? spriteCandidates(props.sprites, props.facing ?? 'front', !!props.shiny, props.animated ?? false) : [];
  return <SpriteImg key={candidates.map((c) => c.url).join('|') || 'blob'} candidates={candidates} {...props} />;
}

function SpriteImg({ candidates, types, name, facing, scale = 1, maxSize, fallbackSize }: Props & { candidates: Candidate[] }) {
  const [idx, setIdx] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const c = candidates[idx];
  if (!c) return <BlobSprite type={types[0] ?? 'normal'} size={fallbackSize ?? maxSize ?? 80} back={facing === 'back'} />;
  const width = natural ? Math.min(natural.w * scale, maxSize ?? Infinity) : undefined;
  return (
    <img
      className="sprite-img"
      src={c.url}
      alt={name}
      draggable={false}
      style={{
        width,
        height: 'auto',
        // opacity zamiast visibility — ukrywanie rodzica (.is-hidden) musi działać także na obrazek
        opacity: natural ? 1 : 0,
        transform: c.mirror ? 'scaleX(-1)' : undefined,
      }}
      onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onError={() => {
        setNatural(null);
        setIdx((i) => i + 1);
      }}
    />
  );
}
