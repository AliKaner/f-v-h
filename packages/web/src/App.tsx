import { useState, useEffect, useRef } from "react";
import { getSocket } from "./socket";
import GameCanvas from "./components/GameCanvas";
import CharacterEditor, { loadCharacter, characterToCanvas } from "./components/CharacterEditor";

type Screen =
  | { name: "lobby" }
  | { name: "waiting"; code: string }
  | { name: "game"; code: string; seed: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "lobby" });
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getSocket();
    const onGameStart = (data: { code: string; seed: number }) => {
      setScreen({ name: "game", code: data.code, seed: data.seed });
    };
    socket.on("game:start", onGameStart);
    return () => {
      socket.off("game:start", onGameStart);
    };
  }, []);

  // Cizilen karakterin lobide onizlemesi
  useEffect(() => {
    if (editorOpen) return; // editor kapaninca yenile
    const holder = previewRef.current;
    if (!holder) return;
    holder.innerHTML = "";
    const pixels = loadCharacter();
    if (pixels && pixels.some((p) => p !== null)) {
      const c = characterToCanvas(pixels, 5); // 80x80 onizleme
      c.style.borderRadius = "10px";
      holder.appendChild(c);
    } else {
      holder.innerHTML = `<span style="font-size:34px">🥷</span>`;
    }
  }, [editorOpen, screen]);

  const createRoom = () => {
    getSocket().emit("room:create", (res: { code: string }) => {
      setScreen({ name: "waiting", code: res.code });
    });
  };

  const joinRoom = () => {
    setError(null);
    getSocket().emit(
      "room:join",
      joinCode.trim().toUpperCase(),
      (res: { ok: boolean; error?: string }) => {
        if (!res.ok) setError(res.error ?? "Bilinmeyen hata");
      },
    );
  };

  if (screen.name === "game") {
    // key=seed: rematch'te yeni seed gelince komponent sifirdan kurulur
    return <GameCanvas key={screen.seed} seed={screen.seed} />;
  }

  if (screen.name === "waiting") {
    return (
      <div style={st.page}>
        <div className="card slide-down" style={{ ...st.card, textAlign: "center" }}>
          <h2 className="pulse" style={{ marginBottom: 6 }}>⏳ Rakip bekleniyor...</h2>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 20 }}>Bu kodu arkadaşına gönder:</p>
          <div style={st.code}>{screen.code}</div>
          <button
            className="btn ghost"
            style={{ marginTop: 20, padding: "8px 20px", fontSize: 13 }}
            onClick={() => navigator.clipboard?.writeText(screen.code)}
          >
            📋 Kopyala
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={st.page}>
      {/* Arka plan dekoru */}
      <div style={st.bgDecor} aria-hidden>
        <span className="float" style={{ ...st.bgEmoji, top: "12%", left: "12%", animationDelay: "0s" }}>🧟</span>
        <span className="float" style={{ ...st.bgEmoji, top: "20%", right: "14%", animationDelay: ".8s" }}>👹</span>
        <span className="float" style={{ ...st.bgEmoji, bottom: "18%", left: "18%", animationDelay: "1.4s" }}>🗡️</span>
        <span className="float" style={{ ...st.bgEmoji, bottom: "14%", right: "12%", animationDelay: ".4s" }}>🩸</span>
      </div>

      <div className="card slide-down" style={st.card}>
        <h1 className="title-glow" style={{ fontSize: 46, textAlign: "center", marginBottom: 4 }}>
          HORDE SURVIVORS
        </h1>
        <p style={{ textAlign: "center", opacity: 0.65, fontSize: 14, marginBottom: 28 }}>
          PvP Arena — Yaratıkları kes, her ölüm rakibine <b>2 yaratık</b> gönderir! ⚔️
        </p>

        {/* Karakter */}
        <div style={st.charRow}>
          <div ref={previewRef} style={st.preview} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Karakterin</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>
              16×16 pixel — kendi kahramanını çiz!
            </div>
            <button className="btn ghost" style={{ padding: "8px 18px", fontSize: 14 }} onClick={() => setEditorOpen(true)}>
              🎨 Çiz / Düzenle
            </button>
          </div>
        </div>

        <button className="btn" style={{ width: "100%", marginBottom: 18 }} onClick={createRoom}>
          ⚔️ OYUN KUR
        </button>

        <div style={st.divider}>
          <span style={st.dividerLine} />
          <span style={{ fontSize: 12, opacity: 0.45, padding: "0 12px" }}>veya davet koduyla katıl</span>
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
        {error && <p style={{ color: "#f87171", marginTop: 12, textAlign: "center", fontSize: 14 }}>⚠️ {error}</p>}
      </div>

      <div style={st.footer}>
        WASD hareket · Silahlar otomatik saldırır · Satıcıdan rakibini zayıflat
      </div>

      {editorOpen && <CharacterEditor onClose={() => setEditorOpen(false)} />}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: {
    height: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "radial-gradient(ellipse at 50% 30%, #1c1230 0%, #0a0812 70%)",
    position: "relative",
  },
  bgDecor: { position: "absolute", inset: 0, pointerEvents: "none" },
  bgEmoji: { position: "absolute", fontSize: 40, opacity: 0.14 },
  card: { padding: "40px 48px", width: 480, zIndex: 1 },
  charRow: {
    display: "flex", alignItems: "center", gap: 18,
    background: "#0f0c18", border: "1px solid #2b2340",
    borderRadius: 14, padding: 16, marginBottom: 22,
  },
  preview: {
    width: 80, height: 80, background: "#1c1728", borderRadius: 10,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid #2b2340", flexShrink: 0, overflow: "hidden",
  },
  divider: { display: "flex", alignItems: "center", marginBottom: 18 },
  dividerLine: { flex: 1, height: 1, background: "#2b2340" },
  code: {
    fontSize: 52, fontWeight: 800, letterSpacing: 16,
    background: "#0f0c18", border: "2px solid #7c3aed",
    padding: "18px 20px 18px 36px", borderRadius: 14,
    boxShadow: "0 0 40px #7c3aed33",
  },
  footer: { position: "absolute", bottom: 20, fontSize: 12, opacity: 0.4 },
};
