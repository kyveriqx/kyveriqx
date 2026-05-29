/* Tool category map — drives the section split on /store.
   Plug & Play = self-serve SaaS (subscribe via Razorpay, start instantly).
   Hands-On Setup = needs an implementation engagement (WA Business API,
   voice-channel provisioning, portal integration). Hands-On cards skip the
   Razorpay path entirely and route to the Book-a-Call section on the
   landing page.

   If a `category` column is later added to public.tools, replace categoryFor()
   with a column lookup — this file is the only place that needs to change. */

export type ToolCategory = "plug-and-play" | "hands-on";

export const CATEGORY_BY_SLUG: Record<string, ToolCategory> = {
  gstledgerreco:    "plug-and-play",
  bankledgerreco:   "plug-and-play",
  orgledgerreco:    "plug-and-play",
  orgmis:           "plug-and-play",
  emailcampaign:    "plug-and-play",
  custportal:       "hands-on",
  whatsappcampaign: "hands-on",
  callingtool:      "hands-on",
};

export type CategoryMeta = {
  title: string;
  tagline: string;
  chip: string;
};

export const CATEGORY_META: Record<ToolCategory, CategoryMeta> = {
  "plug-and-play": {
    title:   "Plug & Play",
    tagline: "subscribe & go",
    chip:    "PLUG & PLAY",
  },
  "hands-on": {
    title:   "Hands-On Setup",
    tagline: "we come to you",
    chip:    "HANDS-ON",
  },
};

// Unknown slugs default to Plug & Play so a newly seeded tool stays in the
// safe self-serve lane until it's explicitly added to CATEGORY_BY_SLUG.
export function categoryFor(slug: string): ToolCategory {
  return CATEGORY_BY_SLUG[slug] ?? "plug-and-play";
}
