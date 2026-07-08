// Canvas cizim katmani — profesyonel cizilmis efektler (canvas'ta emoji YOK).
// Chat balonlari, level-up aurasi, boss auralari, tum silah efektleri elle cizilir.

import { ARENA, CREATURES } from "./config";
import { GameEngine } from "./engine";
import { drawSprite, type SpriteSet } from "./sprites";

// Rakip arenasindan gelen anlik goruntu (10 Hz snapshot)
export interface OppCreature {
  x: number;
  y: number;
  s: string; // sprite id
  f: number; // facing
  hp: number; // 0..1
  lvl?: number;
  isBoss?: boolean;
  isUltimateBoss?: boolean;
  say?: string;
}
export interface OppSnapshot {
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  level: number;
  kills: number;
  say?: string;
  char?: string; // secilen kahraman sprite id
  name?: string;
  stats?: Record<string, number>; // silah basina toplam hasar
  creatures: OppCreature[];
}

export interface SpriteBundle {
  player: SpriteSet | undefined; // secilen kahramanin sprite'i
  heroes: Map<string, SpriteSet>; // tum kahramanlar (rakip gorunumu icin)
  creatures: Map<string, SpriteSet>;
}

function bossScale(c: { isBoss?: boolean; isUltimateBoss?: boolean }): number {
  return c.isUltimateBoss ? 5 : c.isBoss ? 2.5 : 1;
}

/** Chat balonu — varliklarin ustunde konusma */
function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.font = "600 13px 'Segoe UI', sans-serif";
  const w = Math.min(240, ctx.measureText(text).width + 18);
  const h = 26;
  const bx = Math.max(8, Math.min(ARENA.width - w - 8, x - w / 2));
  const by = y - h;

  ctx.fillStyle = "#f8f8fcee";
  ctx.strokeStyle = "#00000033";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 8);
  ctx.fill();
  ctx.stroke();
  // kuyruk
  ctx.beginPath();
  ctx.moveTo(x - 5, by + h);
  ctx.lineTo(x + 5, by + h);
  ctx.lineTo(x, by + h + 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1a1425";
  ctx.textAlign = "center";
  ctx.fillText(text, bx + w / 2, by + 17, w - 12);
}

/** Satici isareti — cizilmis rune tasi (emoji yerine) */
function drawVendor(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, range: number,
  color: string, label: string, near: boolean, time: number,
) {
  // etkilesim halkasi
  ctx.strokeStyle = near ? `${color}aa` : "#ffffff14";
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // isik sutunu
  const glow = ctx.createLinearGradient(x, y - 90, x, y + 10);
  glow.addColorStop(0, `${color}00`);
  glow.addColorStop(1, `${color}${near ? "55" : "2a"}`);
  ctx.fillStyle = glow;
  ctx.fillRect(x - 18, y - 90, 36, 95);

  // rune tasi
  const bob = Math.sin(time * 2) * 4;
  ctx.save();
  ctx.translate(x, y - 34 + bob);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = near ? 22 : 10;
  ctx.fillRect(-11, -11, 22, 22);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0a0812";
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();

  ctx.font = "700 11px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = near ? color : "#8b8b9e";
  ctx.fillText(near ? `[F] ${label}` : label, x, y + 22);
}

/** Turret — cizilmis kule */
function drawTurret(ctx: CanvasRenderingContext2D, x: number, y: number, lifePct: number) {
  ctx.fillStyle = "#3d3450";
  ctx.fillRect(x - 12, y - 8, 24, 12);
  ctx.fillStyle = "#574a70";
  ctx.fillRect(x - 8, y - 26, 16, 20);
  ctx.fillStyle = "#f97316";
  ctx.fillRect(x - 3, y - 32, 6, 8);
  // omur cubugu
  ctx.fillStyle = "#00000088";
  ctx.fillRect(x - 14, y - 40, 28, 4);
  ctx.fillStyle = "#f97316";
  ctx.fillRect(x - 14, y - 40, 28 * lifePct, 4);
}

