import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Oyuncu profilleri — kalici istatistikler
  profiles: defineTable({
    name: v.string(),
    wins: v.number(),
    losses: v.number(),
    highestLevel: v.number(),
    totalKills: v.number(),
    // Kullanicinin cizdigi karakter sprite'i (Convex storage)
    characterImageId: v.optional(v.id("_storage")),
  }).index("by_name", ["name"]),

  // Bitmis maclarin kaydi — leaderboard ve gecmis icin
  matches: defineTable({
    inviteCode: v.string(),
    winnerName: v.string(),
    loserName: v.string(),
    durationMs: v.number(),
    winnerLevel: v.number(),
    loserLevel: v.number(),
    endedAt: v.number(),
  }).index("by_endedAt", ["endedAt"]),
});
