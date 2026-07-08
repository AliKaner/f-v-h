import { useEffect, useRef, useState } from "react";
import { GameEngine, type LevelUpChoice } from "../game/engine";
import { render, renderOpponentView, type SpriteBundle, type OppSnapshot } from "../game/render";
import { loadCreatureSprites } from "../game/sprites";
import { ARENA, CREATURES, DEBUFFS, WEAPONS, HEROES } from "../game/config";
import { getSocket } from "../socket";
import type { LobbyPlayer } from "../App";

interface Props {
  seed: number;
  myId: string;
  players: LobbyPlayer[];
  hero: string;
}

export default function GameCanvas({ seed, myId, players, hero }: Props) {
  const me = players.find((p) => p.id === myId);
  const myTeam = me?.team ?? 0;
  const myName = me?.name ?? "Sen";
  const teammates = players.filter((p) => p.id !== myId && p.team === myTeam);
  const enemies = players.filter((p) => p.team !== myTeam);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const otherCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const snapshotsRef = useRef<Map<string, OppSnapshot>>(new Map());
  const engineRef = useRef<GameEngine | null>(null);

  const [choiceQueue, setChoiceQueue] = useState<LevelUpChoice[][]>([]);
  const choiceQueueRef = useRef(choiceQueue);
  choiceQueueRef.current = choiceQueue;

  const [shopOpen, setShopOpen] = useState<"market" | "dark" | null>(null);
  const shopOpenRef = useRef(shopOpen);
  shopOpenRef.current = shopOpen;
  const [shopChoices, setShopChoices] = useState<typeof DEBUFFS>([]);
  const shopChoicesRef = useRef(shopChoices);
  shopChoicesRef.current = shopChoices;
  const [sentMonsterUpgrades, setSentMonsterUpgrades] = useState(0);
  const upgradesRef = useRef(sentMonsterUpgrades);
  upgradesRef.current = sentMonsterUpgrades;

  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const [chatText, setChatText] = useState("");
  const chatInputRef = useRef<HTMLInputElement>(null);

  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [deadIds, setDeadIds] = useState<Set<string>>(new Set());
  const [rematch, setRematch] = useState<"idle" | "sent">("idle");
  const [rematchVotes, setRematchVotes] = useState(0);
  const [, forceHud] = useState(0);

  // ---- Satin alma islemleri (Q/E/R kisayollari da kullanir) ----
  const buyDebuff = (id: string, cost: number) => {
    const engine = engineRef.current;
    if (!engine || engine.gold < cost) return;
    engine.gold -= cost;
    getSocket().emit("game:debuffApplied", { id });
    engine.addText(engine.playerX, engine.playerY - 100, "Rakibe gönderildi!", "#a78bfa");
    setShopChoices((prev) => prev.filter((d) => d.id !== id));
  };

  const buyMonsterUpgrade = () => {
    const engine = engineRef.current;
    const cost = 100 + upgradesRef.current * 75;
    if (!engine || engine.gold < cost) return;
    engine.gold -= cost;
    getSocket().emit("game:debuffApplied", { id: "levelUpMonsters" });
    engine.addText(engine.playerX, engine.playerY - 100, "Canavarlar güçlendi!", "#ef4444");
    setSentMonsterUpgrades((p) => p + 1);
  };

  const buyUltimateBoss = () => {
    const engine = engineRef.current;
    if (!engine || engine.gold < 500) return;
    engine.gold -= 500;
    getSocket().emit("game:debuffApplied", { id: "spawnUltimateBoss" });
    engine.addText(engine.playerX, engine.playerY - 100, "ULTIMATE BOSS gönderildi!", "#ef4444");
  };

  const buyBySlot = (slot: 0 | 1 | 2) => {
    if (shopOpenRef.current === "market") {
      const d = shopChoicesRef.current[slot];
      if (d) buyDebuff(d.id, d.cost);
    } else if (shopOpenRef.current === "dark") {
      if (slot === 0) buyMonsterUpgrade();
      if (slot === 1) buyUltimateBoss();
    }
  };

  useEffect(() => {
    const socket = getSocket();

    const engine = new GameEngine(seed, {
      onKill: (count) => socket.emit("game:enemySpawn", { count }),
      onLevelUp: (c) => setChoiceQueue((q) => [...q, c]),
      onDeath: () => {
        socket.emit("game:playerDied");
        setSpectating(true);
      },
    });
    engineRef.current = engine;

    // --- Socket ---
    const onEnemySpawn = (data: { count: number }) => engine.queueEnemySpawns(data.count ?? 2);
    const onDebuff = (data: { id: string }) => engine.applyDebuff(data.id);
    const onStateSync = (data: OppSnapshot & { from: string }) => {
      snapshotsRef.current.set(data.from, data);
    };
    const onPlayerDead = (data: { id: string }) => {
      setDeadIds((prev) => new Set(prev).add(data.id));
    };
    const onGameOver = (data: { winnerTeam: 0 | 1 }) => {
      engine.gameOver = true;
      setResult(data.winnerTeam === myTeam ? "win" : "lose");
    };
    const onRematchRequested = (data: { count: number }) => setRematchVotes(data.count ?? 0);
    socket.on("game:enemySpawn", onEnemySpawn);
    socket.on("game:debuffApplied", onDebuff);
    socket.on("game:stateSync", onStateSync);
    socket.on("game:playerDead", onPlayerDead);
    socket.on("game:over", onGameOver);
    socket.on("game:rematchRequested", onRematchRequested);

    // Arena durumu yayini (10 Hz) — pozisyon, yaratiklar, chat, hasar istatistigi
    const syncTimer = setInterval(() => {
      const snapshot: OppSnapshot = {
        hp: engine.hp, maxHp: engine.maxHp, level: engine.level, kills: engine.kills,
        x: engine.playerX, y: engine.playerY, facing: engine.facing,
        char: hero, name: myName,
        say: engine.playerSay && engine.elapsed < engine.playerSayUntil ? engine.playerSay : undefined,
        stats: engine.damageByWeapon,
        creatures: engine.creatures
          .filter((c) => !c.dead)
          .slice(0, 150)
          .map((c) => ({
            x: Math.round(c.x), y: Math.round(c.y),
            s: c.def.sprite, f: c.facing,
            hp: Math.round((c.hp / c.maxHp) * 100) / 100,
            lvl: c.level, isBoss: c.isBoss, isUltimateBoss: c.isUltimateBoss,
            say: c.say,
          })),
      };
      socket.emit("game:stateSync", snapshot);
    }, 100);
    const hudTimer = setInterval(() => {
      forceHud((n) => n + 1);
      // Saticidan uzaklasinca panel kapanir
      if (shopOpenRef.current === "market" && !engine.nearVendor) setShopOpen(null);
      if (shopOpenRef.current === "dark" && !engine.nearUpgrader) setShopOpen(null);
    }, 100);

    // --- Klavye ---
    const pickByIndex = (i: number) => {
      const q = choiceQueueRef.current;
      if (q.length > 0 && q[0][i]) {
        engine.applyChoice(q[0][i]);
        setChoiceQueue((prev) => prev.slice(1));
      }
    };
    const down = (e: KeyboardEvent) => {
      if (chatOpenRef.current) return; // chat yazarken oyun tuslari devre disi
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") engine.input.left = true;
      if (k === "d" || k === "arrowright") engine.input.right = true;
      if (k === "w" || k === "arrowup") engine.input.up = true;
      if (k === "s" || k === "arrowdown") engine.input.down = true;
      // F: market ac/kapa
      if (k === "f") {
        if (engine.nearVendor) setShopOpen((v) => (v === "market" ? null : "market"));
        else if (engine.nearUpgrader) setShopOpen((v) => (v === "dark" ? null : "dark"));
      }
      // Q/E/R: acik marketten satin al
      if (k === "q") buyBySlot(0);
      if (k === "e") buyBySlot(1);
      if (k === "r") buyBySlot(2);
      // 1/2/3: level up secimi
      if (k === "1") pickByIndex(0);
      if (k === "2") pickByIndex(1);
      if (k === "3") pickByIndex(2);
      // Enter: chat ac
      if (e.key === "Enter") {
        setChatOpen(true);
        setTimeout(() => chatInputRef.current?.focus(), 30);
      }
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

    // --- Sprite'lar + dongu ---
    const sprites: SpriteBundle = { player: undefined, heroes: new Map(), creatures: new Map() };
    let raf = 0;
    let last = performance.now();
    let running = true;

    (async () => {
      for (const h of HEROES) sprites.heroes.set(h.id, await loadCreatureSprites(h.id));
      sprites.player = sprites.heroes.get(hero);
      for (const c of CREATURES) {
        if (!sprites.creatures.has(c.sprite)) {
          sprites.creatures.set(c.sprite, sprites.heroes.get(c.sprite) ?? (await loadCreatureSprites(c.sprite)));
        }
      }
      const loop = (now: number) => {
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        engine.update(dt);
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) render(ctx, engine, sprites);
        // Diger oyuncularin arenalari
        for (const p of players) {
          if (p.id === myId) continue;
          const c = otherCanvasRefs.current[p.id];
          const octx = c?.getContext("2d");
          if (octx) {
            renderOpponentView(octx, snapshotsRef.current.get(p.id) ?? null, sprites, now / 1000, p.team !== myTeam);
          }
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
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      socket.off("game:enemySpawn", onEnemySpawn);
      socket.off("game:debuffApplied", onDebuff);
      socket.off("game:stateSync", onStateSync);
      socket.off("game:playerDead", onPlayerDead);
      socket.off("game:over", onGameOver);
      socket.off("game:rematchRequested", onRematchRequested);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const g = engineRef.current;
  const currentChoices = choiceQueue[0] ?? null;

  // Market acilinca 3 rastgele debuff sun
  useEffect(() => {
    if (shopOpen === "market") {
      const shuffled = [...DEBUFFS].sort(() => Math.random() - 0.5);
      setShopChoices(shuffled.slice(0, 3));
    }
  }, [shopOpen]);

  const sendChat = () => {
    const engine = engineRef.current;
    if (engine && chatText.trim()) engine.say(chatText);
    setChatText("");
    setChatOpen(false);
  };

  const pick = (choice: LevelUpChoice) => {
    engineRef.current?.applyChoice(choice);
    setChoiceQueue((prev) => prev.slice(1));
  };

  const upgradeCost = 100 + sentMonsterUpgrades * 75;
  const hpPct = g ? Math.max(0, g.hp / g.maxHp) : 1;
  const keyChips = ["Q", "E", "R"];

  // Oyun sonu hasar tablosu verisi
  const statsOf = (id: string): { name: string; stats: Record<string, number> } => {
    if (id === myId) return { name: myName, stats: g?.damageByWeapon ?? {} };
    const snap = snapshotsRef.current.get(id);
    return { name: snap?.name ?? players.find((p) => p.id === id)?.name ?? "?", stats: snap?.stats ?? {} };
  };

  const ArenaCanvas = ({ p, small }: { p: LobbyPlayer; small?: boolean }) => {
    const snap = snapshotsRef.current.get(p.id);
    const dead = deadIds.has(p.id);
    const hostile = p.team !== myTeam;
    return (
      <div style={{ width: small ? "calc(50% - 4px)" : "100%", minWidth: 0, opacity: dead ? 0.45 : 1 }}>
        <div style={{ ...st.arenaLabel, background: hostile ? "#2d1218" : "#12291c", color: hostile ? "#f87171" : "#4ade80" }}>
          {dead ? "ÖLDÜ — " : ""}{p.name} · Lv {snap?.level ?? 1} · {Math.max(0, Math.ceil(snap?.hp ?? 0))} HP
        </div>
        <canvas
          ref={(el) => { otherCanvasRefs.current[p.id] = el; }}
          width={ARENA.width}
          height={ARENA.height}
          style={{ display: "block", width: "100%", border: `1px solid ${hostile ? "#402330" : "#1d3a2a"}`, borderRadius: "0 0 8px 8px" }}
        />
      </div>
    );
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* ---- Ust HUD ---- */}
      <div style={st.bar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <div style={st.levelBadge}>{g?.level ?? 1}</div>
          <b style={{ fontSize: 13 }}>{myName}</b>
          <div style={{ flex: 1, maxWidth: 260 }}>
            <div style={st.hpOuter}>
              <div style={{ ...st.hpInner, width: `${hpPct * 100}%`, background: hpPct > 0.35 ? "linear-gradient(90deg,#22c55e,#4ade80)" : "linear-gradient(90deg,#dc2626,#ef4444)" }} />
              <span style={st.hpText}>{Math.max(0, Math.ceil(g?.hp ?? 0))} / {g?.maxHp ?? 100}</span>
            </div>
            <div style={st.xpOuter}>
              <div style={{ ...st.xpInner, width: `${Math.min(100, ((g?.xp ?? 0) / (g?.xpNeeded ?? 1)) * 100)}%` }} />
            </div>
          </div>
          <span style={st.stat}><span style={st.coin} /> {g?.gold ?? 0}</span>
          <span style={st.stat}>{g?.kills ?? 0} kill</span>
        </div>

        <div style={st.timer}>
          {String(Math.floor((g?.elapsed ?? 0) / 60)).padStart(2, "0")}:{String(Math.floor((g?.elapsed ?? 0) % 60)).padStart(2, "0")}
        </div>

        {/* Envanter mini */}
        <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
          {g?.weapons.map((w) => (
            <span key={w.def.type} style={{ ...st.slot, borderColor: w.def.color }} title={`${w.def.name} Lv${w.level}`}>
              {w.def.emoji}<small style={st.slotLvl}>{w.level}</small>
            </span>
          ))}
          <span style={{ width: 8 }} />
          {g?.books.map((b) => (
            <span key={b.def.type} style={st.slot} title={`${b.def.name} Lv${b.level}`}>
              {b.def.emoji}<small style={st.slotLvl}>{b.level}</small>
            </span>
          ))}
        </div>
      </div>

      {/* ---- Ortadan ikiye bolunmus savas alani ---- */}
      <div style={{ display: "flex", flex: 1, gap: 0, minHeight: 0, padding: "6px 8px 4px" }}>
        {/* SOL: benim takimim */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", paddingRight: 5 }}>
          <div>
            <div style={{ ...st.arenaLabel, background: "#1c1433", color: "#c084fc" }}>
              {spectating ? "ÖLDÜN (izliyorsun) — " : ""}{myName} (SEN) · TAKIM {myTeam + 1}
            </div>
            <canvas
              ref={canvasRef}
              width={ARENA.width}
              height={ARENA.height}
              style={{ display: "block", width: "100%", border: "1px solid #2b2340", borderRadius: "0 0 8px 8px" }}
            />
          </div>
          {teammates.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {teammates.map((p) => <ArenaCanvas key={p.id} p={p} small={teammates.length > 1} />)}
            </div>
          )}
        </div>

        {/* ORTA cizgi */}
        <div style={{ width: 3, background: "linear-gradient(180deg,#7c3aed44,#ef444444)", borderRadius: 2, flexShrink: 0 }} />

        {/* SAG: dusman takimi */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", paddingLeft: 5 }}>
          {enemies.map((p) => <ArenaCanvas key={p.id} p={p} small={enemies.length > 2} />)}
        </div>
      </div>

      {/* Alt bilgi cubugu */}
      <div style={st.footer}>
        WASD hareket · F market · Q/E/R satın al · 1-3 seçim · Enter chat
      </div>

      {/* ---- Level Up paneli ---- */}
      {currentChoices && !result && (
        <div className="slide-down" style={st.levelUpPanel}>
          <div style={{ textAlign: "center", fontSize: 13, marginBottom: 8, color: "#fbbf24", fontWeight: 800, letterSpacing: 1 }}>
            SEVİYE ATLADIN {choiceQueue.length > 1 && <span style={{ opacity: 0.7 }}>(+{choiceQueue.length - 1} bekliyor)</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {currentChoices.map((c, i) => (
              <button key={i} className="btn ghost" style={st.choiceCard} onClick={() => pick(c)}>
                <div style={{ fontSize: 15, marginBottom: 2 }}>
                  <kbd style={st.kbd}>{i + 1}</kbd> {c.emoji}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{c.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Market (F ile acilir, Q/E/R ile satin alinir) ---- */}
      {shopOpen === "market" && !result && (
        <div className="slide-down" style={st.shopPanel}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <b style={{ color: "#eab308" }}>MARKET — Rakibi Sabote Et</b>
            <span style={{ fontSize: 13 }}><span style={st.coin} /> {g?.gold ?? 0}</span>
          </div>
          {shopChoices.map((d, i) => (
            <button key={d.id} className="btn ghost"
              style={{ ...st.shopItem, opacity: (g?.gold ?? 0) >= d.cost ? 1 : 0.4 }}
              onClick={() => buyDebuff(d.id, d.cost)}>
              <kbd style={{ ...st.kbd, fontSize: 13, padding: "3px 8px" }}>{keyChips[i]}</kbd>
              <span style={{ flex: 1, textAlign: "left", marginLeft: 10 }}>
                <b style={{ fontSize: 13 }}>{d.emoji} {d.name}</b>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{d.desc}</div>
              </span>
              <b style={{ fontSize: 13, color: "#eab308" }}>{d.cost}</b>
            </button>
          ))}
          <div style={st.shopHint}>[F] kapat · [Q/E/R] satın al — oyun devam ediyor!</div>
        </div>
      )}

      {/* ---- Karanlik Market ---- */}
      {shopOpen === "dark" && !result && (
        <div className="slide-down" style={{ ...st.shopPanel, borderColor: "#ef444488" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <b style={{ color: "#f87171" }}>KARANLIK MARKET — Kalıcı Güçlendirme</b>
            <span style={{ fontSize: 13 }}><span style={st.coin} /> {g?.gold ?? 0}</span>
          </div>
          <button className="btn ghost"
            style={{ ...st.shopItem, opacity: (g?.gold ?? 0) >= upgradeCost ? 1 : 0.4 }}
            onClick={buyMonsterUpgrade}>
            <kbd style={{ ...st.kbd, fontSize: 13, padding: "3px 8px" }}>Q</kbd>
            <span style={{ flex: 1, textAlign: "left", marginLeft: 10 }}>
              <b style={{ fontSize: 13 }}>Canavar Seviyesi +1 (Kalıcı)</b>
              <div style={{ fontSize: 11, opacity: 0.75 }}>Rakip yaratıkları kalıcı güçlenir — her satın alım pahalılaşır</div>
            </span>
            <b style={{ fontSize: 13, color: "#f87171" }}>{upgradeCost}</b>
          </button>
          <button className="btn ghost"
            style={{ ...st.shopItem, opacity: (g?.gold ?? 0) >= 500 ? 1 : 0.4 }}
            onClick={buyUltimateBoss}>
            <kbd style={{ ...st.kbd, fontSize: 13, padding: "3px 8px" }}>E</kbd>
            <span style={{ flex: 1, textAlign: "left", marginLeft: 10 }}>
              <b style={{ fontSize: 13 }}>ULTIMATE BOSS</b>
              <div style={{ fontSize: 11, opacity: 0.75 }}>Rakibe 5x boyut, 100x can dev boss yollar</div>
            </span>
            <b style={{ fontSize: 13, color: "#f87171" }}>500</b>
          </button>
          <div style={st.shopHint}>[F] kapat · [Q/E] satın al — oyun devam ediyor!</div>
        </div>
      )}

      {/* ---- Chat girisi ---- */}
      {chatOpen && !result && (
        <div style={st.chatBox}>
          <input
            ref={chatInputRef}
            style={st.chatInput}
            placeholder="Mesajın karakterinin üstünde belirir..."
            maxLength={60}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendChat();
              if (e.key === "Escape") { setChatText(""); setChatOpen(false); }
              e.stopPropagation();
            }}
            onBlur={() => setChatOpen(false)}
          />
        </div>
      )}

      {/* ---- Olum / izleme bandi ---- */}
      {spectating && !result && (
        <div style={st.spectateBand}>ÖLDÜN — takım arkadaşlarını izliyorsun...</div>
      )}

      {/* ---- Oyun sonu + hasar istatistikleri ---- */}
      {result && (
        <div style={st.overlay}>
          <div className="card slide-down" style={{ padding: "32px 40px", textAlign: "center", maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto" }}>
            <h1 className={result === "win" ? "title-glow" : ""} style={{ fontSize: 44, marginBottom: 6 }}>
              {result === "win" ? "ZAFER!" : "YENİLGİ"}
            </h1>
            <p style={{ opacity: 0.7, marginBottom: 20, fontSize: 14 }}>
              Takım {myTeam + 1} {result === "win" ? "kazandı" : "kaybetti"} · {Math.floor((g?.elapsed ?? 0) / 60)}dk {Math.floor((g?.elapsed ?? 0) % 60)}sn
            </p>

            {/* Silah hasar tablosu — herkes icin */}
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
              {players.map((p) => {
                const { name, stats } = statsOf(p.id);
                const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
                const total = entries.reduce((s, [, v]) => s + v, 0);
                return (
                  <div key={p.id} style={{ ...st.statCard, borderColor: p.team === myTeam ? "#818cf8" : "#f87171" }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2, color: p.team === myTeam ? "#818cf8" : "#f87171" }}>
                      {name}{p.id === myId ? " (SEN)" : ""}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>Toplam hasar: {total.toLocaleString("tr-TR")}</div>
                    {entries.length === 0 && <div style={{ fontSize: 12, opacity: 0.5 }}>—</div>}
                    {entries.map(([type, dmg]) => {
                      const def = WEAPONS.find((w) => w.type === type);
                      return (
                        <div key={type} style={st.statRow}>
                          <span>{def?.emoji} {def?.name ?? type}</span>
                          <div style={{ flex: 1, height: 5, background: "#0a0812", borderRadius: 3, margin: "0 8px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${total ? (dmg / total) * 100 : 0}%`, background: def?.color ?? "#7c3aed" }} />
                          </div>
                          <b>{dmg.toLocaleString("tr-TR")}</b>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {rematch === "sent" ? (
              <p className="pulse" style={{ color: "#c084fc", marginBottom: 16, fontSize: 14 }}>
                Rematch bekleniyor... ({rematchVotes}/{players.length})
              </p>
            ) : rematchVotes > 0 ? (
              <p className="pulse" style={{ color: "#4ade80", marginBottom: 16, fontSize: 14 }}>
                {rematchVotes} oyuncu rematch istiyor!
              </p>
            ) : null}

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              {rematch !== "sent" && (
                <button className="btn" onClick={() => { getSocket().emit("game:rematch"); setRematch("sent"); }}>
                  Rematch
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

const st: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex", alignItems: "center", gap: 16, padding: "8px 14px",
    background: "#120e1c", borderBottom: "1px solid #2b2340", flexShrink: 0,
  },
  levelBadge: {
    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
    background: "linear-gradient(135deg,#7c3aed,#4c1d95)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: 15, boxShadow: "0 2px 12px #7c3aed55",
  },
  hpOuter: {
    position: "relative", height: 16, background: "#0a0812",
    borderRadius: 5, overflow: "hidden", border: "1px solid #2b2340",
  },
  hpInner: { height: "100%", transition: "width .15s" },
  hpText: {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 10, fontWeight: 700, textShadow: "0 1px 2px #000",
  },
  xpOuter: { height: 4, background: "#0a0812", borderRadius: 2, overflow: "hidden", marginTop: 3 },
  xpInner: { height: "100%", background: "linear-gradient(90deg,#7c3aed,#c084fc)", transition: "width .2s" },
  stat: { fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 },
  coin: {
    display: "inline-block", width: 10, height: 10, borderRadius: 5,
    background: "radial-gradient(circle at 35% 35%, #fde68a, #d97706)", flexShrink: 0,
  },
  timer: { fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums", opacity: 0.9 },
  slot: {
    width: 32, height: 32, background: "#1c1728", border: "1px solid #2b2340",
    borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative", fontSize: 14, flexShrink: 0,
  },
  slotLvl: { position: "absolute", bottom: 0, right: 3, fontSize: 9, fontWeight: 800, color: "#c084fc" },
  arenaLabel: {
    fontSize: 10, fontWeight: 800, letterSpacing: 1.5, padding: "4px 10px",
    borderRadius: "8px 8px 0 0", border: "1px solid #2b2340", borderBottom: "none",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  footer: {
    textAlign: "center", fontSize: 11, opacity: 0.4, padding: "3px 0 6px", flexShrink: 0,
  },
  levelUpPanel: {
    position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
    background: "#141020f2", border: "1px solid #fbbf24aa", borderRadius: 14,
    padding: 14, zIndex: 10, boxShadow: "0 8px 40px #fbbf2433",
  },
  choiceCard: { width: 185, padding: 10, textAlign: "center", borderRadius: 10 },
  kbd: {
    background: "#2b2340", borderRadius: 4, padding: "1px 6px",
    fontSize: 11, fontWeight: 700, color: "#c084fc",
  },
  shopPanel: {
    position: "absolute", left: 16, bottom: 60, width: 360,
    background: "#141020f6", border: "1px solid #eab30888", borderRadius: 14,
    padding: 14, zIndex: 10, display: "flex", flexDirection: "column", gap: 6,
    boxShadow: "0 8px 40px #00000088",
  },
  shopItem: { display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: 8 },
  shopHint: { fontSize: 11, opacity: 0.5, textAlign: "center", marginTop: 4 },
  chatBox: {
    position: "absolute", bottom: 40, left: "25%", transform: "translateX(-50%)",
    width: 380, zIndex: 15,
  },
  chatInput: {
    width: "100%", background: "#141020f6", color: "#e8e8f0",
    border: "2px solid #7c3aed", borderRadius: 10, padding: "10px 14px",
    fontSize: 14, outline: "none",
  },
  spectateBand: {
    position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
    background: "#dc2626dd", padding: "8px 24px", borderRadius: 10,
    fontWeight: 800, fontSize: 14, zIndex: 12, letterSpacing: 1,
  },
  overlay: {
    position: "absolute", inset: 0, background: "#000000d5", zIndex: 20,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  statCard: {
    background: "#0f0c18", border: "2px solid", borderRadius: 12,
    padding: "12px 16px", width: 260, textAlign: "left",
  },
  statRow: { display: "flex", alignItems: "center", fontSize: 11, marginBottom: 4 },
};
