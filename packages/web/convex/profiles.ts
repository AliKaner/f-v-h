import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getOrCreate = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("profiles", {
      name,
      wins: 0,
      losses: 0,
      highestLevel: 0,
      totalKills: 0,
    });
  },
});

export const get = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
  },
});

// Karakter sprite yukleme icin kisa omurlu URL uret
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const setCharacterImage = mutation({
  args: { profileId: v.id("profiles"), storageId: v.id("_storage") },
  handler: async (ctx, { profileId, storageId }) => {
    await ctx.db.patch(profileId, { characterImageId: storageId });
  },
});

export const getCharacterImageUrl = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile?.characterImageId) return null;
    return await ctx.storage.getUrl(profile.characterImageId);
  },
});
