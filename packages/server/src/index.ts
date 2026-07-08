import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";

const PORT = Number(process.env.PORT ?? 3001);
const INVITE_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_PLAYERS = 8; // 4v4'e kadar

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

interface RoomPlayer {
  id: string;
  name: string;
  team: 0 | 1;
  dead: boolean;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, RoomPlayer>;
  createdAt: number;
  status: "waiting" | "active" | "ended";
  rematchVotes: Set<string>;
}

const rooms = new Map<string, Room>();

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.status === "waiting" && now - room.createdAt > INVITE_CODE_TTL_MS) {
      io.to(code).emit("room:closed");
      rooms.delete(code);
    }
  }
}, 60_000);

function playerList(room: Room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, team: p.team, isHost: p.id === room.hostId,
  }));
}

function broadcastPlayers(room: Room) {
  io.to(room.code).emit("room:players", { players: playerList(room) });
}

function autoTeam(room: Room): 0 | 1 {
  let t0 = 0, t1 = 0;
  for (const p of room.players.values()) p.team === 0 ? t0++ : t1++;
  return t0 <= t1 ? 0 : 1;
}

/** Rastgele canli dusman sec (kill echo & debuff hedefi) */
function pickEnemy(room: Room, fromId: string): string | null {
  const me = room.players.get(fromId);
  if (!me) return null;
  const enemies = [...room.players.values()].filter((p) => p.team !== me.team && !p.dead);
  if (enemies.length === 0) return null;
  return enemies[Math.floor(Math.random() * enemies.length)].id;
}

function startGame(room: Room) {
  room.status = "active";
  room.rematchVotes.clear();
  for (const p of room.players.values()) p.dead = false;
  io.to(room.code).emit("game:start", {
    code: room.code,
    seed: Math.floor(Math.random() * 2 ** 31),
    startedAt: Date.now(),
    players: playerList(room),
  });
}

