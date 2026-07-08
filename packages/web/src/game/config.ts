// Oyun dengesi ve tanimlar — GAME_DESIGN.md bolum 9'daki formuller

export const ARENA = {
  width: 1280,
  height: 720,
  top: 70, // oynanabilir alan sinirlari (2D hareket)
  bottom: 690,
  playerSpeed: 240, // px/sn (kitaplarla artar)
  vendorX: 90, // satici konumu (sol kenar ortasi)
  vendorY: 380,
  vendorRange: 100, // etkilesim mesafesi
  vendor2X: 1190, // ikinci satici konumu (sag kenar ortasi)
  vendor2Y: 380,
  vendor2Range: 100,
  maxCreatures: 120, // performans siniri — fazlasi kuyrukta bekler
};

export const PLAYER_BASE = {
  hp: 100,
  contactDamageInterval: 0.5, // temas hasari tick suresi (sn)
};

// ---- Scaling formulleri (GDD 9.x) ----
// Denge notu: yaratik buyumesi yavas (oyuncu leveli yetisebilsin),
// oyuncu XP egrisi yumusak (sik level = sik secim = guclenme hissi)
export function creatureHp(base: number, difficulty: number): number {
  return Math.floor(base * Math.pow(1.045, difficulty));
}
export function creatureDamage(base: number, difficulty: number): number {
  return Math.floor(base * Math.pow(1.025, difficulty));
}
export function goldDrop(base: number, difficulty: number): number {
  return base + difficulty * 2;
}
export function xpDrop(base: number, difficulty: number): number {
  return base + difficulty * 3;
}
export function xpToNextLevel(level: number): number {
  return Math.floor(15 * Math.pow(1.15, level - 1));
}
// Spawn araligi (sn) — zorluk arttikca hizlanir (iyice yavaşlatılmış)
export function spawnInterval(difficulty: number): number {
  return Math.max(2.5, 10 / (1 + difficulty * 0.1));
}
// Zorluk: oyun suresi ile artar (her 30 saniyede +1) (hızlandırıldı)
export function difficultyAt(elapsedSec: number): number {
  return Math.floor(elapsedSec / 30);
}

// ---- Yaratiklar ----
export interface CreatureDef {
  id: string;
  name: string;
  sprite: string; // public/assets/creatures/<sprite>/
  baseHp: number;
  baseDamage: number;
  speed: number;
  baseGold: number;
  baseXp: number;
  scale: number; // cizim olcegi
  weight: number; // spawn agirligi
}

export const CREATURES: CreatureDef[] = [
  {
    id: "orc",
    name: "Orc",
    sprite: "orc",
    baseHp: 100,
    baseDamage: 8,
    speed: 70,
    baseGold: 5,
    baseXp: 10,
    scale: 1,
    weight: 5,
  },
  {
    id: "demon",
    name: "Demon",
    sprite: "demon",
    baseHp: 250,
    baseDamage: 15,
    speed: 50,
    baseGold: 12,
    baseXp: 25,
    scale: 1.15,
    weight: 3,
  },
  {
    id: "blood_monster",
    name: "Blood Monster",
    sprite: "blood_monster",
    baseHp: 600,
    baseDamage: 30,
    speed: 35,
    baseGold: 30,
    baseXp: 60,
    scale: 1.3,
    weight: 1,
  },
];

// ---- Silahlar (max 4) ----
export type WeaponType =
  | "aoe"
  | "blade"
  | "frost"
  | "firerain"
  | "lightning"
  | "turret"
  | "impactor"
  | "rapid"
  | "orbit"
  | "poison"
  | "boomerang"
  | "meteor";

export interface WeaponDef {
  type: WeaponType;
  name: string;
  desc: string;
  baseDamage: number;
  cooldown: number; // sn
  emoji: string;
  color: string; // UI ikon + efekt rengi
}

export const WEAPONS: WeaponDef[] = [
  { type: "aoe", name: "AoE Çevirmen", desc: "Etrafında dönen hasar alanı", baseDamage: 13, cooldown: 0.5, emoji: "🌀", color: "#c084fc" },
  { type: "blade", name: "Keskin Bıçak", desc: "Baktığın yöne bıçak savurur", baseDamage: 22, cooldown: 0.8, emoji: "🗡️", color: "#e2e8f0" },
  { type: "frost", name: "Yavaşlatıcı Don", desc: "Yakındakileri %50 yavaşlatır + hasar", baseDamage: 30, cooldown: 1.2, emoji: "❄️", color: "#7dd3fc" },
  { type: "firerain", name: "Ateş Yağmuru", desc: "Rastgele düşmanları yakar (DoT)", baseDamage: 38, cooldown: 1.5, emoji: "🔥", color: "#fb923c" },
  { type: "lightning", name: "Şimşek Zinciri", desc: "En yakın düşmana güdümlü şimşek", baseDamage: 28, cooldown: 1.0, emoji: "⚡", color: "#fef08a" },
  { type: "turret", name: "Turret Fabrikası", desc: "8 sn yaşayan turret bırakır (max 3)", baseDamage: 15, cooldown: 4.0, emoji: "🏰", color: "#f97316" },
  { type: "impactor", name: "İmpaktor", desc: "En güçlü düşmana dev vuruş", baseDamage: 70, cooldown: 2.5, emoji: "💥", color: "#f87171" },
  { type: "rapid", name: "Çok Keskin", desc: "En yakına çok hızlı küçük mermiler", baseDamage: 4, cooldown: 0.15, emoji: "✨", color: "#a5f3fc" },
  { type: "orbit", name: "Dönen Küreler", desc: "Etrafında dönen kürelere değen yanar", baseDamage: 9, cooldown: 0.35, emoji: "🔮", color: "#818cf8" },
  { type: "poison", name: "Zehir Bulutu", desc: "Bulunduğun yere kalıcı zehir bulutu (4sn)", baseDamage: 12, cooldown: 2.0, emoji: "☠️", color: "#4ade80" },
  { type: "boomerang", name: "Bumerang", desc: "Fırlar, deler, geri döner — çift vuruş", baseDamage: 26, cooldown: 1.3, emoji: "🪃", color: "#fbbf24" },
  { type: "meteor", name: "Meteor Çağrısı", desc: "Gökten meteor düşer — alan patlaması", baseDamage: 55, cooldown: 3.0, emoji: "☄️", color: "#f472b6" },
];

