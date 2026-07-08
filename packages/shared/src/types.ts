// Game types shared between client and server

export interface GameSession {
  id: string;
  inviteCode: string;
  player1: Player;
  player2: Player;
  createdAt: number;
  status: "waiting" | "active" | "ended";
}

export interface Player {
  id: string;
  userId: string;
  characterId: string;
  level: number;
  hp: number;
  maxHp: number;
  gold: number;
  xp: number;
  weapons: Weapon[];
  books: Book[];
  // Oyuncu sadece yatay eksende hareket eder (sağ/sol)
  x: number;
  facing: "left" | "right";
}

export interface Weapon {
  id: string;
  type: "aoe" | "directional" | "slow" | "burn" | "homing" | "turret" | "single" | "rapid";
  level: number;
  damage: number;
  speed: number;
  projectiles: number;
}

export interface Book {
  id: string;
  type:
    | "damage"
    | "speed"
    | "attackSpeed"
    | "projectiles"
    | "crit"
    | "defense"
    | "hp"
    | "spawnRate";
  level: number;
  bonus: number;
}

export interface Creature {
  id: string;
  type: string;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  ownerId: string;
}

export interface GameEvent {
  type:
    | "playerJoined"
    | "gameStarted"
    | "creatureSpawned"
    | "creatureDied"
    | "playerDamaged"
    | "weaponFired"
    | "levelUp"
    | "gameEnded";
  data: Record<string, any>;
}

// Socket.io event isimleri — client ve server ayni sabitleri kullanir
export const SOCKET_EVENTS = {
  CREATE_ROOM: "room:create",
  JOIN_ROOM: "room:join",
  ROOM_READY: "room:ready",
  GAME_START: "game:start",
  // Rakip tarafinda yaratik spawn ettir (kill basina 2 adet)
  ENEMY_SPAWN: "game:enemySpawn",
  // Kendi arena durumunu rakibe yayinla (pozisyon, hp, level)
  STATE_SYNC: "game:stateSync",
  // Saticidan rakibe debuff satin alindi
  DEBUFF_APPLIED: "game:debuffApplied",
  PLAYER_DIED: "game:playerDied",
  GAME_OVER: "game:over",
} as const;

export const KILLS_SPAWN_ON_ENEMY = 2; // her kill rakibe 2 yaratik

