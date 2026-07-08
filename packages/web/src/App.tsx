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

  // Cizilen karakterin lobide onizlemesi
  useEffect(() => {
    if (editorOpen) return; // editor kapaninca yenile
    const holder = previewRef.current;
    if (!holder) return;
    holder.innerHTML = "";
    const pixels = loadCharacter();
    if (pixels && pixels.some((p) => p !== null)) {
      const c = characterToCanvas(pixels, 4); // 64x64 onizleme
      c.style.borderRadius = "8px";
      holder.appendChild(c);
    }
  }, [editorOpen, screen]);

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
    return (
      <div style={{ paddingTop: 12 }}>
        <GameCanvas seed={screen.seed} />
      </div>
    );
  }

  if (screen.name === "waiting") {
    return (
      <div style={styles.center}>
        <h1>Rakip bekleniyor...</h1>
        <p style={{ fontSize: 14, opacity: 0.7 }}>Bu kodu arkadaşına gönder:</p>
        <div style={styles.code}>{screen.code}</div>
      </div>
    );
  }

  return (
    <div style={styles.center}>
      <h1 style={{ fontSize: 42 }}>🧛 Fable vs Horde</h1>
      <p style={{ opacity: 0.7, marginBottom: 32 }}>
        Yaratıkları kes — her ölüm rakibine 2 yaratık gönderir!
      </p>

      {/* Karakter onizleme + cizim */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <div ref={previewRef} style={{ minWidth: 64, minHeight: 64, background: "#1a1a24", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }} />
        <button style={{ ...styles.button, background: "#2d2440", fontSize: 15 }} onClick={() => setEditorOpen(true)}>
          🎨 Karakterini Çiz
        </button>
      </div>

      <button style={styles.button} onClick={createRoom}>
        ⚔️ Oyun Kur
      </button>

      <div style={{ margin: "24px 0", opacity: 0.5 }}>— veya —</div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={styles.input}
          placeholder="DAVET KODU"
          maxLength={4}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
        />
        <button style={styles.button} onClick={joinRoom}>
          Katıl
        </button>
      </div>
      {error && <p style={{ color: "#ff6b6b", marginTop: 12 }}>{error}</p>}

      {editorOpen && <CharacterEditor onClose={() => setEditorOpen(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
  },
  button: {
    background: "#7c3aed",
    color: "white",
    border: "none",
    padding: "12px 32px",
    fontSize: 18,
    borderRadius: 8,
    cursor: "pointer",
  },
  input: {
    background: "#1a1a24",
    color: "white",
    border: "1px solid #333",
    padding: "12px 16px",
    fontSize: 18,
    borderRadius: 8,
    width: 140,
    textAlign: "center",
    letterSpacing: 4,
  },
  code: {
    fontSize: 48,
    fontWeight: "bold",
    letterSpacing: 12,
    background: "#1a1a24",
    padding: "16px 32px",
    borderRadius: 12,
    marginTop: 8,
  },
};
