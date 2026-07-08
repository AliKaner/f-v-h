// Spritesheet yukleyici — 100x100 frame'li yatay seritler (Aseprite export)

export const FRAME_SIZE = 100;

export type AnimName = "Idle" | "Walk" | "Attack01" | "Hurt" | "Death";

export interface SpriteSet {
  anims: Map<AnimName, { image: HTMLImageElement; frames: number }>;
}

const cache = new Map<string, SpriteSet>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadCreatureSprites(spriteId: string): Promise<SpriteSet> {
  const cached = cache.get(spriteId);
  if (cached) return cached;

  const names: AnimName[] = ["Idle", "Walk", "Attack01", "Hurt", "Death"];
  const anims = new Map<AnimName, { image: HTMLImageElement; frames: number }>();

  await Promise.all(
    names.map(async (name) => {
      try {
        const image = await loadImage(`/assets/creatures/${spriteId}/${name}.png`);
        anims.set(name, { image, frames: Math.max(1, Math.floor(image.width / FRAME_SIZE)) });
      } catch {
        // eksik animasyon — Idle'a geri duser
      }
    }),
  );

  const set = { anims };
  cache.set(spriteId, set);
  return set;
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  set: SpriteSet | undefined,
  anim: AnimName,
  animTime: number,
  x: number,
  y: number,
  scale: number,
  flipX: boolean,
  fps = 10,
): void {
  const entry = set?.anims.get(anim) ?? set?.anims.get("Idle");
  const size = FRAME_SIZE * scale;

  if (!entry) {
    // Fallback: asset yoksa basit kutu ciz
    ctx.fillStyle = "#a855f7";
    ctx.fillRect(x - size / 4, y - size / 2, size / 2, size / 2);
    return;
  }

  const isDeath = anim === "Death";
  let frame = Math.floor(animTime * fps);
  frame = isDeath ? Math.min(frame, entry.frames - 1) : frame % entry.frames;

  ctx.save();
  if (flipX) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    ctx.translate(-x, 0);
  }
  ctx.drawImage(
    entry.image,
    frame * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE,
    x - size / 2, y - size, size, size,
  );
  ctx.restore();
}
