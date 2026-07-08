import { useState, useEffect } from "react";
import { getSocket } from "./socket";
import GameCanvas from "./components/GameCanvas";
import { HEROES } from "./game/config";

export interface LobbyPlayer {
  id: string;
  name: string;
  team: 0 | 1;
  isHost: boolean;
}

type Screen =
  | { name: "landing" }
  | { name: "lobby"; code: string }
  | { name: "game"; code: string; seed: number; players: LobbyPlayer[] };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "landing" });
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("playerName") ?? "");
  const [hero, setHero] = useState(() => localStorage.getItem("selectedChar") ?? "soldier");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [myId, setMyId] = useState<string>("");

  useEffect(() => {
    localStorage.setItem("playerName", playerName);
  }, [playerName]);
  useEffect(() => {
    localStorage.setItem("selectedChar", hero);
  }, [hero]);

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setMyId(socket.id ?? "");
    const onGameStart = (data: { code: string; seed: number; players: LobbyPlayer[] }) => {
      setScreen({ name: "game", code: data.code, seed: data.seed, players: data.players });
    };
    const onPlayers = (data: { players: LobbyPlayer[] }) => setPlayers(data.players);
    const onRoomClosed = () => {
      setScreen({ name: "landing" });
      setError("Oda kapandı");
    };
    if (socket.connected) setMyId(socket.id ?? "");
    socket.on("connect", onConnect);
    socket.on("game:start", onGameStart);
    socket.on("room:players", onPlayers);
    socket.on("room:closed", onRoomClosed);
    return () => {
      socket.off("connect", onConnect);
      socket.off("game:start", onGameStart);
      socket.off("room:players", onPlayers);
      socket.off("room:closed", onRoomClosed);
    };
  }, []);

  const displayName = playerName.trim() || "Oyuncu";

  const createRoom = () => {
    getSocket().emit("room:create", displayName, (res: { code: string }) => {
      setScreen({ name: "lobby", code: res.code });
    });
  };

  const joinRoom = () => {
    setError(null);
    getSocket().emit(
      "room:join",
      joinCode.trim().toUpperCase(),
      displayName,
      (res: { ok: boolean; error?: string }) => {
        if (!res.ok) setError(res.error ?? "Bilinmeyen hata");
        else setScreen({ name: "lobby", code: joinCode.trim().toUpperCase() });
      },
    );
  };

  const startGame = () => {
    setError(null);
    getSocket().emit("room:start", (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? "Başlatılamadı");
    });
  };

  // ---------- OYUN ----------
  if (screen.name === "game") {
    return <GameCanvas key={screen.seed} seed={screen.seed} myId={myId} players={screen.players} hero={hero} />;
  }

  // ---------- LOBI (takim secimi) ----------
  if (screen.name === "lobby") {
    const me = players.find((p) => p.id === myId);
    const isHost = me?.isHost ?? false;
    const team0 = players.filter((p) => p.team === 0);
    const team1 = players.filter((p) => p.team === 1);

    const TeamCol = ({ team, list, color }: { team: 0 | 1; list: LobbyPlayer[]; color: string }) => (
      <div style={{ ...st.teamCol, borderColor: color }}>
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 2, color, marginBottom: 10 }}>
          TAKIM {team + 1} ({list.length})
        </div>
        {list.map((p) => (
          <div key={p.id} style={st.playerRow}>
            <span style={{ ...st.dot, background: color }} />
            <b style={{ flex: 1, textAlign: "left" }}>{p.name}</b>
            {p.isHost && <span style={st.hostTag}>HOST</span>}
            {p.id === myId && <span style={{ ...st.hostTag, background: "#b91c1c", color: "#e3ddd2" }}>SEN</span>}
          </div>
        ))}
        {me?.team !== team && (
          <button className="btn ghost" style={{ padding: "6px 14px", fontSize: 12, marginTop: 8 }}
            onClick={() => getSocket().emit("room:setTeam", team)}>
            Bu takıma geç
          </button>
        )}
      </div>
    );

    return (
      <div style={st.page}>
        <div className="card slide-down" style={{ ...st.card, width: 640, textAlign: "center" }}>
          <h2 style={{ marginBottom: 4 }}>Savaş Lobisi</h2>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 14 }}>Davet kodu — arkadaşlarına gönder (max 8 kişi):</p>
          <div style={{ ...st.code, fontSize: 40, padding: "12px 16px 12px 28px", display: "inline-block" }}>{screen.code}</div>
          <button className="btn ghost" style={{ marginLeft: 12, padding: "8px 16px", fontSize: 13 }}
            onClick={() => navigator.clipboard?.writeText(screen.code)}>
            Kopyala
          </button>

          <div style={{ display: "flex", gap: 14, margin: "22px 0" }}>
            <TeamCol team={0} list={team0} color="#b8860b" />
            <div style={{ display: "flex", alignItems: "center", fontWeight: 900, fontSize: 22, opacity: 0.4, fontFamily: "Cinzel, serif" }}>VS</div>
            <TeamCol team={1} list={team1} color="#b91c1c" />
          </div>

          {isHost ? (
            <button className="btn" style={{ width: "100%" }} onClick={startGame}>
              SAVAŞI BAŞLAT ({players.length} oyuncu)
            </button>
          ) : (
            <p className="pulse" style={{ opacity: 0.7, fontSize: 14 }}>Host'un başlatması bekleniyor...</p>
          )}
          {error && <p style={{ color: "#f87171", marginTop: 10, fontSize: 13 }}>{error}</p>}
        </div>
      </div>
    );
  }

  // ---------- LANDING ----------
  return (
    <div style={{ ...st.page, overflowY: "auto", justifyContent: "flex-start", paddingTop: 40 }}>
      <div style={st.bgDecor} aria-hidden>
        {["12%/10%", "78%/16%", "16%/72%", "82%/78%", "50%/88%"].map((pos, i) => {
          const [l, t] = pos.split("/");
          return (
            <div key={i} className="float" style={{ ...st.bgSprite, left: l, top: t, animationDelay: `${i * 0.6}s`,
              backgroundImage: `url(/assets/creatures/${["orc", "demon", "blood_monster", "orc", "demon"][i]}/Idle.png)` }} />
          );
        })}
      </div>

      {/* Hero bolumu */}
      <div style={{ textAlign: "center", zIndex: 1, marginBottom: 28 }}>
        <h1 className="title-glow" style={{ fontSize: 64, letterSpacing: 2 }}>HORDE SURVIVORS</h1>
        <p style={{ opacity: 0.75, fontSize: 17, marginTop: 6 }}>
          Takımlı PvP arena — yaratıkları kes, <b>her ölüm rakip takıma 2 yaratık</b> gönderir.
        </p>
        <p style={{ opacity: 0.5, fontSize: 13, marginTop: 4 }}>
          Otomatik silahlar · 12 silah, 8 kitap · Marketten rakibini sabote et · 4v4'e kadar
        </p>
      </div>

      <div className="card slide-down" style={{ ...st.card, width: 560, zIndex: 1 }}>
        {/* Isim */}
        <label style={st.label}>OYUNCU ADI</label>
        <input
          className="code-input"
          style={{ width: "100%", letterSpacing: 1, fontSize: 16, textTransform: "none", marginBottom: 18 }}
          placeholder="Adını yaz..."
          maxLength={16}
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />

        {/* Karakter secimi */}
        <label style={st.label}>KAHRAMANINI SEÇ</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {HEROES.map((h) => (
            <button
              key={h.id}
              onClick={() => setHero(h.id)}
              style={{
                ...st.heroCard,
                borderColor: hero === h.id ? "#b91c1c" : "#33272a",
                boxShadow: hero === h.id ? "0 0 20px rgba(185,28,28,0.45)" : "none",
              }}
            >
              <div style={{ ...st.heroSprite, backgroundImage: `url(/assets/creatures/${h.id}/Idle.png)` }} />
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{h.name}</div>
            </button>
          ))}
        </div>

        <button className="btn" style={{ width: "100%", marginBottom: 16 }} onClick={createRoom}>
          LOBİ KUR
        </button>

        <div style={st.divider}>
          <span style={st.dividerLine} />
          <span style={{ fontSize: 12, opacity: 0.45, padding: "0 12px" }}>veya koda katıl</span>
          <span style={st.dividerLine} />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <input
            className="code-input"
            placeholder="KOD"
            maxLength={4}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && joinRoom()}
          />
          <button className="btn" onClick={joinRoom}>Katıl</button>
        </div>
        {error && <p style={{ color: "#f87171", marginTop: 12, textAlign: "center", fontSize: 14 }}>{error}</p>}
      </div>

      {/* Nasil oynanir */}
      <div style={{ display: "flex", gap: 14, marginTop: 26, zIndex: 1, paddingBottom: 40 }}>
        {[
          ["WASD", "4 yöne hareket — silahlar tam otomatik saldırır"],
          ["F + Q/E/R", "Marketlere yaklaş, aç ve rakibine sabotaj satın al"],
          ["1 / 2 / 3", "Level atlayınca oyun durmadan yeni güç seç"],
          ["ENTER", "Chat — mesajın karakterinin üstünde belirir"],
        ].map(([k, d]) => (
          <div key={k} className="card" style={{ padding: "14px 18px", width: 220 }}>
            <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 14, marginBottom: 4, fontFamily: "Cinzel, serif", letterSpacing: 1 }}>{k}</div>
            <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Gotik tema: kirmizi & siyah, gradient yok, keskin hatlar
const st: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "#060505",
    position: "relative",
  },
  bgDecor: { position: "fixed", inset: 0, pointerEvents: "none" },
  bgSprite: {
    position: "absolute", width: 100, height: 100,
    backgroundPosition: "0 0", backgroundRepeat: "no-repeat",
    opacity: 0.08, imageRendering: "pixelated", transform: "scale(1.4)",
    filter: "sepia(1) saturate(3) hue-rotate(-40deg)", // kizil golgeler
  },
  card: { padding: "32px 40px", width: 480, zIndex: 1 },
  label: {
    display: "block", fontSize: 11, fontWeight: 800, letterSpacing: 3,
    color: "#857c74", marginBottom: 8, fontFamily: "Cinzel, serif",
  },
  heroCard: {
    flex: 1, background: "#0e0b0b", border: "2px solid #33272a", borderRadius: 0,
    padding: "10px 6px", cursor: "pointer", color: "#e3ddd2", transition: "all .15s",
  },
  heroSprite: {
    width: 100, height: 100, margin: "0 auto",
    backgroundPosition: "0 0", backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  },
  divider: { display: "flex", alignItems: "center", marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, background: "#33272a" },
  code: {
    fontSize: 52, fontWeight: 700, letterSpacing: 16,
    background: "#0e0b0b", border: "1px solid #b91c1c",
    outline: "1px solid #000", outlineOffset: 3,
    padding: "18px 20px 18px 36px", borderRadius: 0,
    boxShadow: "0 0 34px rgba(185,28,28,0.3)",
    fontFamily: "Cinzel, serif", color: "#ef4444",
  },
  teamCol: {
    flex: 1, background: "#0e0b0b", border: "2px solid", borderRadius: 0,
    padding: 14, minHeight: 160,
  },
  playerRow: {
    display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
    background: "#1c1415", border: "1px solid #33272a", borderRadius: 0,
    marginBottom: 6, fontSize: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 0, flexShrink: 0, transform: "rotate(45deg)" },
  hostTag: {
    fontSize: 9, fontWeight: 800, background: "#b8860b", color: "#060505",
    borderRadius: 0, padding: "2px 6px", letterSpacing: 1,
  },
};
