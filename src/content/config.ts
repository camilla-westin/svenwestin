import { defineCollection, z } from "astro:content";

const importedEntry = z.object({
  title: z.string(),
  wpSlug: z.string(),
  date: z.coerce.date(),
  author: z.string().default("Sven Westin"),
  excerpt: z.string().default(""),
  sourceId: z.string(),
  originalUrl: z.string().url().or(z.literal("")),
});

export const collections = {
  blog: defineCollection({
    type: "content",
    schema: importedEntry,
  }),
  pages: defineCollection({
    type: "content",
    schema: importedEntry,
  }),
};
