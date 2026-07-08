// Canvas cizim katmani — 2D arena (ustten hafif acili gorunum).
// Karakter duz (Idle/Walk) — saldiri gorselleri silah efektleri olarak cizilir.
// Varliklar y'ye gore siralanir: asagidaki one cizilir (derinlik hissi).

import { ARENA, CREATURES } from "./config";
import { GameEngine } from "./engine";
import { drawSprite, type SpriteSet } from "./sprites";

// Rakip arenasindan gelen anlik goruntu (10 Hz snapshot)
export interface OppCreature {
  x: number;
  y: number;
  s: string; // sprite id
  f: number; // facing (1/-1)
  hp: number; // 0..1
  lvl?: number;
  isBoss?: boolean;
}
export interface OppSnapshot {
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  level: number;
  kills: number;
  creatures: OppCreature[];
}

export interface SpriteBundle {
  player: SpriteSet | undefined;
  // Kullanicinin cizdigi 16x16 pixel karakter — varsa Soldier yerine bu cizilir
  playerCustom?: HTMLCanvasElement;
  creatures: Map<string, SpriteSet>;
}

export function render(ctx: CanvasRenderingContext2D, g: GameEngine, sprites: SpriteBundle) {
  const { width, height, vendorX, vendorY } = ARENA;

  // Arka plan — koyu zemin + hafif doku
  const bg = ctx.createRadialGradient(width / 2, height / 2, 100, width / 2, height / 2, width * 0.7);
  bg.addColorStop(0, "#241f31");
  bg.addColorStop(1, "#141019");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Zemin izgara dokusu
  ctx.strokeStyle = "#ffffff08";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  ctx.textAlign = "center";

  // Satici bolgesi
  ctx.strokeStyle = g.nearVendor ? "#ffd70066" : "#ffffff15";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(vendorX, vendorY, ARENA.vendorRange, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "40px serif";
  ctx.fillText("🧙", vendorX, vendorY + 14);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = g.nearVendor ? "#ffd700" : "#8b8b9e";
  ctx.fillText(g.nearVendor ? "[E] Satıcı" : "Satıcı", vendorX, vendorY + 36);

  // Alan-etkili silah efektleri (zeminde, varliklarin altinda)
  for (const e of g.effects) {
    const p = e.life / e.maxLife; // 1 → 0
    ctx.save();
    ctx.globalAlpha = p * 0.8;
    switch (e.type) {
      case "aoe":
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, (e.radius ?? 100) * (1 - p * 0.3), (e.radius ?? 100) * 0.5 * (1 - p * 0.3), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "frost":
        ctx.strokeStyle = "#7dd3fc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, (e.radius ?? 150) * (1 - p), (e.radius ?? 150) * 0.5 * (1 - p), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "blade": {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 3;
        const reach = 60 + (e.radius ?? 200) * (1 - p) * 0.4;
        ctx.beginPath();
        ctx.arc(e.x, e.y - 30, reach, e.dir === 1 ? -0.7 : Math.PI - 0.7, e.dir === 1 ? 0.7 : Math.PI + 0.7);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  // Turretler
  for (const t of g.turrets) {
    ctx.font = "32px serif";
    ctx.fillText("🏰", t.x, t.y + 8);
    ctx.fillStyle = "#f97316";
    ctx.fillRect(t.x - 16, t.y - 34, 32 * (t.lifeLeft / 8), 3);
  }

  // Varliklari y'ye gore sirala — asagidakiler one cizilsin
  type Drawable = { y: number; draw: () => void };
  const drawables: Drawable[] = [];

  for (const c of g.creatures) {
    drawables.push({
      y: c.y,
      draw: () => {
        const set = sprites.creatures.get(c.def.sprite);
        const finalScale = c.def.scale * (c.isBoss ? 5 : 1);

        // Draw Level Aura if c.level > 0
        if (!c.dead && c.level && c.level > 0) {
          ctx.save();
          // Aura color changes at 2, 5, 10
          let auraColor = "rgba(168, 85, 247, 0.25)"; // Tier 1: Purple (< 2)
          if (c.level >= 10) {
            auraColor = "rgba(234, 179, 8, 0.6)"; // Tier 4: Gold (>= 10)
          } else if (c.level >= 5) {
            auraColor = "rgba(249, 115, 22, 0.45)"; // Tier 3: Orange-Red (>= 5)
          } else if (c.level >= 2) {
            auraColor = "rgba(6, 182, 212, 0.35)"; // Tier 2: Cyan (>= 2)
          }

          const pulse = 1 + Math.sin((c.animTime ?? 0) * 5) * 0.15;
          const auraRadius = 30 * finalScale * pulse;

          const grad = ctx.createRadialGradient(c.x, c.y + 35, 2, c.x, c.y + 35, auraRadius);
          grad.addColorStop(0, auraColor);
          grad.addColorStop(0.5, auraColor.replace(/[\d\.]+\)$/, "0.15)"));
          grad.addColorStop(1, "rgba(0,0,0,0)");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y + 35, auraRadius, auraRadius * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        drawSprite(ctx, set, c.dead ? "Death" : c.anim, c.animTime, c.x, c.y + 40, finalScale, c.facing === -1);

        if (!c.dead) {
          const w = c.isBoss ? 150 : 50;
          const h = c.isBoss ? 8 : 5;
          const barY = c.y - 60 * finalScale;
          ctx.fillStyle = "#00000088";
          ctx.fillRect(c.x - w / 2, barY, w, h);
          ctx.fillStyle = c.isBoss ? "#f43f5e" : (c.buffed ? "#ef4444" : "#4ade80");
          ctx.fillRect(c.x - w / 2, barY, w * Math.max(0, c.hp / c.maxHp), h);

          if (c.buffed) { ctx.font = "12px serif"; ctx.fillText("🩸", c.x + w / 2 + 10, barY + 6); }

          if (c.isBoss) {
            ctx.font = "bold 11px sans-serif";
            ctx.fillStyle = "#f43f5e";
            ctx.fillText("👑 BOSS", c.x, barY - 6);
          }

          // Level text next to health bar
          ctx.font = "bold 9px sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`Lvl ${c.level}`, c.x - w / 2 - 18, barY + (c.isBoss ? 7 : 5));
        }
      },
    });
  }

  drawables.push({
    y: g.playerY,
    draw: () => {
      ctx.save();
      if (g.hurtFlash > 0) ctx.filter = "brightness(2) saturate(2)";
      if (sprites.playerCustom) {
        const img = sprites.playerCustom;
        const bob = g.playerAnim === "Walk" ? Math.abs(Math.sin(g.playerAnimTime * 10)) * 6 : 0;
        const y = g.playerY + 40 - img.height - bob;
        if (g.facing === -1) {
          ctx.translate(g.playerX, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, -img.width / 2, y);
        } else {
          ctx.drawImage(img, g.playerX - img.width / 2, y);
        }
      } else {
        drawSprite(ctx, sprites.player, g.playerAnim, g.playerAnimTime, g.playerX, g.playerY + 40, 1, g.facing === -1);
      }
      ctx.restore();

      // Aktif debuff rozetleri
      const badges: string[] = [];
      if (g.elapsed < g.slowedUntil) badges.push("🐌");
      if (g.elapsed < g.weakenedUntil) badges.push("🥀");
      if (badges.length) {
        ctx.font = "18px serif";
        ctx.fillText(badges.join(" "), g.playerX, g.playerY - 75);
      }
    },
  });

  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // Hedefli efektler (varliklarin ustunde)
  for (const e of g.effects) {
    const p = e.life / e.maxLife;
    ctx.save();
    ctx.globalAlpha = p * 0.9;
    switch (e.type) {
      case "firerain":
        ctx.font = "24px serif";
        ctx.fillText("🔥", e.x, e.y - 30 - p * 40);
        break;
      case "lightning":
        if (e.targetX !== undefined && e.targetY !== undefined) {
          ctx.strokeStyle = "#fef08a";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y - 40);
          ctx.lineTo((e.x + e.targetX) / 2 + 15, (e.y + e.targetY) / 2 - 60);
          ctx.lineTo(e.targetX, e.targetY - 10);
          ctx.stroke();
        }
        break;
      case "impactor":
        ctx.font = `${40 + (1 - p) * 30}px serif`;
        ctx.fillText("💥", e.x, e.y);
        break;
    }
    ctx.restore();
  }

  // Mermiler
  for (const p of g.projectiles) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ucusan hasar yazilari
  ctx.font = "bold 15px sans-serif";
  for (const t of g.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

/** Rakip arenasi — snapshot'tan cizilen izleme goruntusu (kirmizi tonlu) */
export function renderOpponentView(
  ctx: CanvasRenderingContext2D,
  snap: OppSnapshot | null,
  sprites: SpriteBundle,
  oppCustom: HTMLCanvasElement | null,
  time: number,
) {
  const { width, height } = ARENA;

  // Arka plan — rakip tarafi kizil tonda
  const bg = ctx.createRadialGradient(width / 2, height / 2, 100, width / 2, height / 2, width * 0.7);
  bg.addColorStop(0, "#2d1a1f");
  bg.addColorStop(1, "#160d11");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#ffffff06";
  for (let x = 0; x < width; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  ctx.textAlign = "center";

  if (!snap) {
    ctx.fillStyle = "#8b8b9e";
    ctx.font = "24px sans-serif";
    ctx.fillText("Rakip bekleniyor...", width / 2, height / 2);
    ctx.textAlign = "left";
    return;
  }

  const scaleOf = new Map(CREATURES.map((c) => [c.sprite, c.scale]));

  // y'ye gore sirala (derinlik)
  const items: { y: number; draw: () => void }[] = [];

  for (const c of snap.creatures) {
    items.push({
      y: c.y,
      draw: () => {
        const set = sprites.creatures.get(c.s);
        const baseScale = scaleOf.get(c.s) ?? 1;
        const scale = baseScale * (c.isBoss ? 5 : 1);

        // Draw Opponent Creature level aura if c.lvl > 0
        if (c.lvl && c.lvl > 0) {
          ctx.save();
          // Aura color changes at 2, 5, 10
          let auraColor = "rgba(168, 85, 247, 0.25)"; // Tier 1: Purple (< 2)
          if (c.lvl >= 10) {
            auraColor = "rgba(234, 179, 8, 0.6)"; // Tier 4: Gold (>= 10)
          } else if (c.lvl >= 5) {
            auraColor = "rgba(249, 115, 22, 0.45)"; // Tier 3: Orange-Red (>= 5)
          } else if (c.lvl >= 2) {
            auraColor = "rgba(6, 182, 212, 0.35)"; // Tier 2: Cyan (>= 2)
          }

          const pulse = 1 + Math.sin(time * 5) * 0.15;
          const auraRadius = 30 * scale * pulse;

          const grad = ctx.createRadialGradient(c.x, c.y + 35, 2, c.x, c.y + 35, auraRadius);
          grad.addColorStop(0, auraColor);
          grad.addColorStop(0.5, auraColor.replace(/[\d\.]+\)$/, "0.15)"));
          grad.addColorStop(1, "rgba(0,0,0,0)");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y + 35, auraRadius, auraRadius * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        drawSprite(ctx, set, "Walk", time, c.x, c.y + 40, scale, c.f === -1);

        const w = c.isBoss ? 100 : 44;
        const h = c.isBoss ? 6 : 4;
        const barY = c.y - 60 * scale;
        ctx.fillStyle = "#00000088";
        ctx.fillRect(c.x - w / 2, barY, w, h);
        ctx.fillStyle = c.isBoss ? "#f43f5e" : "#f87171";
        ctx.fillRect(c.x - w / 2, barY, w * Math.max(0, c.hp), h);

        if (c.isBoss) {
          ctx.font = "bold 9px sans-serif";
          ctx.fillStyle = "#f43f5e";
          ctx.fillText("👑 BOSS", c.x, barY - 5);
        }

        if (c.lvl && c.lvl > 0) {
          ctx.font = "bold 8px sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`Lvl ${c.lvl}`, c.x - w / 2 - 14, barY + (c.isBoss ? 5 : 4));
        }
      },
    });
  }

  items.push({
    y: snap.y,
    draw: () => {
      if (oppCustom) {
        const y = snap.y + 40 - oppCustom.height;
        if (snap.facing === -1) {
          ctx.save();
          ctx.translate(snap.x, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(oppCustom, -oppCustom.width / 2, y);
          ctx.restore();
        } else {
          ctx.drawImage(oppCustom, snap.x - oppCustom.width / 2, y);
        }
      } else {
        drawSprite(ctx, sprites.player, "Idle", time, snap.x, snap.y + 40, 1, snap.facing === -1);
      }
      // Rakip HP cubugu
      const w = 60;
      ctx.fillStyle = "#00000088";
      ctx.fillRect(snap.x - w / 2, snap.y - 70, w, 6);
      ctx.fillStyle = "#f87171";
      ctx.fillRect(snap.x - w / 2, snap.y - 70, w * Math.max(0, snap.hp / snap.maxHp), 6);
    },
  });

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  ctx.textAlign = "left";
}
