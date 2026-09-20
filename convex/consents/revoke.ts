import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const revoke = mutation({
  args: { consentId: v.id("consents") },
  returns: v.null(),
  handler: async (ctx, { consentId }) => {
    const consent = await ctx.db.get(consentId);
    if (!consent) throw new Error(`Unknown consent: ${consentId}`);
    // A revoked row keeps the scope it was granted with, so the patch never
    // touches that field.
    // Only the first revoke stamps the time, which keeps a repeated revoke
    // from moving the moment consent ended.
    if (consent.revokedAt === undefined) await ctx.db.patch(consentId, { revokedAt: Date.now() });
    return null;
  },
});
