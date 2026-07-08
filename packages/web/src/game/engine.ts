// Oyun motoru — her istemci KENDI arenasini simule eder.
// Kill'ler socket uzerinden rakibe 2 yaratik olarak gider (GDD 2.1.1).

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
  lifeLeft: number;
  cooldownLeft: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  damage: number;
  hitRadius: number;
  color: string;
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
  x: number; // efekt merkezi
  targetX?: number; // hedefli efektler icin (simsek vb.)
  radius?: number;
  dir?: 1 | -1;
  life: number; // kalan sure
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
  onLevelUp: (choices: LevelUpChoice[]) => void;
  onDeath: () => void;
}

export class GameEngine {
  // Oyuncu
  playerX = ARENA.width / 2;
  facing: 1 | -1 = 1;
  hp = PLAYER_BASE.hp;
  maxHp = PLAYER_BASE.hp;
  gold = 0;
  xp = 0;
  level = 1;
  kills = 0;
  playerAnim: "Idle" | "Walk" | "Hurt" | "Death" = "Idle";
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
  paused = false; // level-up secimi sirasinda
  gameOver = false;
  private spawnTimer = 0;
  private nextUid = 1;
  private pendingSpawns = 0; // rakipten gelen yaratiklar
  private rng: () => number;

  // Rakip debuff'lari (bize uygulanan)
  slowedUntil = 0;
  weakenedUntil = 0;
  monstersBuffedUntil = 0;

