// Canvas cizim katmani — 2D arena (ustten hafif acili gorunum).
// Karakter duz (Idle/Walk) — saldiri gorselleri silah efektleri olarak cizilir.
// Varliklar y'ye gore siralanir: asagidaki one cizilir (derinlik hissi).

import { ARENA } from "./config";
import { GameEngine } from "./engine";
import { drawSprite, type SpriteSet } from "./sprites";

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
        drawSprite(ctx, set, c.dead ? "Death" : c.anim, c.animTime, c.x, c.y + 40, c.def.scale, c.facing === -1);
        if (!c.dead) {
          const w = 50;
          const barY = c.y - 60 * c.def.scale;
          ctx.fillStyle = "#00000088";
          ctx.fillRect(c.x - w / 2, barY, w, 5);
          ctx.fillStyle = c.buffed ? "#ef4444" : "#4ade80";
          ctx.fillRect(c.x - w / 2, barY, w * Math.max(0, c.hp / c.maxHp), 5);
          if (c.buffed) { ctx.font = "12px serif"; ctx.fillText("🩸", c.x + w / 2 + 10, barY + 6); }
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
