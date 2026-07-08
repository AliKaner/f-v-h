// Oyun motoru — her istemci KENDI arenasini simule eder.
// Kill'ler socket uzerinden rakibe 2 yaratik olarak gider (GDD 2.1.1).
// 2D hareket: oyuncu 4 yone gidebilir, yaratiklar her kenardan gelir.
// Level up oyunu DURDURMAZ — secim oyun akarken yapilir.

import {
  ARENA, PLAYER_BASE, CREATURES, WEAPONS, BOOKS,
  creatureHp, creatureDamage, goldDrop, xpDrop, xpToNextLevel,
  spawnInterval, difficultyAt, weaponDamage, weaponCooldown,
  type CreatureDef, type WeaponDef, type BookDef, type WeaponType, type BookType,
} from "./config";

export interface CreatureState {
  uid: number;
  def: CreatureDef;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  slowUntil: number;
  burnUntil: number;
  burnDps: number;
  buffed: boolean;
  anim: "Walk" | "Hurt" | "Death";
  animTime: number;
  dead: boolean; // death animasyonu oynuyor
  contactCd: number;
  facing: 1 | -1;
  level: number;
  isBoss?: boolean;
  isUltimateBoss?: boolean;
}

export interface OwnedWeapon {
  def: WeaponDef;
  level: number;
  cooldownLeft: number;
}

export interface OwnedBook {
  def: BookDef;
  level: number;
}

export interface Turret {
  x: number;
  y: number;
  lifeLeft: number;
  cooldownLeft: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  hitRadius: number;
  color: string;
  alive: boolean;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

// Silah gorsel efektleri — karakterin ETRAFINDA oynar, karakter animasyonu degismez
export interface WeaponEffect {
  type: WeaponType;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  radius?: number;
  dir?: 1 | -1;
  life: number;
  maxLife: number;
}

export interface LevelUpChoice {
  kind: "newWeapon" | "upgradeWeapon" | "newBook" | "upgradeBook";
  weaponType?: WeaponType;
  bookType?: BookType;
  title: string;
  desc: string;
  emoji: string;
}

export interface EngineCallbacks {
  onKill: (count: number) => void; // rakibe spawn gonder
  onLevelUp: (choices: LevelUpChoice[]) => void; // oyun DURMAZ — panel akarken gosterilir
  onDeath: () => void;
}

export class GameEngine {
  // Oyuncu — 2D pozisyon
  playerX = ARENA.width / 2;
  playerY = (ARENA.top + ARENA.bottom) / 2;
  facing: 1 | -1 = 1;
  hp = PLAYER_BASE.hp;
  maxHp = PLAYER_BASE.hp;
  gold = 0;
  xp = 0;
  level = 1;
  kills = 0;
  playerAnim: "Idle" | "Walk" = "Idle";
  playerAnimTime = 0;
  hurtFlash = 0;

  weapons: OwnedWeapon[] = [];
  books: OwnedBook[] = [];

  creatures: CreatureState[] = [];
  turrets: Turret[] = [];
  projectiles: Projectile[] = [];
  texts: FloatingText[] = [];
  effects: WeaponEffect[] = [];

  elapsed = 0;
  gameOver = false;
  private spawnTimer = 0;
  private nextUid = 1;
  private pendingSpawns = 0; // rakipten gelen yaratiklar (kuyruk)
  private pendingReleaseTimer = 0;
  private rng: () => number;

  // Rakip debuff'lari (bize uygulanan)
  slowedUntil = 0;
  weakenedUntil = 0;
  monstersBuffedUntil = 0;
  monsterLevelOffset = 0;

  input = { left: false, right: false, up: false, down: false };

  constructor(seed: number, private cb: EngineCallbacks) {
    // Deterministik RNG (mulberry32)
    let s = seed >>> 0;
    this.rng = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Baslangic silahi: rastgele bir tane
    const starter = WEAPONS[Math.floor(this.rng() * WEAPONS.length)];
    this.weapons.push({ def: starter, level: 1, cooldownLeft: 0 });
  }

