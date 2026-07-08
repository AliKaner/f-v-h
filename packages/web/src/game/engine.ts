// Oyun motoru — her istemci KENDI arenasini simule eder.
// Kill'ler socket uzerinden rastgele bir dusmana 2 yaratik olarak gider.
// DENGE: rakipten gelen (echo) yaratiklar kesilince TEKRAR echo uretmez —
// yoksa mob sayisi ussel patliyordu. Boylece buyume lineer kalir.
// 2D hareket, level up oyunu durdurmaz, moblar ve oyuncu konusabilir.

import {
  ARENA, PLAYER_BASE, CREATURES, WEAPONS, BOOKS,
  MOB_LINES, MOB_DEATH_LINES, COWARD_CHANCE, COWARD_LINES,
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
  dead: boolean;
  contactCd: number;
  facing: 1 | -1;
  level: number;
  isBoss?: boolean;
  isUltimateBoss?: boolean;
  fromEcho?: boolean; // rakip kill'inden geldi — kesilince echo uretmez
  say?: string; // mob chat balonu
  sayUntil: number;
  coward?: boolean; // korkak mob — oyuncudan kacar
}

// Ayni haritadaki takim arkadasi (pozisyonu senkrondan gelir)
export interface Ally {
  id: string;
  x: number;
  y: number;
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
  src: WeaponType;
}

export interface Boomerang {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  t: number;
  returning: boolean;
  hitUids: Set<number>;
}

export interface PoisonZone {
  x: number;
  y: number;
  radius: number;
  dps: number;
  until: number;
  tickTimer: number;
}

export interface Meteor {
  x: number;
  y: number;
  timer: number; // dusme sayaci
  damage: number;
  radius: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

export interface WeaponEffect {
  type: WeaponType | "levelup";
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
  onKill: (count: number) => void;
  onLevelUp: (choices: LevelUpChoice[]) => void;
  onDeath: () => void;
  // Yaratik ayni haritadaki takim arkadasina carpti — hasari ona ilet
  onAllyHit?: (allyId: string, damage: number) => void;
}

export class GameEngine {
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
  levelUpFlash = 0; // level atlama aurasi (1 → 0)
  orbitAngle = 0; // donen kureler acisi

  // Chat balonlari
  playerSay?: string;
  playerSayUntil = 0;

  weapons: OwnedWeapon[] = [];
  books: OwnedBook[] = [];

  creatures: CreatureState[] = [];
  turrets: Turret[] = [];
  projectiles: Projectile[] = [];
  boomerangs: Boomerang[] = [];
  zones: PoisonZone[] = [];
  meteors: Meteor[] = [];
  texts: FloatingText[] = [];
  effects: WeaponEffect[] = [];

  elapsed = 0;
  gameOver = false;
  // Oyun sonu istatistigi: hangi silah toplam ne kadar vurdu
  damageByWeapon: Record<string, number> = {};
  private spawnTimer = 0;
  private mobChatTimer = 2;
  private nextUid = 1;
  private pendingSpawns = 0; // rakiplerden gelen echo yaratiklar
  private pendingReleaseTimer = 0;
  private rng: () => number;
  // Optimizasyon: canli yaratik listesi frame basina 1 kez hesaplanir
  private alive: CreatureState[] = [];

  slowedUntil = 0;
  weakenedUntil = 0;
  monstersBuffedUntil = 0;
  monsterLevelOffset = 0;

  // Ayni haritada oynayan takim arkadaslari — GameCanvas her frame gunceller.
  // Yaratiklar en yakin takim uyesini hedefler; temas hasari ona iletilir.
  allies: Ally[] = [];

  input = { left: false, right: false, up: false, down: false };

  constructor(seed: number, private cb: EngineCallbacks) {
    let s = seed >>> 0;
    this.rng = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const starter = WEAPONS[Math.floor(this.rng() * WEAPONS.length)];
    this.weapons.push({ def: starter, level: 1, cooldownLeft: 0 });
  }

