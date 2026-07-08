// Canvas cizim katmani. Karakter duz (Idle/Walk) — saldiri gorselleri
// silah efektleri olarak karakterin etrafinda cizilir.

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
  const { width, height, groundY, vendorX } = ARENA;

  // Arka plan
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#12101f");
  sky.addColorStop(1, "#2a1f33");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Zemin
  ctx.fillStyle = "#1f1a26";
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.strokeStyle = "#453a52";
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // Satici (sol kenar)
  ctx.font = "40px serif";
  ctx.textAlign = "center";
  ctx.fillText("🧙", vendorX, groundY - 10);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = g.nearVendor ? "#ffd700" : "#8b8b9e";
  ctx.fillText(g.nearVendor ? "[E] Satıcı" : "Satıcı", vendorX, groundY + 20);

  // Turretler
  for (const t of g.turrets) {
    ctx.font = "32px serif";
    ctx.fillText("🏰", t.x, groundY - 4);
    // omur cubugu
    ctx.fillStyle = "#f97316";
    ctx.fillRect(t.x - 16, groundY - 46, 32 * (t.lifeLeft / 8), 3);
  }

  // Silah efektleri (karakterin/hedefin etrafinda)
  for (const e of g.effects) {
    const p = e.life / e.maxLife; // 1 → 0
    ctx.save();
    ctx.globalAlpha = p * 0.8;
    switch (e.type) {
      case "aoe":
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(e.x, groundY - 50, (e.radius ?? 100) * (1 - p * 0.3), 0.2, Math.PI - 0.2, true);
        ctx.stroke();
        break;
      case "blade": {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 3;
        const reach = (e.radius ?? 200) * (1 - p);
        ctx.beginPath();
        ctx.arc(e.x, groundY - 55, 60 + reach * 0.4, e.dir === 1 ? -0.6 : Math.PI - 0.6, e.dir === 1 ? 0.6 : Math.PI + 0.6);
        ctx.stroke();
        break;
      }
      case "frost":
        ctx.strokeStyle = "#7dd3fc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, groundY - 50, (e.radius ?? 150) * (1 - p), 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "firerain":
        ctx.font = "24px serif";
        ctx.fillText("🔥", e.x, groundY - 60 - p * 40);
        break;
      case "lightning":
        if (e.targetX !== undefined) {
          ctx.strokeStyle = "#fef08a";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(e.x, groundY - 70);
          const midX = (e.x + e.targetX) / 2;
          ctx.lineTo(midX, groundY - 120);
          ctx.lineTo(e.targetX, groundY - 40);
          ctx.stroke();
        }
        break;
      case "impactor":
        ctx.font = `${40 + (1 - p) * 30}px serif`;
        ctx.fillText("💥", e.x, groundY - 40);
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

  // Yaratiklar
  for (const c of g.creatures) {
    const set = sprites.creatures.get(c.def.sprite);
    drawSprite(ctx, set, c.dead ? "Death" : c.anim, c.animTime, c.x, groundY, c.def.scale, c.facing === -1);
    if (!c.dead) {
      // HP bar
      const w = 50;
      ctx.fillStyle = "#00000088";
      ctx.fillRect(c.x - w / 2, groundY - 100 * c.def.scale - 12, w, 5);
      ctx.fillStyle = c.buffed ? "#ef4444" : "#4ade80";
      ctx.fillRect(c.x - w / 2, groundY - 100 * c.def.scale - 12, w * Math.max(0, c.hp / c.maxHp), 5);
      // debuff gostergeleri
      if (c.buffed) { ctx.font = "12px serif"; ctx.fillText("🩸", c.x + w / 2 + 8, groundY - 100 * c.def.scale - 6); }
    }
  }

  // Oyuncu (duz karakter — attack animasyonu YOK)
  ctx.save();
  if (g.hurtFlash > 0) ctx.filter = "brightness(2) saturate(2)";
  if (sprites.playerCustom) {
    // Ozel cizilmis karakter: yururken hafif ziplama, yone gore aynalama
    const img = sprites.playerCustom;
    const bob = g.playerAnim === "Walk" ? Math.abs(Math.sin(g.playerAnimTime * 10)) * 6 : 0;
    const y = groundY - img.height - bob;
    if (g.facing === -1) {
      ctx.translate(g.playerX, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -img.width / 2, y);
    } else {
      ctx.drawImage(img, g.playerX - img.width / 2, y);
    }
  } else {
    drawSprite(ctx, sprites.player, g.playerAnim === "Walk" ? "Walk" : "Idle", g.playerAnimTime, g.playerX, groundY, 1, g.facing === -1);
  }
  ctx.restore();

  // Debuff gostergeleri (oyuncunun ustunde)
  const badges: string[] = [];
  if (g.elapsed < g.slowedUntil) badges.push("🐌");
  if (g.elapsed < g.weakenedUntil) badges.push("🥀");
  if (badges.length) {
    ctx.font = "18px serif";
    ctx.fillText(badges.join(" "), g.playerX, groundY - 115);
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
