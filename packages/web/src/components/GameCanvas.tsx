import { useEffect, useRef, useState } from "react";
import { GameEngine, type LevelUpChoice } from "../game/engine";
import { render, renderOpponentView, type SpriteBundle, type OppSnapshot } from "../game/render";
import { loadCreatureSprites } from "../game/sprites";
import { ARENA, CREATURES, DEBUFFS } from "../game/config";
import { getSocket } from "../socket";
import { loadCharacter, characterToCanvas, type PixelGrid } from "./CharacterEditor";

interface OpponentInfo {
  hp: number;
  maxHp: number;
  level: number;
  kills: number;
}

export default function GameCanvas({ seed }: { seed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const oppCanvasRef = useRef<HTMLCanvasElement>(null);
  const oppSnapshotRef = useRef<OppSnapshot | null>(null);
  const oppCustomRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  // Level-up secimleri kuyrugu — oyun DURMAZ, panel akarken gosterilir
  const [choiceQueue, setChoiceQueue] = useState<LevelUpChoice[][]>([]);
  const choiceQueueRef = useRef(choiceQueue);
  choiceQueueRef.current = choiceQueue;
  const [shopOpen, setShopOpen] = useState(false);
  const [shopChoices, setShopChoices] = useState<typeof DEBUFFS>([]);
  const [upgraderOpen, setUpgraderOpen] = useState(false);
  const [sentMonsterUpgrades, setSentMonsterUpgrades] = useState(0);
  const [gameOverReason, setGameOverReason] = useState<string | null>(null);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null);
  const [rematch, setRematch] = useState<"idle" | "sent" | "incoming">("idle");
  const [oppLeft, setOppLeft] = useState(false);
  const [, forceHud] = useState(0);

  useEffect(() => {
    const socket = getSocket();

    const engine = new GameEngine(seed, {
      onKill: (count) => socket.emit("game:enemySpawn", { count }),
      onLevelUp: (c) => setChoiceQueue((q) => [...q, c]),
      onDeath: () => {
        socket.emit("game:playerDied");
        setResult("lose");
      },
    });
    engineRef.current = engine;

    // --- Socket olaylari ---
    const onEnemySpawn = (data: { count: number }) => engine.queueEnemySpawns(data.count ?? 2);
    const onDebuff = (data: { id: string }) => engine.applyDebuff(data.id);
    const onStateSync = (data: OppSnapshot) => {
      oppSnapshotRef.current = data;
      setOpponent({ hp: data.hp, maxHp: data.maxHp, level: data.level, kills: data.kills });
    };
    const onCharSync = (data: { pixels: PixelGrid }) => {
      if (Array.isArray(data?.pixels) && data.pixels.some((p) => p !== null)) {
        oppCustomRef.current = characterToCanvas(data.pixels, 6);
      }
    };
    const onGameOver = (data: { loserSocketId: string; reason?: string }) => {
      engine.gameOver = true;
      if (data.reason) setGameOverReason(data.reason);
      setTimeout(() => {
        setResult(data.loserSocketId === socket.id ? "lose" : "win");
      }, 1000);
    };
    // Rakip rematch istedi (biz de istediysen sunucu zaten game:start atar)
    const onRematchRequested = () => setRematch((r) => (r === "sent" ? r : "incoming"));
    const onRoomClosed = () => setOppLeft(true);
    socket.on("game:enemySpawn", onEnemySpawn);
    socket.on("game:debuffApplied", onDebuff);
    socket.on("game:stateSync", onStateSync);
    socket.on("game:charSync", onCharSync);
    socket.on("game:over", onGameOver);
    socket.on("game:rematchRequested", onRematchRequested);
    socket.on("room:closed", onRoomClosed);

    // Cizilen karakteri rakibe gonder (baglanti sirasi garantisi icin iki kez)
    const myPixels = loadCharacter();
    const sendChar = () => {
      if (myPixels && myPixels.some((p) => p !== null)) {
        socket.emit("game:charSync", { pixels: myPixels });
      }
    };
    const charTimer1 = setTimeout(sendChar, 500);
    const charTimer2 = setTimeout(sendChar, 3000);

    // Rakibe arena durumu yayini (10 Hz): pozisyon + yaratiklar
    const syncTimer = setInterval(() => {
      const snapshot: OppSnapshot = {
        hp: engine.hp, maxHp: engine.maxHp, level: engine.level, kills: engine.kills,
        x: engine.playerX, y: engine.playerY, facing: engine.facing,
        creatures: engine.creatures
          .filter((c) => !c.dead)
          .slice(0, 150)
          .map((c) => ({
            x: Math.round(c.x), y: Math.round(c.y),
            s: c.def.sprite, f: c.facing,
            hp: Math.round((c.hp / c.maxHp) * 100) / 100,
            lvl: c.level,
            isBoss: c.isBoss,
          })),
      };
      socket.emit("game:stateSync", snapshot);
    }, 100);
    const hudTimer = setInterval(() => forceHud((n) => n + 1), 100);

    // --- Klavye: WASD + ok tuslari (2D hareket), E satici, 1/2/3 secim ---
    const pickByIndex = (i: number) => {
      const q = choiceQueueRef.current;
      if (q.length > 0 && q[0][i]) {
        engine.applyChoice(q[0][i]);
        setChoiceQueue((prev) => prev.slice(1));
      }
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") engine.input.left = true;
      if (k === "d" || k === "arrowright") engine.input.right = true;
      if (k === "w" || k === "arrowup") engine.input.up = true;
      if (k === "s" || k === "arrowdown") engine.input.down = true;
      if (k === "e") {
        if (engine.nearVendor) {
          setShopOpen((v) => !v);
          setUpgraderOpen(false);
        } else if (engine.nearUpgrader) {
          setUpgraderOpen((v) => !v);
          setShopOpen(false);
        }
      }
      if (k === "1") pickByIndex(0);
      if (k === "2") pickByIndex(1);
      if (k === "3") pickByIndex(2);
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") engine.input.left = false;
      if (k === "d" || k === "arrowright") engine.input.right = false;
      if (k === "w" || k === "arrowup") engine.input.up = false;
      if (k === "s" || k === "arrowdown") engine.input.down = false;
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
        // Rakip arenasi (snapshot'tan canli izleme)
        const oppCtx = oppCanvasRef.current?.getContext("2d");
        if (oppCtx) {
          renderOpponentView(oppCtx, oppSnapshotRef.current, sprites, oppCustomRef.current, now / 1000);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearInterval(syncTimer);
      clearInterval(hudTimer);
      clearTimeout(charTimer1);
      clearTimeout(charTimer2);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      socket.off("game:enemySpawn", onEnemySpawn);
      socket.off("game:debuffApplied", onDebuff);
      socket.off("game:stateSync", onStateSync);
      socket.off("game:charSync", onCharSync);
      socket.off("game:over", onGameOver);
      socket.off("game:rematchRequested", onRematchRequested);
      socket.off("room:closed", onRoomClosed);
    };
  }, [seed]);

  const g = engineRef.current;
  const currentChoices = choiceQueue[0] ?? null;

  useEffect(() => {
    if (shopOpen) {
      const shuffled = [...DEBUFFS].sort(() => Math.random() - 0.5);
      setShopChoices(shuffled.slice(0, 3));
    }
  }, [shopOpen]);

  const pick = (choice: LevelUpChoice) => {
    engineRef.current?.applyChoice(choice);
    setChoiceQueue((prev) => prev.slice(1));
  };

  const buyDebuff = (id: string, cost: number) => {
    const engine = engineRef.current;
    if (!engine || engine.gold < cost) return;
    engine.gold -= cost;
    getSocket().emit("game:debuffApplied", { id });
    engine.addText(engine.playerX, engine.playerY - 100, "Rakibe gönderildi! 😈", "#a78bfa");
    setShopChoices((prev) => prev.filter((d) => d.id !== id));
  };

  const upgradeCost = 100 + sentMonsterUpgrades * 75;

  const buyMonsterUpgrade = () => {
    const engine = engineRef.current;
    if (!engine || engine.gold < upgradeCost) return;
    engine.gold -= upgradeCost;
    getSocket().emit("game:debuffApplied", { id: "levelUpMonsters" });
    engine.addText(engine.playerX, engine.playerY - 100, "Canavarlar güçlendi! 😈", "#ef4444");
    setSentMonsterUpgrades((prev) => prev + 1);
  };

  const hpPct = g ? Math.max(0, g.hp / g.maxHp) : 1;
  const oppHpPct = opponent ? Math.max(0, opponent.hp / opponent.maxHp) : 1;

  return (
    <div style={{ position: "relative", width: "100vw", maxWidth: 1600, margin: "0 auto", padding: "0 8px" }}>
      {/* ---- Ust HUD ---- */}
      <div style={hud.bar}>
        {/* Sen */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <div style={hud.levelBadge}>{g?.level ?? 1}</div>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <div style={hud.hpOuter}>
              <div style={{ ...hud.hpInner, width: `${hpPct * 100}%`, background: hpPct > 0.35 ? "linear-gradient(90deg,#22c55e,#4ade80)" : "linear-gradient(90deg,#dc2626,#ef4444)" }} />
              <span style={hud.hpText}>{Math.max(0, Math.ceil(g?.hp ?? 0))} / {g?.maxHp ?? 100}</span>
            </div>
            <div style={hud.xpOuter}>
              <div style={{ ...hud.xpInner, width: `${Math.min(100, ((g?.xp ?? 0) / (g?.xpNeeded ?? 1)) * 100)}%` }} />
            </div>
          </div>
          <span style={hud.stat}>🪙 {g?.gold ?? 0}</span>
          <span style={hud.stat}>⚔️ {g?.kills ?? 0}</span>
        </div>

        {/* Sure */}
        <div style={hud.timer}>
          {String(Math.floor((g?.elapsed ?? 0) / 60)).padStart(2, "0")}:{String(Math.floor((g?.elapsed ?? 0) % 60)).padStart(2, "0")}
        </div>

        {/* Rakip */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, justifyContent: "flex-end" }}>
          {opponent ? (
            <>
              <span style={hud.stat}>⚔️ {opponent.kills}</span>
              <div style={{ flex: 1, maxWidth: 320 }}>
                <div style={hud.hpOuter}>
                  <div style={{ ...hud.hpInner, width: `${oppHpPct * 100}%`, background: "linear-gradient(90deg,#dc2626,#f87171)" }} />
                  <span style={hud.hpText}>{Math.max(0, Math.ceil(opponent.hp))} / {opponent.maxHp}</span>
                </div>
                <div style={{ fontSize: 10, opacity: 0.6, textAlign: "right", marginTop: 2 }}>RAKİP</div>
              </div>
              <div style={{ ...hud.levelBadge, background: "linear-gradient(135deg,#dc2626,#7f1d1d)" }}>{opponent.level}</div>
            </>
          ) : (
            <span className="pulse" style={{ fontSize: 13, opacity: 0.6 }}>Rakip bağlanıyor...</span>
          )}
        </div>
      </div>

      {/* ---- Iki arena yan yana ---- */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1.5, minWidth: 0 }}>
          <div style={hud.arenaLabel}>⚔️ SENİN ARENAN</div>
          <canvas
            ref={canvasRef}
            width={ARENA.width}
            height={ARENA.height}
            style={{ display: "block", width: "100%", border: "1px solid #2b2340", borderRadius: "0 0 8px 8px" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...hud.arenaLabel, background: "#2d12188f", color: "#f87171" }}>👁️ RAKİP ARENASI</div>
          <canvas
            ref={oppCanvasRef}
            width={ARENA.width}
            height={ARENA.height}
            style={{ display: "block", width: "100%", border: "1px solid #402330", borderRadius: "0 0 8px 8px", opacity: 0.95 }}
          />
        </div>
      </div>

      {/* ---- Alt bar: envanter ---- */}
      <div style={hud.inventory}>
        <span style={hud.invLabel}>SİLAHLAR</span>
        {[0, 1, 2, 3].map((i) => {
          const w = g?.weapons[i];
          return (
            <span key={i} style={{ ...hud.slot, opacity: w ? 1 : 0.25 }} title={w?.def.name}>
              {w ? <>{w.def.emoji}<small style={hud.slotLvl}>{w.level}</small></> : "·"}
            </span>
          );
        })}
        <span style={{ ...hud.invLabel, marginLeft: 20 }}>KİTAPLAR</span>
        {[0, 1, 2, 3].map((i) => {
          const b = g?.books[i];
          return (
            <span key={i} style={{ ...hud.slot, opacity: b ? 1 : 0.25 }} title={b?.def.name}>
              {b ? <>{b.def.emoji}<small style={hud.slotLvl}>{b.level}</small></> : "·"}
            </span>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.45 }}>
          WASD / Ok tuşları: hareket · E: satıcı · 1-3: seçim
        </span>
      </div>

      {/* ---- Level Up paneli (oyun DURMAZ — ust ortada süzülür) ---- */}
      {currentChoices && !result && (
        <div className="slide-down" style={hud.levelUpPanel}>
          <div style={{ textAlign: "center", fontSize: 13, marginBottom: 8, color: "#c084fc", fontWeight: 700 }}>
            ⬆️ SEVİYE ATLADIN! {choiceQueue.length > 1 && <span style={{ opacity: 0.7 }}>(+{choiceQueue.length - 1} bekliyor)</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {currentChoices.map((c, i) => (
              <button key={i} className="btn ghost" style={hud.choiceCard} onClick={() => pick(c)}>
                <div style={{ fontSize: 15, marginBottom: 2 }}>
                  <kbd style={hud.kbd}>{i + 1}</kbd> {c.emoji}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{c.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Satici paneli (oyun devam eder!) ---- */}
      {shopOpen && !result && (
        <div className="slide-down" style={hud.shopPanel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b>🧙 Satıcı — Rakibini Zayıflat</b>
            <span style={{ fontSize: 13 }}>🪙 {g?.gold ?? 0}</span>
          </div>
          {shopChoices.map((d) => (
            <button
              key={d.id}
              className="btn ghost"
              style={{ ...hud.shopItem, opacity: (g?.gold ?? 0) >= d.cost ? 1 : 0.4 }}
              onClick={() => buyDebuff(d.id, d.cost)}
            >
              <span style={{ fontSize: 20 }}>{d.emoji}</span>
              <span style={{ flex: 1, textAlign: "left", marginLeft: 10 }}>
                <b style={{ fontSize: 13 }}>{d.name}</b>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{d.desc}</div>
              </span>
              <b style={{ fontSize: 13 }}>🪙 {d.cost}</b>
            </button>
          ))}
          <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", marginTop: 6 }}>[E] kapat — oyun devam ediyor!</div>
        </div>
      )}

      {/* ---- Karanlik Satici paneli (oyun devam eder!) ---- */}
      {upgraderOpen && !result && (
        <div className="slide-down" style={hud.upgraderPanel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b>💀 Karanlık Satıcı — Kalıcı Canavar Güçlendir</b>
            <span style={{ fontSize: 13 }}>🪙 {g?.gold ?? 0}</span>
          </div>
          <button
            className="btn ghost"
            style={{ ...hud.shopItem, opacity: (g?.gold ?? 0) >= upgradeCost ? 1 : 0.4 }}
            onClick={buyMonsterUpgrade}
          >
            <span style={{ fontSize: 24 }}>💀</span>
            <span style={{ flex: 1, textAlign: "left", marginLeft: 10 }}>
              <b style={{ fontSize: 13 }}>Canavar Seviyesi +1 (Sonsuz)</b>
              <div style={{ fontSize: 11, opacity: 0.75 }}>Rakibin yaratıklarını kalıcı olarak level atlatır (Giderek pahalılaşır)</div>
            </span>
            <b style={{ fontSize: 13, color: "#f87171" }}>🪙 {upgradeCost}</b>
          </button>
          <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", marginTop: 6 }}>[E] kapat — oyun devam ediyor!</div>
        </div>
      )}

      {/* ---- Oyun sonu ---- */}
      {result && (
        <div style={hud.overlay}>
          <div className="card slide-down" style={{ padding: "48px 64px", textAlign: "center" }}>
            <h1 style={{ fontSize: 56, marginBottom: 8 }}>{result === "win" ? "🏆" : "💀"}</h1>
            <h1 className={result === "win" ? "title-glow" : ""} style={{ fontSize: 42, marginBottom: 12 }}>
              {result === "win" ? "KAZANDIN!" : "KAYBETTİN"}
            </h1>
            {result === "win" && gameOverReason === "disconnect" && (
              <p style={{ color: "#4ade80", fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
                Rakibin bağlantısı koptu 🔌
              </p>
            )}
            <p style={{ opacity: 0.7, marginBottom: 28 }}>
              Seviye {g?.level} · {g?.kills} kill · {Math.floor((g?.elapsed ?? 0) / 60)}dk {Math.floor((g?.elapsed ?? 0) % 60)}sn
            </p>

            {/* Rematch durumu */}
            {oppLeft ? (
              <p style={{ color: "#f87171", marginBottom: 20, fontSize: 14 }}>Rakip oyundan ayrıldı 👋</p>
            ) : rematch === "sent" ? (
              <p className="pulse" style={{ color: "#c084fc", marginBottom: 20, fontSize: 14 }}>
                ⏳ Rematch isteği gönderildi — rakip bekleniyor...
              </p>
            ) : rematch === "incoming" ? (
              <p className="pulse" style={{ color: "#4ade80", marginBottom: 20, fontSize: 14 }}>
                🔥 Rakip rematch istiyor!
              </p>
            ) : null}

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              {!oppLeft && rematch !== "sent" && (
                <button
                  className="btn"
                  onClick={() => {
                    getSocket().emit("game:rematch");
                    setRematch("sent");
                  }}
                >
                  🔄 {rematch === "incoming" ? "Kabul Et!" : "Rematch İste"}
                </button>
              )}
              <button className="btn ghost" onClick={() => location.reload()}>Lobiye Dön</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const hud: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex", alignItems: "center", gap: 16, padding: "10px 14px",
    background: "#120e1c", borderBottom: "1px solid #2b2340",
  },
  levelBadge: {
    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
    background: "linear-gradient(135deg,#7c3aed,#4c1d95)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: 16, boxShadow: "0 2px 12px #7c3aed55",
  },
  hpOuter: {
    position: "relative", height: 18, background: "#0a0812",
    borderRadius: 6, overflow: "hidden", border: "1px solid #2b2340",
  },
  hpInner: { height: "100%", transition: "width .15s" },
  hpText: {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 700, textShadow: "0 1px 2px #000",
  },
  xpOuter: { height: 5, background: "#0a0812", borderRadius: 3, overflow: "hidden", marginTop: 3 },
  xpInner: { height: "100%", background: "linear-gradient(90deg,#7c3aed,#c084fc)", transition: "width .2s" },
  stat: { fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" },
  timer: { fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", opacity: 0.9 },
  inventory: {
    display: "flex", gap: 6, padding: "8px 14px", alignItems: "center",
    background: "#120e1c", borderTop: "1px solid #2b2340", fontSize: 16,
  },
  invLabel: { fontSize: 10, fontWeight: 700, opacity: 0.45, letterSpacing: 1 },
  slot: {
    width: 40, height: 40, background: "#1c1728", border: "1px solid #2b2340",
    borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative", fontSize: 18,
  },
  slotLvl: {
    position: "absolute", bottom: 1, right: 4, fontSize: 10, fontWeight: 800, color: "#c084fc",
  },
  arenaLabel: {
    fontSize: 11, fontWeight: 800, letterSpacing: 2, padding: "5px 12px",
    background: "#1c1433", color: "#c084fc", borderRadius: "8px 8px 0 0",
    border: "1px solid #2b2340", borderBottom: "none",
  },
  levelUpPanel: {
    position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)",
    background: "#141020f2", border: "1px solid #7c3aed", borderRadius: 14,
    padding: 14, zIndex: 10, boxShadow: "0 8px 40px #7c3aed44",
  },
  choiceCard: { width: 190, padding: 10, textAlign: "center", borderRadius: 10 },
  kbd: {
    background: "#2b2340", borderRadius: 4, padding: "1px 6px",
    fontSize: 11, fontWeight: 700, color: "#c084fc",
  },
  shopPanel: {
    position: "absolute", left: 16, top: 90, width: 340,
    background: "#141020f2", border: "1px solid #eab30888", borderRadius: 14,
    padding: 14, zIndex: 10, display: "flex", flexDirection: "column", gap: 6,
    boxShadow: "0 8px 40px #00000088",
  },
  upgraderPanel: {
    position: "absolute", right: 16, top: 90, width: 340,
    background: "#141020f2", border: "1px solid #ef444488", borderRadius: 14,
    padding: 14, zIndex: 10, display: "flex", flexDirection: "column", gap: 6,
    boxShadow: "0 8px 40px #00000088",
  },
  shopItem: { display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: 8 },
  overlay: {
    position: "absolute", inset: 0, background: "#000000cc", zIndex: 20,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
};