  // ---- Stat carpanlari (kitaplardan) ----
  private bookLevel(type: BookType): number {
    return this.books.find((b) => b.def.type === type)?.level ?? 0;
  }
  get damageMult() {
    const weak = this.elapsed < this.weakenedUntil ? 0.7 : 1;
    return (1 + this.bookLevel("damage") * 0.15) * weak;
  }
  get moveSpeed() {
    const slow = this.elapsed < this.slowedUntil ? 0.6 : 1;
    return ARENA.playerSpeed * (1 + this.bookLevel("moveSpeed") * 0.1) * slow;
  }
  get attackSpeedMult() { return 1 + this.bookLevel("attackSpeed") * 0.12; }
  get extraProjectiles() { return this.bookLevel("projectiles"); }
  get critChance() { return Math.min(0.8, this.bookLevel("crit") * 0.1); }
  get damageTakenMult() { return Math.max(0.2, 1 - this.bookLevel("defense") * 0.08); }
  get goldMult() { return 1 + this.bookLevel("greed") * 0.2; }

  get difficulty() { return difficultyAt(this.elapsed); }
  get xpNeeded() { return xpToNextLevel(this.level); }
  get nearVendor() {
    return Math.hypot(this.playerX - ARENA.vendorX, this.playerY - ARENA.vendorY) < ARENA.vendorRange;
  }
  get nearUpgrader() {
    return Math.hypot(this.playerX - ARENA.vendor2X, this.playerY - ARENA.vendor2Y) < ARENA.vendor2Range;
  }

  /** Rakipten gelen spawn istegi */
  queueEnemySpawns(count: number) { this.pendingSpawns += count; }

  applyDebuff(id: string) {
    switch (id) {
      case "swarm": this.pendingSpawns += 10; break;
      case "slow": this.slowedUntil = this.elapsed + 8; break;
      case "weaken": this.weakenedUntil = this.elapsed + 10; break;
      case "buffMonsters":
        this.monstersBuffedUntil = this.elapsed + 15;
        for (const c of this.creatures) if (!c.dead) c.buffed = true;
        break;
      case "levelUpMonsters":
        this.monsterLevelOffset += 1;
        this.addText(this.playerX, this.playerY - 110, "⚠️ Canavarlar Seviye Atladı! Lvl +1", "#ef4444");
        for (const c of this.creatures) {
          if (!c.dead) {
            c.level += 1;
            const prevMaxHp = c.maxHp;
            c.maxHp = creatureHp(c.def.baseHp, c.level);
            c.hp = Math.max(0, Math.floor(c.hp * (c.maxHp / prevMaxHp)));
            c.damage = creatureDamage(c.def.baseDamage, c.level);
            c.speed = c.def.speed * (1 + Math.min(1, c.level * 0.02));
          }
        }
        break;
      case "spawnBoss":
        this.spawnBossCreature();
        break;
      case "spawnUltimateBoss":
        this.spawnUltimateBossCreature();
        break;
      case "steal": {
        const stolen = Math.floor(this.gold * 0.25);
        this.gold -= stolen;
        this.addText(this.playerX, this.playerY - 90, `-${stolen} 🪙 çalındı!`, "#fbbf24");
        break;
      }
    }
  }

  update(dt: number) {
    if (this.gameOver) return;
    this.elapsed += dt;
    this.playerAnimTime += dt;

    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updateCreatures(dt);
    this.updateWeapons(dt);
    this.updateTurrets(dt);
    this.updateProjectiles(dt);

    // Ucusan yazilar
    for (const t of this.texts) { t.life -= dt; t.y -= 40 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);

    // Silah efektleri
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);

    if (this.hp <= 0 && !this.gameOver) {
      this.gameOver = true;
      this.cb.onDeath();
    }
  }