// ---- Secilebilir kahramanlar (cizim yerine hazir sprite secimi) ----
export interface HeroDef {
  id: string; // sprite klasoru
  name: string;
}
export const HEROES: HeroDef[] = [
  { id: "soldier", name: "Asker" },
  { id: "orc", name: "Orc" },
  { id: "demon", name: "Demon" },
  { id: "blood_monster", name: "Kan Canavarı" },
];

// ---- Mob chat replikleri — rastgele moblar konusur ----
export const MOB_LINES = [
  "öldürün piçi",
  "taşşaklarına vurun",
  "öldürün öldürün",
  "kafasını koparın",
  "çiğ çiğ yiyin onu",
  "annemi özledim.",
  "abi AI ya",
  "vutututu",
];

// Silah seviye carpani: her seviye +%25 hasar, -%5 cooldown
export function weaponDamage(def: WeaponDef, level: number, playerDamageMult: number): number {
  return Math.floor(def.baseDamage * Math.pow(1.25, level - 1) * playerDamageMult);
}
export function weaponCooldown(def: WeaponDef, level: number, attackSpeedMult: number): number {
  return (def.cooldown * Math.pow(0.95, level - 1)) / attackSpeedMult;
}

// ---- Kitaplar (max 4, seviye atlayarak stack) ----
export type BookType =
  | "damage"
  | "moveSpeed"
  | "attackSpeed"
  | "projectiles"
  | "crit"
  | "defense"
  | "hp"
  | "greed";

export interface BookDef {
  type: BookType;
  name: string;
  desc: string;
  emoji: string;
  perLevel: number; // seviye basina bonus
}

export const BOOKS: BookDef[] = [
  { type: "damage", name: "Keskinlik Tomarı", desc: "+%15 hasar / seviye", emoji: "📕", perLevel: 0.15 },
  { type: "moveSpeed", name: "Hız Elması", desc: "+%10 hareket hızı / seviye", emoji: "📗", perLevel: 0.1 },
  { type: "attackSpeed", name: "Saldırı İçgüdüsü", desc: "+%12 saldırı hızı / seviye", emoji: "📙", perLevel: 0.12 },
  { type: "projectiles", name: "Çok Atış Kitabı", desc: "+1 mermi / seviye", emoji: "📘", perLevel: 1 },
  { type: "crit", name: "Kritik Aydınlanma", desc: "+%10 krit şansı / seviye (2x hasar)", emoji: "📓", perLevel: 0.1 },
  { type: "defense", name: "Kalkan Ruhu", desc: "-%8 alınan hasar / seviye", emoji: "📔", perLevel: 0.08 },
  { type: "hp", name: "Yaşam Kaynağı", desc: "+%25 max can / seviye", emoji: "📖", perLevel: 0.25 },
  { type: "greed", name: "Açgözlülük", desc: "+%20 altın / seviye", emoji: "💰", perLevel: 0.2 },
];

// ---- Satici debuff'lari (rakibe uygulanir) ----
export interface DebuffDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  emoji: string;
  duration: number; // sn (0 = anlik)
}

export const DEBUFFS: DebuffDef[] = [
  { id: "swarm", name: "Yaratık Yağmuru", desc: "Rakibe anında 10 yaratık", cost: 100, emoji: "🌧️", duration: 0 },
  { id: "slow", name: "Ağırlaştırma", desc: "Rakip %40 yavaşlar (8sn)", cost: 80, emoji: "🐌", duration: 8 },
  { id: "weaken", name: "Zayıflatma", desc: "Rakip %30 az hasar vurur (10sn)", cost: 120, emoji: "🥀", duration: 10 },
  { id: "steal", name: "Altın Hırsızı", desc: "Rakibin altınının %25'ini çal", cost: 150, emoji: "🪙", duration: 0 },
  { id: "buffMonsters", name: "Kan Büyüsü", desc: "Rakip yaratıkları %50 güçlenir (15sn)", cost: 200, emoji: "🩸", duration: 15 },
  { id: "spawnBoss", name: "Boss Çağır", desc: "Rakibe dev bir boss yollar (5x boyut, dev can, yavaş)", cost: 250, emoji: "👹", duration: 0 },
];
