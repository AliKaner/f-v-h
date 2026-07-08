// 16x16 pixel karakter cizim editoru — lobide karakterini ciz,
// oyunda senin sprite'in olarak kullanilir (localStorage'da saklanir).

import { useEffect, useRef, useState } from "react";

export const GRID = 16;
export const STORAGE_KEY = "customCharacter";

const PALETTE = [
  "#000000", "#4a4a4a", "#9d9d9d", "#ffffff",
  "#6b2737", "#e53935", "#ff8a65", "#ffd54f",
  "#3e2723", "#8d6e63", "#f5cba7", "#2e7d32",
  "#66bb6a", "#1565c0", "#42a5f5", "#7c3aed",
];

export type PixelGrid = (string | null)[]; // GRID*GRID, null = seffaf

export function loadCharacter(): PixelGrid | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PixelGrid;
    if (Array.isArray(parsed) && parsed.length === GRID * GRID) return parsed;
  } catch { /* bozuk kayit */ }
  return null;
}

/** Pixel verisini oyunda cizilecek canvas'a cevir */
export function characterToCanvas(pixels: PixelGrid, cell = 6): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = GRID * cell;
  c.height = GRID * cell;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const color = pixels[y * GRID + x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  return c;
}

export default function CharacterEditor({ onClose }: { onClose: () => void }) {
  const [pixels, setPixels] = useState<PixelGrid>(
    () => loadCharacter() ?? Array(GRID * GRID).fill(null),
  );
  const [color, setColor] = useState(PALETTE[6]);
  const [erasing, setErasing] = useState(false);
  const painting = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const CELL = 24; // editor hucre boyutu

  // Izgarayi ciz
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, GRID * CELL, GRID * CELL);
    // seffaflik dama deseni
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#1c1826" : "#211c2e";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        const p = pixels[y * GRID + x];
        if (p) {
          ctx.fillStyle = p;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
  }, [pixels]);

  const paint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL);
    const y = Math.floor((e.clientY - rect.top) / CELL);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    setPixels((prev) => {
      const next = [...prev];
      next[y * GRID + x] = erasing ? null : color;
      return next;
    });
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pixels));
    onClose();
  };

  return (
    <div style={st.overlay}>
      <h2 style={{ marginBottom: 4 }}>🎨 Karakterini Çiz (16×16)</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 12 }}>
        Sol tık: boya — sürükleyerek çiz. Oyunda bu karakter sen olacaksın!
      </p>

      <canvas
        ref={canvasRef}
        width={GRID * CELL}
        height={GRID * CELL}
        style={{ borderRadius: 8, cursor: "crosshair", border: "2px solid #7c3aed" }}
        onMouseDown={(e) => { painting.current = true; paint(e); }}
        onMouseMove={(e) => painting.current && paint(e)}
        onMouseUp={() => (painting.current = false)}
        onMouseLeave={() => (painting.current = false)}
      />

      {/* Palet */}
      <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", maxWidth: GRID * CELL }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); setErasing(false); }}
            style={{
              width: 28, height: 28, background: c, borderRadius: 6, cursor: "pointer",
              border: color === c && !erasing ? "3px solid white" : "1px solid #444",
            }}
          />
        ))}
        <button
          onClick={() => setErasing(true)}
          style={{
            width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 14,
            background: "#1c1826", color: "white",
            border: erasing ? "3px solid white" : "1px solid #444",
          }}
          title="Silgi"
        >
          🧽
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={st.btn} onClick={save}>💾 Kaydet</button>
        <button style={{ ...st.btn, background: "#333" }} onClick={() => setPixels(Array(GRID * GRID).fill(null))}>
          🗑️ Temizle
        </button>
        <button style={{ ...st.btn, background: "#333" }} onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "#000000e0", zIndex: 50,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  },
  btn: {
    background: "#7c3aed", color: "white", border: "none", padding: "10px 24px",
    fontSize: 15, borderRadius: 8, cursor: "pointer",
  },
};
