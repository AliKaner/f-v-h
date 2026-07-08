import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const record = mutation({
  args: {
    inviteCode: v.string(),
    winnerName: v.string(),
    loserName: v.string(),
    durationMs: v.number(),
    winnerLevel: v.number(),
    loserLevel: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("matches", { ...args, endedAt: Date.now() });

    // Profil istatistiklerini guncelle
    for (const [name, won, level] of [
      [args.winnerName, true, args.winnerLevel],
      [args.loserName, false, args.loserLevel],
    ] as const) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_name", (q) => q.eq("name", name))
        .unique();
      if (profile) {
        await ctx.db.patch(profile._id, {
          wins: profile.wins + (won ? 1 : 0),
          losses: profile.losses + (won ? 0 : 1),
          highestLevel: Math.max(profile.highestLevel, level),
        });
      }
    }
  },
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("matches")
      .withIndex("by_endedAt")
      .order("desc")
      .take(20);
  },
});