/** Ortak sahne cizimi (kendi arenan + rakip icin ayni motor) */
export function render(ctx: CanvasRenderingContext2D, g: GameEngine, sprites: SpriteBundle) {
  const { width, height } = ARENA;

  // Arka plan
  const bg = ctx.createRadialGradient(width / 2, height / 2, 100, width / 2, height / 2, width * 0.7);
  bg.addColorStop(0, "#241f31");
  bg.addColorStop(1, "#141019");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#ffffff08";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y < height; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

  ctx.textAlign = "center";

  // Saticilar (cizilmis rune taslari)
  drawVendor(ctx, ARENA.vendorX, ARENA.vendorY, ARENA.vendorRange, "#eab308", "MARKET", g.nearVendor, g.elapsed);
  drawVendor(ctx, ARENA.vendor2X, ARENA.vendor2Y, ARENA.vendor2Range, "#ef4444", "KARANLIK", g.nearUpgrader, g.elapsed);

  // Zehir bulutlari (zeminde)
  for (const z of g.zones) {
    const grad = ctx.createRadialGradient(z.x, z.y, 10, z.x, z.y, z.radius);
    grad.addColorStop(0, "#4ade8038");
    grad.addColorStop(1, "#4ade8005");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(z.x, z.y, z.radius, z.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // baloncuklar
    for (let i = 0; i < 5; i++) {
      const a = g.elapsed * 1.5 + i * 1.26;
      ctx.fillStyle = "#4ade8055";
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(a) * z.radius * 0.5, z.y + Math.sin(a) * z.radius * 0.3 - (g.elapsed * 20 + i * 13) % 30, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Meteor golgeleri (dusmeden once hedef gosterge)
  for (const m of g.meteors) {
    const p = 1 - m.timer / 0.8;
    ctx.strokeStyle = "#f472b6aa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, m.radius * p, m.radius * 0.55 * p, 0, 0, Math.PI * 2);
    ctx.stroke();
    // dusen meteor cizgisi
    const fallY = m.y - 400 * (m.timer / 0.8);
    const grad = ctx.createLinearGradient(m.x + 60, fallY - 60, m.x, fallY);
    grad.addColorStop(0, "#f472b600");
    grad.addColorStop(1, "#f472b6");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(m.x + 60, fallY - 60);
    ctx.lineTo(m.x, fallY);
    ctx.stroke();
  }

  // Alan efektleri (varliklarin altinda)
  for (const e of g.effects) {
    const p = e.life / e.maxLife;
    ctx.save();
    ctx.globalAlpha = p * 0.85;
    switch (e.type) {
      case "aoe": {
        const r = (e.radius ?? 100) * (1 - p * 0.3);
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#c084fc44";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, r * 0.85, r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "frost": {
        const r = (e.radius ?? 150) * (1 - p);
        ctx.strokeStyle = "#7dd3fc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        // buz kristalleri
        ctx.fillStyle = "#bae6fd";
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * 0.5, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "blade": {
        const reach = 60 + (e.radius ?? 200) * (1 - p) * 0.4;
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#f1f5f9";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(e.x, e.y - 30, reach, e.dir === 1 ? -0.7 : Math.PI - 0.7, e.dir === 1 ? 0.7 : Math.PI + 0.7);
        ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      }
      case "levelup": {
        // LEVEL UP aurasi: genisleyen altin cift halka + isik sutunu
        const r = 140 * (1 - p);
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 4 * p + 1;
        ctx.shadowColor = "#fbbf24";
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, r * 0.6, r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        const pillar = ctx.createLinearGradient(e.x, e.y - 160, e.x, e.y);
        pillar.addColorStop(0, "#fbbf2400");
        pillar.addColorStop(1, `#fbbf24${Math.floor(p * 64).toString(16).padStart(2, "0")}`);
        ctx.fillStyle = pillar;
        ctx.fillRect(e.x - 30, e.y - 160, 60, 160);
        break;
      }
      case "meteor": {
        // patlama halkasi
        const r = (e.radius ?? 120) * (1 - p * 0.5);
        const grad = ctx.createRadialGradient(e.x, e.y, 5, e.x, e.y, r);
        grad.addColorStop(0, "#fef08acc");
        grad.addColorStop(0.4, "#f472b688");
        grad.addColorStop(1, "#f472b600");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  // Turretler
  for (const t of g.turrets) drawTurret(ctx, t.x, t.y, t.lifeLeft / 8);

  // ---- Varliklar (y-sirali derinlik) ----
  type Drawable = { y: number; draw: () => void };
  const drawables: Drawable[] = [];

  for (const c of g.creatures) {
    drawables.push({
      y: c.y,
      draw: () => {
        const set = sprites.creatures.get(c.def.sprite);
        const scale = c.def.scale * bossScale(c);

        // Boss aurasi (kirmizi nabiz)
        if ((c.isBoss || c.isUltimateBoss) && !c.dead) {
          const pulse = 0.6 + Math.sin(g.elapsed * 4) * 0.3;
          ctx.save();
          ctx.globalAlpha = pulse * 0.5;
          ctx.strokeStyle = c.isUltimateBoss ? "#ff2222" : "#ef4444";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y + 20, 55 * scale * 0.6, 26 * scale * 0.6, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        drawSprite(ctx, set, c.dead ? "Death" : c.anim, c.animTime, c.x, c.y + 40, scale, c.facing === -1);

        if (!c.dead) {
          const w = Math.min(120, 50 * scale);
          const barY = c.y - 60 * scale;
          ctx.fillStyle = "#00000088";
          ctx.fillRect(c.x - w / 2, barY, w, 5);
          ctx.fillStyle = c.buffed ? "#ef4444" : "#4ade80";
          ctx.fillRect(c.x - w / 2, barY, w * Math.max(0, c.hp / c.maxHp), 5);
          // seviye rozeti
          ctx.font = "700 10px 'Segoe UI', sans-serif";
          ctx.fillStyle = "#c4b5fd";
          ctx.fillText(`${c.level}`, c.x - w / 2 - 10, barY + 6);
          // mob chat balonu
          if (c.say) drawBubble(ctx, c.x, barY - 8, c.say);
        }
      },
    });
  }

  // Oyuncu
  drawables.push({
    y: g.playerY,
    draw: () => {
      // Kalici seviye aurasi — level yukseldikce buyur/parlar
      const auraStr = Math.min(1, g.level / 40);
      if (auraStr > 0.05 || g.levelUpFlash > 0) {
        const r = 42 + auraStr * 26 + g.levelUpFlash * 40;
        const grad = ctx.createRadialGradient(g.playerX, g.playerY + 20, 4, g.playerX, g.playerY + 20, r);
        const alpha = Math.min(0.5, 0.12 + auraStr * 0.2 + g.levelUpFlash * 0.4);
        grad.addColorStop(0, `rgba(251,191,36,${alpha})`);
        grad.addColorStop(1, "rgba(251,191,36,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(g.playerX, g.playerY + 20, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Donen kureler (orbit silahi varsa)
      const orbit = g.weapons.find((w) => w.def.type === "orbit");
      if (orbit) {
        const count = 3 + Math.min(3, orbit.level - 1);
        for (let i = 0; i < count; i++) {
          const a = g.orbitAngle + (i / count) * Math.PI * 2;
          const ox = g.playerX + Math.cos(a) * 95;
          const oy = g.playerY - 20 + Math.sin(a) * 48;
          ctx.fillStyle = "#818cf8";
          ctx.shadowColor = "#818cf8";
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(ox, oy, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      drawSprite(ctx, sprites.player, g.playerAnim, g.playerAnimTime, g.playerX, g.playerY + 40, 1.1, g.facing === -1);

      // Debuff rozetleri — cizilmis kucuk simgeler
      let badgeX = g.playerX - 12;
      if (g.elapsed < g.slowedUntil) {
        ctx.fillStyle = "#94a3b8";
        ctx.beginPath();
        ctx.arc(badgeX, g.playerY - 78, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0a0812";
        ctx.font = "700 8px sans-serif";
        ctx.fillText("S", badgeX, g.playerY - 75);
        badgeX += 16;
      }
      if (g.elapsed < g.weakenedUntil) {
        ctx.fillStyle = "#f87171";
        ctx.beginPath();
        ctx.arc(badgeX, g.playerY - 78, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0a0812";
        ctx.font = "700 8px sans-serif";
        ctx.fillText("W", badgeX, g.playerY - 75);
      }

      // Oyuncu chat balonu
      if (g.playerSay && g.elapsed < g.playerSayUntil) {
        drawBubble(ctx, g.playerX, g.playerY - 88, g.playerSay);
      }
    },
  });

  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // Hedefli efektler (ustte)
  for (const e of g.effects) {
    const p = e.life / e.maxLife;
    ctx.save();
    ctx.globalAlpha = p * 0.9;
    switch (e.type) {
      case "firerain": {
        // cizilmis alev: uc katmanli damla
        const fy = e.y - 30 - p * 30;
        const grad = ctx.createRadialGradient(e.x, fy, 2, e.x, fy, 16);
        grad.addColorStop(0, "#fef08a");
        grad.addColorStop(0.5, "#fb923c");
        grad.addColorStop(1, "#fb923c00");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(e.x, fy, 16, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "lightning": {
        if (e.targetX !== undefined && e.targetY !== undefined) {
          // kirikli simsek cizgisi
          ctx.strokeStyle = "#fef08a";
          ctx.lineWidth = 2.5;
          ctx.shadowColor = "#fef08a";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y - 40);
          const segs = 4;
          for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            const jitter = i < segs ? (Math.sin(i * 7.3 + e.life * 50) * 14) : 0;
            ctx.lineTo(
              e.x + (e.targetX - e.x) * t + jitter,
              e.y - 40 + (e.targetY - 10 - (e.y - 40)) * t + (i < segs ? Math.cos(i * 5.1) * 10 : 0),
            );
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        break;
      }
      case "impactor": {
        // yildiz patlamasi cizgileri
        const r = 20 + (1 - p) * 26;
        ctx.strokeStyle = "#f87171";
        ctx.lineWidth = 3;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(a) * r * 0.4, e.y - 20 + Math.sin(a) * r * 0.4);
          ctx.lineTo(e.x + Math.cos(a) * r, e.y - 20 + Math.sin(a) * r);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }

  // Mermiler
  for (const p of g.projectiles) {
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Bumeranglar — donen cizilmis L sekli
  for (const b of g.boomerangs) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.t * 14);
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.lineTo(0, -8);
    ctx.lineTo(10, 4);
    ctx.stroke();
    ctx.restore();
  }

  // Hasar yazilari
  ctx.font = "700 15px 'Segoe UI', sans-serif";
  for (const t of g.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.fillStyle = t.color;
    ctx.strokeStyle = "#00000088";
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  // Hasar alma vinyeti (ctx.filter'dan cok daha ucuz)
  if (g.hurtFlash > 0) {
    const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.75);
    grad.addColorStop(0, "rgba(220,38,38,0)");
    grad.addColorStop(1, `rgba(220,38,38,${g.hurtFlash * 1.6})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.textAlign = "left";
}

/**
 * Snapshot'taki varliklari (oyuncu + yaratiklari) mevcut sahnenin USTUNE cizer.
 * Kendi arenanda takim arkadaslarini gostermek ve dusman birlesik haritasi icin kullanilir.
 */
export function renderSnapshotEntities(
  ctx: CanvasRenderingContext2D,
  snap: OppSnapshot,
  sprites: SpriteBundle,
  time: number,
  hostile: boolean,
) {
  ctx.textAlign = "center";
  const scaleOf = new Map(CREATURES.map((c) => [c.sprite, c.scale]));
  const items: { y: number; draw: () => void }[] = [];

  for (const c of snap.creatures) {
    items.push({
      y: c.y,
      draw: () => {
        const set = sprites.creatures.get(c.s);
        const scale = (scaleOf.get(c.s) ?? 1) * bossScale(c);
        if ((c.isBoss || c.isUltimateBoss)) {
          ctx.save();
          ctx.globalAlpha = 0.4 + Math.sin(time * 4) * 0.2;
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y + 20, 55 * scale * 0.6, 26 * scale * 0.6, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        drawSprite(ctx, set, "Walk", time, c.x, c.y + 40, scale, c.f === -1);
        const w = Math.min(120, 44 * scale);
        ctx.fillStyle = "#00000088";
        ctx.fillRect(c.x - w / 2, c.y - 60 * scale, w, 4);
        ctx.fillStyle = hostile ? "#f87171" : "#4ade80";
        ctx.fillRect(c.x - w / 2, c.y - 60 * scale, w * Math.max(0, c.hp), 4);
        if (c.say) drawBubble(ctx, c.x, c.y - 60 * scale - 8, c.say);
      },
    });
  }

  if (snap.hp > 0) {
    items.push({
      y: snap.y,
      draw: () => {
        const heroSet = (snap.char && sprites.heroes.get(snap.char)) || sprites.heroes.get("soldier");
        drawSprite(ctx, heroSet, "Idle", time, snap.x, snap.y + 40, 1.1, snap.facing === -1);
        // isim etiketi
        if (snap.name) {
          ctx.font = "700 12px 'Segoe UI', sans-serif";
          ctx.fillStyle = hostile ? "#f87171" : "#4ade80";
          ctx.fillText(snap.name, snap.x, snap.y - 78);
        }
        const w = 60;
        ctx.fillStyle = "#00000088";
        ctx.fillRect(snap.x - w / 2, snap.y - 72, w, 6);
        ctx.fillStyle = hostile ? "#f87171" : "#4ade80";
        ctx.fillRect(snap.x - w / 2, snap.y - 72, w * Math.max(0, snap.hp / snap.maxHp), 6);
        if (snap.say) drawBubble(ctx, snap.x, snap.y - 92, snap.say);
      },
    });
  }

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
  ctx.textAlign = "left";
}

/** Dusman takiminin BIRLESIK haritasi — tum dusman snapshot'lari tek sahnede */
export function renderTeamView(
  ctx: CanvasRenderingContext2D,
  snaps: OppSnapshot[],
  sprites: SpriteBundle,
  time: number,
  hostile = true,
) {
  const { width, height } = ARENA;

  const bg = ctx.createRadialGradient(width / 2, height / 2, 100, width / 2, height / 2, width * 0.7);
  if (hostile) {
    bg.addColorStop(0, "#2d1a1f");
    bg.addColorStop(1, "#160d11");
  } else {
    bg.addColorStop(0, "#1a2d22");
    bg.addColorStop(1, "#0d1611");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#ffffff06";
  for (let x = 0; x < width; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y < height; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

  if (snaps.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#8b8b9e";
    ctx.font = "24px 'Segoe UI', sans-serif";
    ctx.fillText("Bağlanıyor...", width / 2, height / 2);
    ctx.textAlign = "left";
    return;
  }

  for (const snap of snaps) renderSnapshotEntities(ctx, snap, sprites, time, hostile);
}