  // ---- Stat carpanlari ----
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

  queueEnemySpawns(count: number) { this.pendingSpawns += count; }

  /** Oyuncu chat balonu */
  say(text: string) {
    const clean = text.trim().slice(0, 60);
    if (!clean) return;
    this.playerSay = clean;
    this.playerSayUntil = this.elapsed + 4;
  }

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
        this.addText(this.playerX, this.playerY - 110, "Canavarlar seviye atladı! +1", "#ef4444");
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
      case "spawnBoss": this.spawnBossCreature(); break;
      case "spawnUltimateBoss": this.spawnUltimateBossCreature(); break;
      case "steal": {
        const stolen = Math.floor(this.gold * 0.25);
        this.gold -= stolen;
        this.addText(this.playerX, this.playerY - 90, `-${stolen} altın çalındı!`, "#fbbf24");
        break;
      }
    }
  }

  update(dt: number) {
    if (this.gameOver) return;
    this.elapsed += dt;
    this.playerAnimTime += dt;
    this.levelUpFlash = Math.max(0, this.levelUpFlash - dt * 0.8);
    this.orbitAngle += dt * 3.2;

    // Canli listesi cache (frame basina 1 allocation)
    this.alive = this.creatures.filter((c) => !c.dead);

    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updateMobChat(dt);
    this.updateCreatures(dt);
    this.updateWeapons(dt);
    this.updateTurrets(dt);
    this.updateProjectiles(dt);
    this.updateBoomerangs(dt);
    this.updateZones(dt);
    this.updateMeteors(dt);

    for (const t of this.texts) { t.life -= dt; t.y -= 40 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
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
      if (this.creatures.length < ARENA.maxCreatures) this.spawnCreature(false);
    }
    this.pendingReleaseTimer -= dt;
    if (this.pendingSpawns > 0 && this.pendingReleaseTimer <= 0 && this.creatures.length < ARENA.maxCreatures) {
      this.pendingReleaseTimer = 0.15;
      this.pendingSpawns--;
      this.spawnCreature(true); // echo — kesilince tekrar echo uretmez
    }
  }

  /** Rastgele moblar konusur — korku ve komedi */
  private updateMobChat(dt: number) {
    this.mobChatTimer -= dt;
    if (this.mobChatTimer > 0) return;
    this.mobChatTimer = 1.5 + this.rng() * 2;
    if (this.alive.length === 0 || this.rng() > 0.55) return;
    const c = this.alive[Math.floor(this.rng() * this.alive.length)];
    const lines = c.coward ? COWARD_LINES : MOB_LINES;
    c.say = lines[Math.floor(this.rng() * lines.length)];
    c.sayUntil = this.elapsed + 2.5;
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

  private edgeSpawnPoint(margin: number): { x: number; y: number } {
    const edge = Math.floor(this.rng() * 4);
    switch (edge) {
      case 0: return { x: -margin, y: ARENA.top + this.rng() * (ARENA.bottom - ARENA.top) };
      case 1: return { x: ARENA.width + margin, y: ARENA.top + this.rng() * (ARENA.bottom - ARENA.top) };
      case 2: return { x: this.rng() * ARENA.width, y: ARENA.top - margin };
      default: return { x: this.rng() * ARENA.width, y: ARENA.bottom + margin };
    }
  }

  private spawnCreature(fromEcho: boolean) {
    const def = this.pickCreature();
    const level = this.difficulty + this.monsterLevelOffset;
    const { x, y } = this.edgeSpawnPoint(50);
    const hp = creatureHp(def.baseHp, level);
    const coward = this.rng() < COWARD_CHANCE;
    const c: CreatureState = {
      uid: this.nextUid++,
      def, x, y,
      hp, maxHp: hp,
      damage: creatureDamage(def.baseDamage, level),
      speed: def.speed * (1 + Math.min(1, level * 0.02)),
      slowUntil: 0, burnUntil: 0, burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk", animTime: 0, dead: false, contactCd: 0,
      facing: x < this.playerX ? 1 : -1,
      level, fromEcho, sayUntil: 0, coward,
    };
    if (coward) {
      c.say = COWARD_LINES[Math.floor(this.rng() * COWARD_LINES.length)];
      c.sayUntil = this.elapsed + 3;
    }
    this.creatures.push(c);
  }

  private spawnBossCreature() {
    const def = this.pickCreature();
    const level = this.difficulty + this.monsterLevelOffset;
    const { x, y } = this.edgeSpawnPoint(100);
    const hp = creatureHp(def.baseHp, level) * 8;
    this.creatures.push({
      uid: this.nextUid++,
      def, x, y,
      hp, maxHp: hp,
      damage: creatureDamage(def.baseDamage, level) * 2,
      speed: def.speed * 0.5,
      slowUntil: 0, burnUntil: 0, burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk", animTime: 0, dead: false, contactCd: 0,
      facing: x < this.playerX ? 1 : -1,
      level, isBoss: true, fromEcho: true, sayUntil: 0,
    });
    this.addText(this.playerX, this.playerY - 130, "DEV BOSS GELDİ!", "#ef4444");
  }

  private spawnUltimateBossCreature() {
    const def = this.pickCreature();
    const level = this.difficulty + this.monsterLevelOffset;
    const { x, y } = this.edgeSpawnPoint(200);
    const hp = creatureHp(def.baseHp, level) * 100;
    this.creatures.push({
      uid: this.nextUid++,
      def, x, y,
      hp, maxHp: hp,
      damage: creatureDamage(def.baseDamage, level) * 5,
      speed: def.speed * 0.28,
      slowUntil: 0, burnUntil: 0, burnDps: 0,
      buffed: this.elapsed < this.monstersBuffedUntil,
      anim: "Walk", animTime: 0, dead: false, contactCd: 0,
      facing: x < this.playerX ? 1 : -1,
      level, isUltimateBoss: true, fromEcho: true, sayUntil: 0,
    });
    this.addText(this.playerX, this.playerY - 140, "ULTIMATE BOSS GELDİ!!!", "#ef4444");
  }

  private updateCreatures(dt: number) {
    for (const c of this.creatures) {
      c.animTime += dt;
      if (c.dead) continue;
      if (c.say && this.elapsed > c.sayUntil) c.say = undefined;

      if (this.elapsed < c.burnUntil) this.damageCreature(c, c.burnDps * dt, false, false, "firerain");
      if (c.dead) continue;

      const slowMult = this.elapsed < c.slowUntil ? 0.5 : 1;
      const buffMult = c.buffed ? 1.5 : 1;

      // Hedef: en yakin takim uyesi (ben + ayni haritadaki muttefikler)
      let tx = this.playerX, ty = this.playerY;
      let targetAlly: Ally | null = null;
      let bestDist = Math.hypot(this.playerX - c.x, this.playerY - c.y);
      for (const a of this.allies) {
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        if (d < bestDist) { bestDist = d; tx = a.x; ty = a.y; targetAlly = a; }
      }

      const dx = tx - c.x;
      const dy = ty - c.y;
      const dist = Math.hypot(dx, dy);
      c.facing = dx > 0 ? 1 : -1;

      if (c.coward) {
        // Korkak mob: hedefe yaklasilinca ters yone kacar
        if (dist < 260) {
          const step = c.speed * slowMult * dt * 1.2;
          c.x = Math.max(-40, Math.min(ARENA.width + 40, c.x - (dx / Math.max(1, dist)) * step));
          c.y = Math.max(ARENA.top - 40, Math.min(ARENA.bottom + 40, c.y - (dy / Math.max(1, dist)) * step));
          c.facing = dx > 0 ? -1 : 1;
        }
      } else if (dist > 30) {
        const step = c.speed * slowMult * dt;
        c.x += (dx / dist) * step;
        c.y += (dy / dist) * step;
      }

      c.contactCd -= dt;
      const contactDist = c.isUltimateBoss ? 220 : (c.isBoss ? 110 : 45);
      if (dist <= contactDist && c.contactCd <= 0 && !c.coward) {
        c.contactCd = PLAYER_BASE.contactDamageInterval;
        const rawDmg = Math.max(1, Math.floor(c.damage * buffMult));
        if (targetAlly) {
          // Takim arkadasina carpti — hasar ona gonderilir
          this.cb.onAllyHit?.(targetAlly.id, rawDmg);
        } else {
          const dmg = Math.max(1, Math.floor(rawDmg * this.damageTakenMult));
          this.hp -= dmg;
          this.hurtFlash = 0.25;
          this.addText(this.playerX, this.playerY - 90, `-${dmg}`, "#ff4d4d");
        }
      }
    }
    this.creatures = this.creatures.filter((c) => !c.dead || c.animTime < 0.6);
  }

  /** Takim arkadasinin yaratigi bana carpti (socket uzerinden gelir) */
  receiveTeamHit(rawDamage: number) {
    if (this.gameOver) return;
    const dmg = Math.max(1, Math.floor(rawDamage * this.damageTakenMult));
    this.hp -= dmg;
    this.hurtFlash = 0.25;
    this.addText(this.playerX, this.playerY - 90, `-${dmg}`, "#ff4d4d");
  }

  private damageCreature(c: CreatureState, amount: number, canCrit: boolean, showText = true, src?: WeaponType) {
    if (c.dead) return;
    let dmg = amount;
    let crit = false;
    if (canCrit && this.rng() < this.critChance) {
      dmg *= 2;
      crit = true;
    }
    dmg = Math.max(1, Math.floor(dmg));
    c.hp -= dmg;
    if (src) this.damageByWeapon[src] = (this.damageByWeapon[src] ?? 0) + dmg;
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
    const gold = Math.floor(goldDrop(c.def.baseGold, diff) * this.goldMult * (c.isBoss ? 5 : c.isUltimateBoss ? 20 : 1));
    const xp = xpDrop(c.def.baseXp, diff) * (c.isBoss ? 5 : c.isUltimateBoss ? 20 : 1);
    this.gold += gold;
    this.addText(c.x, c.y - 50, `+${gold}`, "#fbbf24");
    // Olum replikleri — %20 sansla son sozler
    if (this.rng() < 0.2) {
      this.addText(c.x, c.y - 85, `"${MOB_DEATH_LINES[Math.floor(this.rng() * MOB_DEATH_LINES.length)]}"`, "#94a3b8");
    }
    this.gainXp(xp);

    // CEKIRDEK MEKANIK: kendi yaratigini kesersen rakibe 2 tane gider.
    // Echo yaratiklar (rakipten gelenler) geri echo uretmez — ussel patlama onlenir.
    if (!c.fromEcho) this.cb.onKill(2);
  }

  private gainXp(amount: number) {
    this.xp += amount;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.recalcMaxHp();
      this.hp = Math.min(this.maxHp, this.hp + Math.floor(this.maxHp * 0.2));
      this.levelUpFlash = 1; // altin aura patlamasi
      this.effects.push({ type: "levelup", x: this.playerX, y: this.playerY, life: 1, maxLife: 1 });
      this.cb.onLevelUp(this.rollChoices());
    }
  }

  private recalcMaxHp() {
    this.maxHp = Math.floor((PLAYER_BASE.hp + (this.level - 1) * 20) * (1 + this.bookLevel("hp") * 0.25));
  }

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

  // ---- Silahlar ----
  private distTo(c: { x: number; y: number }): number {
    return Math.hypot(c.x - this.playerX, c.y - this.playerY);
  }

  private nearest(within = Infinity): CreatureState | null {
    let best: CreatureState | null = null;
    let bestDist = within;
    for (const c of this.alive) {
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
    if (this.effects.length > 80) this.effects.shift();
  }

  private fireWeapon(w: OwnedWeapon) {
    const dmg = weaponDamage(w.def, w.level, this.damageMult);
    const alive = this.alive;
    const extra = this.extraProjectiles;
    const px = this.playerX, py = this.playerY;

    switch (w.def.type) {
      case "aoe": {
        const radius = 120 + w.level * 15;
        for (const c of alive) if (this.distTo(c) <= radius) this.damageCreature(c, dmg, true, true, "aoe");
        this.addEffect({ type: "aoe", x: px, y: py, radius, life: 0.35 });
        break;
      }
      case "blade": {
        const targets = alive
          .filter((c) => Math.sign(c.x - px) === this.facing && Math.abs(c.x - px) < 200 && Math.abs(c.y - py) < 80)
          .sort((a, b) => this.distTo(a) - this.distTo(b))
          .slice(0, 2 + extra);
        for (const c of targets) this.damageCreature(c, dmg, true, true, "blade");
        this.addEffect({ type: "blade", x: px, y: py, dir: this.facing, radius: 200, life: 0.25 });
        break;
      }
      case "frost": {
        const radius = 150 + w.level * 10;
        for (const c of alive) {
          if (this.distTo(c) <= radius) {
            c.slowUntil = this.elapsed + 2;
            this.damageCreature(c, dmg, true, true, "frost");
          }
        }
        this.addEffect({ type: "frost", x: px, y: py, radius, life: 0.5 });
        break;
      }
      case "firerain": {
        const shuffled = [...alive].sort(() => this.rng() - 0.5).slice(0, 3 + extra);
        for (const c of shuffled) {
          c.burnUntil = this.elapsed + 3;
          c.burnDps = dmg / 3;
          this.damageCreature(c, dmg * 0.3, true, true, "firerain");
          this.addEffect({ type: "firerain", x: c.x, y: c.y, life: 0.6 });
        }
        break;
      }
      case "lightning": {
        const targets = [...alive]
          .sort((a, b) => this.distTo(a) - this.distTo(b))
          .slice(0, 1 + extra);
        for (const c of targets) {
          this.damageCreature(c, dmg, true, true, "lightning");
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
        let strongest: CreatureState | null = null;
        for (const c of alive) if (!strongest || c.hp > strongest.hp) strongest = c;
        if (strongest) {
          this.damageCreature(strongest, dmg, true, true, "impactor");
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
            const spread = (i - extra / 2) * 0.12;
            const cos = Math.cos(spread), sin = Math.sin(spread);
            this.projectiles.push({
              x: px, y: py - 30,
              vx: (ux * cos - uy * sin) * 600,
              vy: (ux * sin + uy * cos) * 600,
              damage: dmg, hitRadius: 35, color: "#7dd3fc", alive: true, src: "rapid",
            });
          }
        }
        break;
      }
      case "orbit": {
        // Donen kureler: halka bandindaki dusmanlara vurur
        const rIn = 60, rOut = 130 + w.level * 8;
        for (const c of alive) {
          const d = this.distTo(c);
          if (d >= rIn && d <= rOut) this.damageCreature(c, dmg, true, true, "orbit");
        }
        break;
      }
      case "poison": {
        if (this.zones.length < 3) {
          this.zones.push({
            x: px, y: py, radius: 100 + w.level * 10,
            dps: dmg, until: this.elapsed + 4, tickTimer: 0,
          });
        }
        break;
      }
      case "boomerang": {
        const target = this.nearest(450);
        const dir = target
          ? { x: (target.x - px) / Math.max(1, this.distTo(target)), y: (target.y - py) / Math.max(1, this.distTo(target)) }
          : { x: this.facing, y: 0 };
        for (let i = 0; i <= extra; i++) {
          const spread = (i - extra / 2) * 0.25;
          const cos = Math.cos(spread), sin = Math.sin(spread);
          this.boomerangs.push({
            x: px, y: py - 20,
            vx: (dir.x * cos - dir.y * sin) * 450,
            vy: (dir.x * sin + dir.y * cos) * 450,
            damage: dmg, t: 0, returning: false, hitUids: new Set(),
          });
        }
        break;
      }
      case "meteor": {
        // Rastgele dusman kumesine meteor cagir
        const target = alive.length > 0 ? alive[Math.floor(this.rng() * alive.length)] : null;
        this.meteors.push({
          x: target ? target.x : px + (this.rng() - 0.5) * 300,
          y: target ? target.y : py + (this.rng() - 0.5) * 200,
          timer: 0.8, damage: dmg, radius: 120 + w.level * 10,
        });
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
        let best: CreatureState | null = null;
        let bestDist = 400;
        for (const c of this.alive) {
          const d = Math.hypot(c.x - t.x, c.y - t.y);
          if (d < bestDist) { best = c; bestDist = d; }
        }
        if (best) {
          const d = Math.max(1, Math.hypot(best.x - t.x, best.y - t.y));
          this.projectiles.push({
            x: t.x, y: t.y - 20,
            vx: ((best.x - t.x) / d) * 500,
            vy: ((best.y - t.y) / d) * 500,
            damage: dmg, hitRadius: 35, color: "#f97316", alive: true, src: "turret",
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
      for (const c of this.alive) {
        if (c.dead) continue;
        const hitRadius = c.isUltimateBoss ? 200 : (c.isBoss ? 100 : p.hitRadius);
        if (Math.hypot(c.x - p.x, c.y - p.y) <= hitRadius) {
          this.damageCreature(c, p.damage, true, true, p.src);
          p.alive = false;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter(
      (p) => p.alive && p.x > -100 && p.x < ARENA.width + 100 && p.y > -100 && p.y < ARENA.height + 100,
    );
  }

  private updateBoomerangs(dt: number) {
    for (const b of this.boomerangs) {
      b.t += dt;
      // 0.5 sn sonra geri don — donuste tekrar vurabilir
      if (!b.returning && b.t > 0.5) {
        b.returning = true;
        b.hitUids.clear();
      }
      if (b.returning) {
        const dx = this.playerX - b.x;
        const dy = this.playerY - b.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        b.vx = (dx / d) * 520;
        b.vy = (dy / d) * 520;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (const c of this.alive) {
        if (c.dead || b.hitUids.has(c.uid)) continue;
        const hitRadius = c.isUltimateBoss ? 200 : (c.isBoss ? 100 : 45);
        if (Math.hypot(c.x - b.x, c.y - b.y) <= hitRadius) {
          b.hitUids.add(c.uid);
          this.damageCreature(c, b.damage, true, true, "boomerang");
        }
      }
    }
    this.boomerangs = this.boomerangs.filter(
      (b) => b.t < 4 && !(b.returning && Math.hypot(b.x - this.playerX, b.y - this.playerY) < 40),
    );
  }

  private updateZones(dt: number) {
    for (const z of this.zones) {
      z.tickTimer -= dt;
      if (z.tickTimer <= 0) {
        z.tickTimer = 0.5; // yarim saniyede bir zehir vurusu
        for (const c of this.alive) {
          if (!c.dead && Math.hypot(c.x - z.x, c.y - z.y) <= z.radius) {
            this.damageCreature(c, z.dps * 0.5, false, true, "poison");
          }
        }
      }
    }
    this.zones = this.zones.filter((z) => this.elapsed < z.until);
  }

  private updateMeteors(dt: number) {
    for (const m of this.meteors) {
      m.timer -= dt;
      if (m.timer <= 0) {
        // Patlama!
        for (const c of this.alive) {
          if (!c.dead && Math.hypot(c.x - m.x, c.y - m.y) <= m.radius) {
            this.damageCreature(c, m.damage, true, true, "meteor");
          }
        }
        this.addEffect({ type: "meteor", x: m.x, y: m.y, radius: m.radius, life: 0.45 });
      }
    }
    this.meteors = this.meteors.filter((m) => m.timer > 0);
  }

  addText(x: number, y: number, text: string, color: string) {
    this.texts.push({ x, y, text, color, life: 1 });
    if (this.texts.length > 60) this.texts.shift();
  }
}