  private updatePlayer(dt: number) {
    let dx = 0, dy = 0;
    if (this.input.left) dx -= 1;
    if (this.input.right) dx += 1;
    if (this.input.up) dy -= 1;
    if (this.input.down) dy += 1;
    if (dx !== 0 || dy !== 0) {
      // Capraz hareket normalize (kose kacisi hizli olmasin)
      const len = Math.hypot(dx, dy);
      const speed = this.moveSpeed * dt;
      this.playerX = Math.max(40, Math.min(ARENA.width - 40, this.playerX + (dx / len) * speed));
      this.playerY = Math.max(ARENA.top, Math.min(ARENA.bottom, this.playerY + (dy / len) * speed));
      if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
      this.playerAnim = "Walk";
    } else {
      this.playerAnim = "Idle";
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  private updateSpawning(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnInterval(this.difficulty);
      if (this.creatures.length < ARENA.maxCreatures) this.spawnCreature();
    }
    // Rakipten gelenler: 0.15 sn'de bir cikar — ani yigilma olmasin
    this.pendingReleaseTimer -= dt;
    if (this.pendingSpawns > 0 && this.pendingReleaseTimer <= 0 && this.creatures.length < ARENA.maxCreatures) {
      this.pendingReleaseTimer = 0.15;
      this.pendingSpawns--;
      this.spawnCreature();
    }
  }

  private pickCreature(): CreatureDef {
    const total = CREATURES.reduce((s, c) => s + c.weight, 0);
    let roll = this.rng() * total;
    for (const c of CREATURES) {
      roll -= c.weight;
      if (roll <= 0) return c;
    }
    return CREATURES[0];
  }

  private spawnCreature() {
    const def = this.pickCreature();
    const diff = this.difficulty;
    // Rastgele bir kenardan spawn (2D alan)
    const edge = Math.floor(this.rng() * 4);
    let x: number, y: number;
    switch (edge) {
      case 0: x = -50; y = ARENA.top + this.rng() * (ARENA.bottom - ARENA.top); break; // sol
      case 1: x = ARENA.width + 50; y = ARENA.top + this.rng() * (ARENA.bottom - ARENA.top); break; // sag
      case 2: x = this.rng() * ARENA.width; y = ARENA.top - 60; break; // ust
      default: x = this.rng() * ARENA.width; y = ARENA.bottom + 60; break; // alt
    }
    const level = diff + this.monsterLevelOffset;
    const hp = creatureHp(def.baseHp, level);
    this.creatures.push({
      uid: this.nextUid++,
      def, x, y,
      hp, maxHp: hp,
      damage: creatureDamage(def.baseDamage, level),
      speed: def.speed * (1 + Math.min(1, level * 0.02)),
      slowUntil: 0, burnUntil: 0, burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk", animTime: 0, dead: false, contactCd: 0,
      facing: x < this.playerX ? 1 : -1,
      level,
    });
  }

  private spawnBossCreature() {
    const def = this.pickCreature();
    const level = this.difficulty + this.monsterLevelOffset;
    const edge = Math.floor(this.rng() * 4);
    let x: number, y: number;
    switch (edge) {
      case 0: x = -100; y = ARENA.top + this.rng() * (ARENA.bottom - ARENA.top); break;
      case 1: x = ARENA.width + 100; y = ARENA.top + this.rng() * (ARENA.bottom - ARENA.top); break;
      case 2: x = this.rng() * ARENA.width; y = ARENA.top - 100; break;
      default: x = this.rng() * ARENA.width; y = ARENA.bottom + 100; break;
    }
    const hp = creatureHp(def.baseHp, level) * 8;
    this.creatures.push({
      uid: this.nextUid++,
      def, x, y,
      hp, maxHp: hp,
      damage: creatureDamage(def.baseDamage, level) * 2,
      speed: def.speed * 0.35,
      slowUntil: 0, burnUntil: 0, burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk", animTime: 0, dead: false, contactCd: 0,
      facing: x < this.playerX ? 1 : -1,
      level,
      isBoss: true,
    });
    this.addText(this.playerX, this.playerY - 130, "🚨 DEV BOSS SPAWN EDİLDİ! 🚨", "#ef4444");
  }

  private spawnUltimateBossCreature() {
    const def = this.pickCreature();
    const level = this.difficulty + this.monsterLevelOffset;
    const edge = Math.floor(this.rng() * 4);
    let x: number, y: number;
    switch (edge) {
      case 0: x = -200; y = (ARENA.top + ARENA.bottom) / 2; break;
      case 1: x = ARENA.width + 200; y = (ARENA.top + ARENA.bottom) / 2; break;
      case 2: x = ARENA.width / 2; y = ARENA.top - 200; break;
      default: x = ARENA.width / 2; y = ARENA.bottom + 200; break;
    }
    const hp = creatureHp(def.baseHp, level) * 100;
    this.creatures.push({
      uid: this.nextUid++,
      def, x, y,
      hp, maxHp: hp,
      damage: creatureDamage(def.baseDamage, level) * 5,
      speed: def.speed * 0.15,
      slowUntil: 0, burnUntil: 0, burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk", animTime: 0, dead: false, contactCd: 0,
      facing: x < this.playerX ? 1 : -1,
      level,
      isUltimateBoss: true,
    });
    this.addText(this.playerX, this.playerY - 140, "🚨 ULTIMATE BOSS SPAWN EDİLDİ!!! 🚨", "#ef4444");
  }

  private updateCreatures(dt: number) {
    for (const c of this.creatures) {
      c.animTime += dt;
      if (c.dead) continue;

      // Yanma DoT
      if (this.elapsed < c.burnUntil) this.damageCreature(c, c.burnDps * dt, false, false);
      if (c.dead) continue;

      const slowMult = this.elapsed < c.slowUntil ? 0.5 : 1;
      const buffMult = c.buffed ? 1.5 : 1;
      const dx = this.playerX - c.x;
      const dy = this.playerY - c.y;
      const dist = Math.hypot(dx, dy);
      c.facing = dx > 0 ? 1 : -1;

      // Oyuncuya dogru 2D hareket
      if (dist > 30) {
        const step = c.speed * slowMult * dt;
        c.x += (dx / dist) * step;
        c.y += (dy / dist) * step;
      }

      // Temas hasari (beden carpismasi)
      c.contactCd -= dt;
      const contactDist = c.isUltimateBoss ? 220 : (c.isBoss ? 110 : 45);
      if (dist <= contactDist && c.contactCd <= 0) {
        c.contactCd = PLAYER_BASE.contactDamageInterval;
        const dmg = Math.max(1, Math.floor(c.damage * buffMult * this.damageTakenMult));
        this.hp -= dmg;
        this.hurtFlash = 0.25;
        this.addText(this.playerX, this.playerY - 90, `-${dmg}`, "#ff4d4d");
      }
    }
    // Death animasyonu bitenleri sil (~0.6sn)
    this.creatures = this.creatures.filter((c) => !c.dead || c.animTime < 0.6);
  }

  private damageCreature(c: CreatureState, amount: number, canCrit: boolean, showText = true) {
    if (c.dead) return;
    let dmg = amount;
    let crit = false;
    if (canCrit && this.rng() < this.critChance) {
      dmg *= 2;
      crit = true;
    }
    dmg = Math.max(1, Math.floor(dmg));
    c.hp -= dmg;
    if (showText) {
      this.addText(c.x, c.y - 70, crit ? `${dmg}!` : `${dmg}`, crit ? "#ffd700" : "#ffffff");
    }
    if (c.hp <= 0) this.killCreature(c);
  }

  private killCreature(c: CreatureState) {
    c.dead = true;
    c.anim = "Death";
    c.animTime = 0;
    this.kills++;

    const diff = this.difficulty;
    const gold = Math.floor(goldDrop(c.def.baseGold, diff) * this.goldMult);
    const xp = xpDrop(c.def.baseXp, diff);
    this.gold += gold;
    this.addText(c.x, c.y - 50, `+${gold}🪙`, "#fbbf24");
    this.gainXp(xp);

    // CEKIRDEK MEKANIK: her kill rakibe 2 yaratik spawn ettirir
    this.cb.onKill(2);
  }

  private gainXp(amount: number) {
    this.xp += amount;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      // HP kitabi carpaniyla max can guncelle + level basina +20
      this.recalcMaxHp();
      this.hp = Math.min(this.maxHp, this.hp + Math.floor(this.maxHp * 0.2)); // level up %20 heal
      // Oyun DURMAZ — secenekler panele gider, oyuncu oynarken secer
      this.cb.onLevelUp(this.rollChoices());
    }
  }