io.on("connection", (socket: Socket) => {
  socket.on("room:create", (name: string, ack: (res: { code: string }) => void) => {
    const code = generateInviteCode();
    const room: Room = {
      code,
      hostId: socket.id,
      players: new Map(),
      createdAt: Date.now(),
      status: "waiting",
      rematchVotes: new Set(),
    };
    room.players.set(socket.id, {
      id: socket.id, name: (name || "Oyuncu").slice(0, 16), team: 0, dead: false,
    });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ code });
    broadcastPlayers(room);
  });

  socket.on(
    "room:join",
    (code: string, name: string, ack: (res: { ok: boolean; error?: string }) => void) => {
      const room = rooms.get(code?.toUpperCase());
      if (!room) return ack({ ok: false, error: "Oda bulunamadı" });
      if (room.status !== "waiting") return ack({ ok: false, error: "Oyun çoktan başladı" });
      if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: "Oda dolu (max 8)" });

      room.players.set(socket.id, {
        id: socket.id, name: (name || "Oyuncu").slice(0, 16), team: autoTeam(room), dead: false,
      });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      ack({ ok: true });
      broadcastPlayers(room);
    },
  );

  // Lobide takim degistir
  socket.on("room:setTeam", (team: 0 | 1) => {
    const room = rooms.get(socket.data.roomCode as string);
    if (!room || room.status !== "waiting") return;
    const p = room.players.get(socket.id);
    if (p && (team === 0 || team === 1)) {
      p.team = team;
      broadcastPlayers(room);
    }
  });

  // Host oyunu baslatir — her iki takimda en az 1 oyuncu olmali
  socket.on("room:start", (ack?: (res: { ok: boolean; error?: string }) => void) => {
    const room = rooms.get(socket.data.roomCode as string);
    if (!room || room.hostId !== socket.id || room.status !== "waiting") {
      return ack?.({ ok: false, error: "Sadece host başlatabilir" });
    }
    const teams = [0, 0];
    for (const p of room.players.values()) teams[p.team]++;
    if (teams[0] === 0 || teams[1] === 0) {
      return ack?.({ ok: false, error: "Her iki takımda da en az 1 oyuncu olmalı" });
    }
    ack?.({ ok: true });
    startGame(room);
  });

  // Gonderen kimligiyle herkese aktar (arena izleme, karakter, chat)
  for (const event of ["game:stateSync", "game:charSync", "game:chat"]) {
    socket.on(event, (payload: Record<string, unknown>) => {
      const code = socket.data.roomCode as string | undefined;
      if (!code) return;
      socket.to(code).emit(event, { ...payload, from: socket.id });
    });
  }

  // Kill echo & debuff: rastgele canli DUSMANA gider
  for (const event of ["game:enemySpawn", "game:debuffApplied"]) {
    socket.on(event, (payload: Record<string, unknown>) => {
      const room = rooms.get(socket.data.roomCode as string);
      if (!room || room.status !== "active") return;
      const targetId = pickEnemy(room, socket.id);
      if (targetId) io.to(targetId).emit(event, { ...payload, from: socket.id });
    });
  }

  // Ayni haritadaki takim arkadasina yaratik temas hasari
  socket.on("game:teamHit", (payload: { to: string; damage: number }) => {
    const room = rooms.get(socket.data.roomCode as string);
    if (!room || room.status !== "active") return;
    const sender = room.players.get(socket.id);
    const target = room.players.get(payload?.to);
    if (sender && target && sender.team === target.team && !target.dead) {
      io.to(target.id).emit("game:teamHit", { damage: Number(payload.damage) || 0 });
    }
  });

  socket.on("game:playerDied", () => {
    const room = rooms.get(socket.data.roomCode as string);
    if (!room || room.status !== "active") return;
    const p = room.players.get(socket.id);
    if (!p || p.dead) return;
    p.dead = true;
    io.to(room.code).emit("game:playerDead", { id: socket.id });

    // Takim tamamen oldu mu?
    const teamAlive = [false, false];
    for (const pl of room.players.values()) if (!pl.dead) teamAlive[pl.team] = true;
    if (!teamAlive[0] || !teamAlive[1]) {
      room.status = "ended";
      room.rematchVotes.clear();
      io.to(room.code).emit("game:over", { winnerTeam: teamAlive[0] ? 0 : 1 });
    }
  });

  socket.on("game:rematch", () => {
    const room = rooms.get(socket.data.roomCode as string);
    if (!room || room.status !== "ended") return;
    room.rematchVotes.add(socket.id);
    socket.to(room.code).emit("game:rematchRequested", { count: room.rematchVotes.size, total: room.players.size });
    if (room.rematchVotes.size >= room.players.size) startGame(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode as string | undefined;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const p = room.players.get(socket.id);
    room.players.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(code);
      return;
    }
    // Host ayrildiysa yeni host ata
    if (room.hostId === socket.id) {
      room.hostId = [...room.players.keys()][0];
    }

    if (room.status === "waiting") {
      broadcastPlayers(room);
    } else if (room.status === "active" && p && !p.dead) {
      io.to(code).emit("game:playerDead", { id: socket.id, reason: "disconnect" });
      const teamAlive = [false, false];
      for (const pl of room.players.values()) if (!pl.dead) teamAlive[pl.team] = true;
      if (!teamAlive[0] || !teamAlive[1]) {
        room.status = "ended";
        io.to(code).emit("game:over", { winnerTeam: teamAlive[0] ? 0 : 1, reason: "disconnect" });
      }
    } else if (room.status === "ended") {
      // Rematch bekleyenler icin: kalan herkes oyladiysa baslat
      if (room.rematchVotes.size >= room.players.size && room.players.size >= 2) startGame(room);
      else io.to(code).emit("room:playerLeft", { id: socket.id });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Socket.io sunucusu ${PORT} portunda çalışıyor`);
});
