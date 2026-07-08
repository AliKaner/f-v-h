import { useEffect, useRef, useState } from "react";
import { GameEngine, type LevelUpChoice } from "../game/engine";
import { render, type SpriteBundle } from "../game/render";
import { loadCreatureSprites } from "../game/sprites";
import { ARENA, CREATURES, DEBUFFS } from "../game/config";
import { getSocket } from "../socket";
import { loadCharacter, characterToCanvas } from "./CharacterEditor";

interface OpponentInfo {
  hp: number;
  maxHp: number;
  level: number;
  kills: number;
}

export default function GameCanvas({ seed }: { seed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [choices, setChoices] = useState<LevelUpChoice[] | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null);
  const [, forceHud] = useState(0); // HUD'u periyodik yenile

  useEffect(() => {
    const socket = getSocket();

    const engine = new GameEngine(seed, {
      onKill: (count) => socket.emit("game:enemySpawn", { count }),
      onLevelUp: (c) => setChoices(c),
      onDeath: () => {
        socket.emit("game:playerDied");
        setResult("lose");
      },
    });
    engineRef.current = engine;

    // --- Socket olaylari ---
    const onEnemySpawn = (data: { count: number }) => engine.queueEnemySpawns(data.count ?? 2);
    const onDebuff = (data: { id: string }) => engine.applyDebuff(data.id);
    const onStateSync = (data: OpponentInfo) => setOpponent(data);
    const onGameOver = (data: { loserSocketId: string }) => {
      engine.gameOver = true;
      setResult(data.loserSocketId === socket.id ? "lose" : "win");
    };
    socket.on("game:enemySpawn", onEnemySpawn);
    socket.on("game:debuffApplied", onDebuff);
    socket.on("game:stateSync", onStateSync);
    socket.on("game:over", onGameOver);

    // Rakibe durum yayini (5 Hz)
    const syncTimer = setInterval(() => {
      socket.emit("game:stateSync", {
        hp: engine.hp, maxHp: engine.maxHp, level: engine.level, kills: engine.kills,
      });
    }, 200);
    const hudTimer = setInterval(() => forceHud((n) => n + 1), 100);

    // --- Klavye ---
    const down = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") engine.input.left = true;
      if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") engine.input.right = true;
      if ((e.key === "e" || e.key === "E") && engine.nearVendor) setShopOpen((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") engine.input.left = false;
      if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") engine.input.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    // --- Sprite'lar + oyun dongusu ---
    const sprites: SpriteBundle = { player: undefined, creatures: new Map() };
    let raf = 0;
    let last = performance.now();
    let running = true;

    (async () => {
      // Kullanici karakter cizdiyse onu kullan, yoksa Soldier sprite
      const custom = loadCharacter();
      if (custom && custom.some((p) => p !== null)) {
        sprites.playerCustom = characterToCanvas(custom, 6); // 96x96 px
      }
      sprites.player = await loadCreatureSprites("soldier");
      for (const c of CREATURES) {
        sprites.creatures.set(c.sprite, await loadCreatureSprites(c.sprite));
      }
      const loop = (now: number) => {
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        engine.update(dt);
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) render(ctx, engine, sprites);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearInterval(syncTimer);
      clearInterval(hudTimer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      socket.off("game:enemySpawn", onEnemySpawn);
      socket.off("game:debuffApplied", onDebuff);
      socket.off("game:stateSync", onStateSync);
      socket.off("game:over", onGameOver);
    };
  }, [seed]);

  const g = engineRef.current;

  const pick = (choice: LevelUpChoice) => {
    engineRef.current?.applyChoice(choice);
    setChoices(null);
  };

  const buyDebuff = (id: string, cost: number) => {
    const engine = engineRef.current;
    if (!engine || engine.gold < cost) return;
    engine.gold -= cost;
    getSocket().emit("game:debuffApplied", { id });
    engine.addText(engine.playerX, ARENA.groundY - 140, "Rakibe gönderildi! 😈", "#a78bfa");
  };

  return (
    <div style={{ position: "relative", width: ARENA.width, margin: "0 auto" }}>
      {/* HUD */}
      <div style={hud.bar}>
        <div>
          <b>SEN</b> — Lv {g?.level ?? 1} | ❤️ {Math.max(0, Math.ceil(g?.hp ?? 0))}/{g?.maxHp ?? 100} | 🪙 {g?.gold ?? 0} | ⚔️ {g?.kills ?? 0} kill
        </div>
        <div style={{ opacity: 0.9 }}>
          {opponent
            ? <><b>RAKİP</b> — Lv {opponent.level} | ❤️ {Math.max(0, Math.ceil(opponent.hp))}/{opponent.maxHp} | ⚔️ {opponent.kills}</>
            : "Rakip bekleniyor..."}
        </div>
      </div>
      {/* XP bar */}
      <div style={hud.xpOuter}>
        <div style={{ ...hud.xpInner, width: `${Math.min(100, ((g?.xp ?? 0) / (g?.xpNeeded ?? 1)) * 100)}%` }} />
      </div>

      <canvas ref={canvasRef} width={ARENA.width} height={ARENA.height} style={{ display: "block", borderRadius: 8 }} />

      {/* Envanter */}
      <div style={hud.inventory}>
        {g?.weapons.map((w) => (
          <span key={w.def.type} style={hud.slot} title={w.def.name}>{w.def.emoji}{w.level}</span>
        ))}
        <span style={{ opacity: 0.4, margin: "0 6px" }}>|</span>
        {g?.books.map((b) => (
          <span key={b.def.type} style={hud.slot} title={b.def.name}>{b.def.emoji}{b.level}</span>
        ))}
      </div>

      {/* Level Up secimi */}
      {choices && (
        <div style={hud.overlay}>
          <h2 style={{ marginBottom: 16 }}>⬆️ Seviye {g?.level}! Seçimini yap:</h2>
          <div style={{ display: "flex", gap: 12 }}>
            {choices.map((c, i) => (
              <button key={i} style={hud.choice} onClick={() => pick(c)}>
                <div style={{ fontSize: 36 }}>{c.emoji}</div>
                <div style={{ fontWeight: "bold", margin: "8px 0" }}>{c.title}</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>{c.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Satici */}
      {shopOpen && !choices && !result && (
        <div style={hud.overlay}>
          <h2>🧙 Satıcı — Rakibini Zayıflat</h2>
          <p style={{ opacity: 0.7, margin: "8px 0 16px" }}>Altının: 🪙 {g?.gold ?? 0}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 420 }}>
            {DEBUFFS.map((d) => (
              <button
                key={d.id}
                style={{ ...hud.shopItem, opacity: (g?.gold ?? 0) >= d.cost ? 1 : 0.4 }}
                onClick={() => buyDebuff(d.id, d.cost)}
              >
                <span style={{ fontSize: 24 }}>{d.emoji}</span>
                <span style={{ flex: 1, textAlign: "left", marginLeft: 12 }}>
                  <b>{d.name}</b>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{d.desc}</div>
                </span>
                <b>🪙 {d.cost}</b>
              </button>
            ))}
          </div>
          <button style={{ ...hud.choice, marginTop: 16, padding: "8px 24px" }} onClick={() => setShopOpen(false)}>
            Kapat [E]
          </button>
        </div>
      )}

      {/* Oyun sonu */}
      {result && (
        <div style={hud.overlay}>
          <h1 style={{ fontSize: 64 }}>{result === "win" ? "🏆 KAZANDIN!" : "💀 KAYBETTİN"}</h1>
          <p style={{ margin: "12px 0 24px", opacity: 0.8 }}>
            Seviye {g?.level} — {g?.kills} kill — {Math.floor(g?.elapsed ?? 0)} saniye
          </p>
          <button style={hud.choice} onClick={() => location.reload()}>Lobiye Dön</button>
        </div>
      )}
    </div>
  );
}

const hud: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex", justifyContent: "space-between", padding: "8px 12px",
    background: "#16121f", borderRadius: "8px 8px 0 0", fontSize: 14,
  },
  xpOuter: { height: 6, background: "#16121f", overflow: "hidden" },
  xpInner: { height: "100%", background: "linear-gradient(90deg,#7c3aed,#c084fc)", transition: "width .2s" },
  inventory: {
    display: "flex", gap: 6, padding: "8px 12px", background: "#16121f",
    borderRadius: "0 0 8px 8px", fontSize: 16, minHeight: 38, alignItems: "center",
  },
  slot: { background: "#241d33", borderRadius: 6, padding: "4px 8px" },
  overlay: {
    position: "absolute", inset: 0, background: "#000000cc",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    borderRadius: 8, zIndex: 10,
  },
  choice: {
    background: "#241d33", color: "white", border: "2px solid #7c3aed",
    borderRadius: 12, padding: 16, width: 200, cursor: "pointer", fontSize: 14,
  },
  shopItem: {
    display: "flex", alignItems: "center", background: "#241d33", color: "white",
    border: "1px solid #444", borderRadius: 8, padding: "10px 14px", cursor: "pointer",
  },
};