  private recalcMaxHp() {
    this.maxHp = Math.floor((PLAYER_BASE.hp + (this.level - 1) * 20) * (1 + this.bookLevel("hp") * 0.25));
  }

  /** Level up secenekleri: 3 adet — silah/kitap karisimi */
  private rollChoices(): LevelUpChoice[] {
    const pool: LevelUpChoice[] = [];

    for (const w of WEAPONS) {
      const owned = this.weapons.find((o) => o.def.type === w.type);
      if (owned) {
        pool.push({
          kind: "upgradeWeapon", weaponType: w.type, emoji: w.emoji,
          title: `${w.name} Lv${owned.level + 1}`,
          desc: `+%25 hasar, +%5 hız — ${w.desc}`,
        });
      } else if (this.weapons.length < 4) {
        pool.push({
          kind: "newWeapon", weaponType: w.type, emoji: w.emoji,
          title: `${w.name} (YENİ)`, desc: w.desc,
        });
      }
    }
    for (const b of BOOKS) {
      const owned = this.books.find((o) => o.def.type === b.type);
      if (owned) {
        pool.push({
          kind: "upgradeBook", bookType: b.type, emoji: b.emoji,
          title: `${b.name} Lv${owned.level + 1}`, desc: b.desc,
        });
      } else if (this.books.length < 4) {
        pool.push({
          kind: "newBook", bookType: b.type, emoji: b.emoji,
          title: `${b.name} (YENİ)`, desc: b.desc,
        });
      }
    }

    // Karistir, 3 sec
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  applyChoice(choice: LevelUpChoice) {
    if (choice.kind === "newWeapon" && choice.weaponType) {
      const def = WEAPONS.find((w) => w.type === choice.weaponType)!;
      if (this.weapons.length < 4 && !this.weapons.some((o) => o.def.type === def.type)) {
        this.weapons.push({ def, level: 1, cooldownLeft: 0 });
      }
    } else if (choice.kind === "upgradeWeapon" && choice.weaponType) {
      const w = this.weapons.find((o) => o.def.type === choice.weaponType);
      if (w) w.level++;
    } else if (choice.kind === "newBook" && choice.bookType) {
      const def = BOOKS.find((b) => b.type === choice.bookType)!;
      if (this.books.length < 4 && !this.books.some((o) => o.def.type === def.type)) {
        this.books.push({ def, level: 1 });
      }
    } else if (choice.kind === "upgradeBook" && choice.bookType) {
      const b = this.books.find((o) => o.def.type === choice.bookType);
      if (b) b.level++;
    }
    this.recalcMaxHp();
  }

  // ---- Silah davranislari ----
  private aliveCreatures() { return this.creatures.filter((c) => !c.dead); }

  private distTo(c: { x: number; y: number }): number {
    return Math.hypot(c.x - this.playerX, c.y - this.playerY);
  }

  private nearest(within = Infinity): CreatureState | null {
    let best: CreatureState | null = null;
    let bestDist = within;
    for (const c of this.aliveCreatures()) {
      const d = this.distTo(c);
      if (d < bestDist) { best = c; bestDist = d; }
    }
    return best;
  }

  private updateWeapons(dt: number) {
    for (const w of this.weapons) {
      w.cooldownLeft -= dt;
      if (w.cooldownLeft > 0) continue;
      w.cooldownLeft = weaponCooldown(w.def, w.level, this.attackSpeedMult);
      this.fireWeapon(w);
    }
  }

  private addEffect(e: Omit<WeaponEffect, "maxLife">) {
    this.effects.push({ ...e, maxLife: e.life });
  }

  private fireWeapon(w: OwnedWeapon) {
    const dmg = weaponDamage(w.def, w.level, this.damageMult);
    const alive = this.aliveCreatures();
    const extra = this.extraProjectiles;
    const px = this.playerX, py = this.playerY;

    switch (w.def.type) {
      case "aoe": {
        const radius = 120 + w.level * 15;
        for (const c of alive) if (this.distTo(c) <= radius) this.damageCreature(c, dmg, true);
        this.addEffect({ type: "aoe", x: px, y: py, radius, life: 0.35 });
        break;
      }
      case "blade": {
        // Baktigi yonde onundeki dusmanlar (yatay koni)
        const targets = alive
          .filter((c) => Math.sign(c.x - px) === this.facing && Math.abs(c.x - px) < 200 && Math.abs(c.y - py) < 80)
          .sort((a, b) => this.distTo(a) - this.distTo(b))
          .slice(0, 2 + extra);
        for (const c of targets) this.damageCreature(c, dmg, true);
        this.addEffect({ type: "blade", x: px, y: py, dir: this.facing, radius: 200, life: 0.25 });
        break;
      }
      case "frost": {
        const radius = 150 + w.level * 10;
        for (const c of alive) {
          if (this.distTo(c) <= radius) {
            c.slowUntil = this.elapsed + 2;
            this.damageCreature(c, dmg, true);
          }
        }
        this.addEffect({ type: "frost", x: px, y: py, radius, life: 0.5 });
        break;
      }
      case "firerain": {
        // Rastgele 3+extra dusmani yak
        const shuffled = [...alive].sort(() => this.rng() - 0.5).slice(0, 3 + extra);
        for (const c of shuffled) {
          c.burnUntil = this.elapsed + 3;
          c.burnDps = dmg / 3;
          this.damageCreature(c, dmg * 0.3, true);
          this.addEffect({ type: "firerain", x: c.x, y: c.y, life: 0.6 });
        }
        break;
      }
      case "lightning": {
        // En yakin 1+extra hedefe zincir
        const targets = alive
          .sort((a, b) => this.distTo(a) - this.distTo(b))
          .slice(0, 1 + extra);
        for (const c of targets) {
          this.damageCreature(c, dmg, true);
          this.addEffect({ type: "lightning", x: px, y: py, targetX: c.x, targetY: c.y, life: 0.25 });
        }
        break;
      }
      case "turret": {
        if (this.turrets.length < 3) {
          this.turrets.push({ x: px, y: py, lifeLeft: 8, cooldownLeft: 0 });
        }
        break;
      }
      case "impactor": {
        // En yuksek HP'li dusman
        let strongest: CreatureState | null = null;
        for (const c of alive) if (!strongest || c.hp > strongest.hp) strongest = c;
        if (strongest) {
          this.damageCreature(strongest, dmg, true);
          this.addEffect({ type: "impactor", x: strongest.x, y: strongest.y, life: 0.4 });
        }
        break;
      }
      case "rapid": {
        const target = this.nearest(500);
        if (target) {
          const d = Math.max(1, this.distTo(target));
          const ux = (target.x - px) / d;
          const uy = (target.y - py) / d;
          for (let i = 0; i <= extra; i++) {
            // Ek mermiler hafif sapmali
            const spread = (i - extra / 2) * 0.12;
            const cos = Math.cos(spread), sin = Math.sin(spread);
            this.projectiles.push({
              x: px, y: py - 30,
              vx: (ux * cos - uy * sin) * 600,
              vy: (ux * sin + uy * cos) * 600,
              damage: dmg, hitRadius: 35, color: "#7dd3fc", alive: true,
            });
          }
        }
        break;
      }
    }
  }

  private updateTurrets(dt: number) {
    const turretDef = WEAPONS.find((w) => w.type === "turret")!;
    const owned = this.weapons.find((w) => w.def.type === "turret");
    const dmg = owned ? weaponDamage(turretDef, owned.level, this.damageMult) : 0;

    for (const t of this.turrets) {
      t.lifeLeft -= dt;
      t.cooldownLeft -= dt;
      if (t.cooldownLeft <= 0) {
        t.cooldownLeft = 0.5 / this.attackSpeedMult;
        // Turrete en yakin dusmana ates
        let best: CreatureState | null = null;
        let bestDist = 400;
        for (const c of this.aliveCreatures()) {
          const d = Math.hypot(c.x - t.x, c.y - t.y);
          if (d < bestDist) { best = c; bestDist = d; }
        }
        if (best) {
          const d = Math.max(1, Math.hypot(best.x - t.x, best.y - t.y));
          this.projectiles.push({
            x: t.x, y: t.y - 20,
            vx: ((best.x - t.x) / d) * 500,
            vy: ((best.y - t.y) / d) * 500,
            damage: dmg, hitRadius: 35, color: "#f97316", alive: true,
          });
        }
      }
    }
    this.turrets = this.turrets.filter((t) => t.lifeLeft > 0);
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      for (const c of this.aliveCreatures()) {
        const hitRadius = c.isUltimateBoss ? 200 : (c.isBoss ? 100 : p.hitRadius);
        if (Math.hypot(c.x - p.x, c.y - p.y) <= hitRadius) {
          this.damageCreature(c, p.damage, true);
          p.alive = false;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter(
      (p) => p.alive && p.x > -100 && p.x < ARENA.width + 100 && p.y > -100 && p.y < ARENA.height + 100,
    );
  }

  addText(x: number, y: number, text: string, color: string) {
    this.texts.push({ x, y, text, color, life: 1 });
    if (this.texts.length > 60) this.texts.shift();
  }
}