  input = { left: false, right: false };

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
  get nearVendor() { return Math.abs(this.playerX - ARENA.vendorX) < ARENA.vendorRange; }

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
      case "steal": {
        const stolen = Math.floor(this.gold * 0.25);
        this.gold -= stolen;
        this.addText(this.playerX, ARENA.groundY - 120, `-${stolen} 🪙 çalındı!`, "#fbbf24");
        break;
      }
    }
  }

  update(dt: number) {
    if (this.paused || this.gameOver) return;
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
    let dir = 0;
    if (this.input.left) dir -= 1;
    if (this.input.right) dir += 1;
    if (dir !== 0) {
      this.playerX = Math.max(40, Math.min(ARENA.width - 40, this.playerX + dir * this.moveSpeed * dt));
      this.facing = dir as 1 | -1;
      if (this.playerAnim === "Idle") this.playerAnim = "Walk";
    } else if (this.playerAnim === "Walk") {
      this.playerAnim = "Idle";
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  private updateSpawning(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnInterval(this.difficulty);
      this.spawnCreature();
    }
    // Rakipten gelenler: her frame en fazla 3 tane cikar (ani yigilmayi yay)
    let burst = Math.min(3, this.pendingSpawns);
    while (burst-- > 0) {
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
    const fromLeft = this.rng() < 0.5;
    const hp = creatureHp(def.baseHp, diff);
    this.creatures.push({
      uid: this.nextUid++,
      def,
      x: fromLeft ? -50 : ARENA.width + 50,
      hp,
      maxHp: hp,
      damage: creatureDamage(def.baseDamage, diff),
      speed: def.speed * (1 + Math.min(1, diff * 0.02)),
      slowUntil: 0,
      burnUntil: 0,
      burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk",
      animTime: 0,
      dead: false,
      contactCd: 0,
      facing: fromLeft ? 1 : -1,
    });
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
      c.facing = dx > 0 ? 1 : -1;

      const dist = Math.abs(dx);
      if (dist > 30) {
        c.x += Math.sign(dx) * c.speed * slowMult * dt;
      }

      // Temas hasari
      c.contactCd -= dt;
      if (dist <= 45 && c.contactCd <= 0) {
        c.contactCd = PLAYER_BASE.contactDamageInterval;
        const dmg = Math.floor(c.damage * buffMult * this.damageTakenMult);
        this.hp -= dmg;
        this.hurtFlash = 0.25;
        this.addText(this.playerX, ARENA.groundY - 130, `-${dmg}`, "#ff4d4d");
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
      this.addText(c.x, ARENA.groundY - 110, crit ? `${dmg}!` : `${dmg}`, crit ? "#ffd700" : "#ffffff");
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
    this.addText(c.x, ARENA.groundY - 90, `+${gold}🪙`, "#fbbf24");
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
      this.maxHp = Math.floor((PLAYER_BASE.hp + (this.level - 1) * 20) * (1 + this.bookLevel("hp") * 0.25));
      this.hp = Math.min(this.maxHp, this.hp + Math.floor(this.maxHp * 0.2)); // level up %20 heal
      this.paused = true;
      this.cb.onLevelUp(this.rollChoices());
    }
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
      this.weapons.push({ def, level: 1, cooldownLeft: 0 });
    } else if (choice.kind === "upgradeWeapon" && choice.weaponType) {
      const w = this.weapons.find((o) => o.def.type === choice.weaponType);
      if (w) w.level++;
    } else if (choice.kind === "newBook" && choice.bookType) {
      const def = BOOKS.find((b) => b.type === choice.bookType)!;
      this.books.push({ def, level: 1 });
    } else if (choice.kind === "upgradeBook" && choice.bookType) {
      const b = this.books.find((o) => o.def.type === choice.bookType);
      if (b) b.level++;
    }
    // HP kitabi alindiysa max can guncelle
    this.maxHp = Math.floor((PLAYER_BASE.hp + (this.level - 1) * 20) * (1 + this.bookLevel("hp") * 0.25));
    this.paused = false;
  }

  // ---- Silah davranislari ----
  private aliveCreatures() { return this.creatures.filter((c) => !c.dead); }

  private nearest(within = Infinity): CreatureState | null {
    let best: CreatureState | null = null;
    let bestDist = within;
    for (const c of this.aliveCreatures()) {
      const d = Math.abs(c.x - this.playerX);
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

    switch (w.def.type) {
      case "aoe": {
        const radius = 120 + w.level * 15;
        for (const c of alive) if (Math.abs(c.x - this.playerX) <= radius) this.damageCreature(c, dmg, true);
        this.addEffect({ type: "aoe", x: this.playerX, radius, life: 0.35 });
        break;
      }
      case "blade": {
        // Baktigi yonde en yakin 2+extra dusman
        const targets = alive
          .filter((c) => Math.sign(c.x - this.playerX) === this.facing && Math.abs(c.x - this.playerX) < 200)
          .sort((a, b) => Math.abs(a.x - this.playerX) - Math.abs(b.x - this.playerX))
          .slice(0, 2 + extra);
        for (const c of targets) this.damageCreature(c, dmg, true);
        this.addEffect({ type: "blade", x: this.playerX, dir: this.facing, radius: 200, life: 0.25 });
        break;
      }
      case "frost": {
        const radius = 150 + w.level * 10;
        for (const c of alive) {
          if (Math.abs(c.x - this.playerX) <= radius) {
            c.slowUntil = this.elapsed + 2;
            this.damageCreature(c, dmg, true);
          }
        }
        this.addEffect({ type: "frost", x: this.playerX, radius, life: 0.5 });
        break;
      }
      case "firerain": {
        // Rastgele 3+extra dusmani yak
        const shuffled = [...alive].sort(() => this.rng() - 0.5).slice(0, 3 + extra);
        for (const c of shuffled) {
          c.burnUntil = this.elapsed + 3;
          c.burnDps = dmg / 3;
          this.damageCreature(c, dmg * 0.3, true);
          this.addEffect({ type: "firerain", x: c.x, life: 0.6 });
        }
        break;
      }
      case "lightning": {
        // En yakin 1+extra hedefe zincir
        const targets = alive
          .sort((a, b) => Math.abs(a.x - this.playerX) - Math.abs(b.x - this.playerX))
          .slice(0, 1 + extra);
        for (const c of targets) {
          this.damageCreature(c, dmg, true);
          this.addEffect({ type: "lightning", x: this.playerX, targetX: c.x, life: 0.25 });
        }
        break;
      }
      case "turret": {
        if (this.turrets.length < 3) {
          this.turrets.push({ x: this.playerX, lifeLeft: 8, cooldownLeft: 0 });
        }
        break;
      }
      case "impactor": {
        // En yuksek HP'li dusman
        let strongest: CreatureState | null = null;
        for (const c of alive) if (!strongest || c.hp > strongest.hp) strongest = c;
        if (strongest) {
          this.damageCreature(strongest, dmg, true);
          this.addEffect({ type: "impactor", x: strongest.x, life: 0.4 });
        }
        break;
      }
      case "rapid": {
        const target = this.nearest(500);
        if (target) {
          const dir = Math.sign(target.x - this.playerX) || this.facing;
          for (let i = 0; i <= extra; i++) {
            this.projectiles.push({
              x: this.playerX, y: ARENA.groundY - 50 - i * 8,
              vx: dir * 600, damage: dmg, hitRadius: 30, color: "#7dd3fc",
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
          const d = Math.abs(c.x - t.x);
          if (d < bestDist) { best = c; bestDist = d; }
        }
        if (best) {
          const dir = Math.sign(best.x - t.x) || 1;
          this.projectiles.push({
            x: t.x, y: ARENA.groundY - 40,
            vx: dir * 500, damage: dmg, hitRadius: 30, color: "#f97316",
          });
        }
      }
    }
    this.turrets = this.turrets.filter((t) => t.lifeLeft > 0);
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      p.x += p.vx * dt;
      for (const c of this.aliveCreatures()) {
        if (Math.abs(c.x - p.x) <= p.hitRadius) {
          this.damageCreature(c, p.damage, true);
          p.vx = 0; // isabet — sil
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.vx !== 0 && p.x > -100 && p.x < ARENA.width + 100);
  }

  addText(x: number, y: number, text: string, color: string) {
    this.texts.push({ x, y, text, color, life: 1 });
    if (this.texts.length > 60) this.texts.shift();
  }
}
