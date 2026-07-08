import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";

const PORT = Number(process.env.PORT ?? 3001);
const INVITE_CODE_TTL_MS = 15 * 60 * 1000; // 15 dakika

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }, // prod'da web origin'i ile sinirla
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

interface Room {
  code: string;
  hostSocketId: string;
  guestSocketId: string | null;
  createdAt: number;
  status: "waiting" | "active" | "ended";
  rematchVotes: Set<string>;
}

const rooms = new Map<string, Room>();

function generateInviteCode(): string {
  // Karistirilabilecek karakterler (0/O, 1/I) haric 4 karakterlik kod
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(
      { length: 4 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}

// Suresi dolan bekleyen odalari temizle
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.status === "waiting" && now - room.createdAt > INVITE_CODE_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 60_000);

io.on("connection", (socket: Socket) => {
  socket.on("room:create", (ack: (res: { code: string }) => void) => {
    const code = generateInviteCode();
    rooms.set(code, {
      code,
      hostSocketId: socket.id,
      guestSocketId: null,
      createdAt: Date.now(),
      status: "waiting",
      rematchVotes: new Set(),
    });
    socket.join(code);
    socket.data.roomCode = code;
    ack({ code });
  });

  socket.on(
    "room:join",
    (code: string, ack: (res: { ok: boolean; error?: string }) => void) => {
      const room = rooms.get(code?.toUpperCase());
      if (!room) return ack({ ok: false, error: "Oda bulunamadı" });
      if (room.status !== "waiting" || room.guestSocketId)
        return ack({ ok: false, error: "Oda dolu" });

      room.guestSocketId = socket.id;
      room.status = "active";
      socket.join(room.code);
      socket.data.roomCode = room.code;
      ack({ ok: true });

      // Iki oyuncu da hazir — oyunu baslat (ayni seed ile deterministik spawn)
      io.to(room.code).emit("game:start", {
        code: room.code,
        seed: Math.floor(Math.random() * 2 ** 31),
        startedAt: Date.now(),
      });
    },
  );

  // Oyun ici olaylar: sadece odadaki DIGER oyuncuya aktar (relay)
  const relayEvents = [
    "game:enemySpawn", // kill basina rakibe 2 yaratik
    "game:stateSync", // arena goruntusu: pozisyon/hp/level/yaratiklar
    "game:charSync", // cizilen ozel karakterin pikselleri
    "game:debuffApplied", // saticidan alinan rakip zayiflatmasi
    "game:playerDied",
  ];
  for (const event of relayEvents) {
    socket.on(event, (payload: unknown) => {
      const code = socket.data.roomCode as string | undefined;
      if (!code) return;
      socket.to(code).emit(event, payload);
    });
  }

  socket.on("game:playerDied", () => {
    const code = socket.data.roomCode as string | undefined;
    if (!code) return;
    const room = rooms.get(code);
    if (room && room.status === "active") {
      room.status = "ended";
      room.rematchVotes.clear();
      // Olen oyuncunun rakibi kazanir
      io.to(code).emit("game:over", { loserSocketId: socket.id });
    }
  });

  // Rematch: iki oyuncu da isterse ayni odada yeni seed ile tekrar baslar
  socket.on("game:rematch", () => {
    const code = socket.data.roomCode as string | undefined;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.status !== "ended") return;
    room.rematchVotes.add(socket.id);
    socket.to(code).emit("game:rematchRequested");
    if (room.rematchVotes.size >= 2) {
      room.rematchVotes.clear();
      room.status = "active";
      io.to(code).emit("game:start", {
        code: room.code,
        seed: Math.floor(Math.random() * 2 ** 31),
        startedAt: Date.now(),
      });
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode as string | undefined;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.status === "active") {
      // Baglantisi kopan oyuncu kaybeder
      socket.to(code).emit("game:over", { loserSocketId: socket.id, reason: "disconnect" });
    }
    // Rakip ayrildi — rematch artik mumkun degil
    socket.to(code).emit("room:closed");
    rooms.delete(code);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Socket.io sunucusu ${PORT} portunda çalışıyor`);
});
