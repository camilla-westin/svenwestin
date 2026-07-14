import { XMLParser } from "fast-xml-parser";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const xmlPath = path.join(root, "svenwestin.wordpress.2026-07-14.xml");
const blogDir = path.join(root, "src", "content", "blog");
const pagesDir = path.join(root, "src", "content", "pages");
const mediaDir = path.join(root, "public", "media", "imported");
const reportPath = path.join(root, "import-report.json");
const publicBasePath = normalizeBasePath(process.env.PUBLIC_BASE_PATH || "");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: false,
});

const authorFallbacks = {
  camilla: "admin",
  sven: "Sven Westin",
};

const mediaByUrl = new Map();
const missingMedia = [];
const downloadedMedia = [];
const encodingFixes = [];

await resetGeneratedDir(blogDir);
await resetGeneratedDir(pagesDir);
await mkdir(mediaDir, { recursive: true });

const xml = await readFile(xmlPath, "utf8");
const data = parser.parse(xml);
const channel = data.rss.channel;
const items = asArray(channel.item);

for (const attachment of items.filter((item) => field(item, "wp:post_type") === "attachment")) {
  const url = field(attachment, "wp:attachment_url") || field(attachment, "guid");
  if (url) {
    mediaByUrl.set(url, null);
  }
}

const publishedPosts = items.filter(
  (item) => field(item, "wp:post_type") === "post" && field(item, "wp:status") === "publish",
);
const publishedPages = items.filter(
  (item) => field(item, "wp:post_type") === "page" && field(item, "wp:status") === "publish",
);
const draftPosts = items.filter(
  (item) => field(item, "wp:post_type") === "post" && field(item, "wp:status") === "draft",
);

for (const post of publishedPosts) {
  await writeImportedEntry(post, blogDir, "post");
}

for (const page of publishedPages) {
  await writeImportedEntry(page, pagesDir, "page");
}

const report = {
  generatedAt: new Date().toISOString(),
  source: path.basename(xmlPath),
  counts: {
    publishedPosts: publishedPosts.length,
    draftPostsSkipped: draftPosts.length,
    pages: publishedPages.length,
    mediaDownloaded: downloadedMedia.length,
    mediaMissing: missingMedia.length,
    encodingFixes: encodingFixes.length,
  },
  downloadedMedia,
  missingMedia,
  encodingFixes,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Imported ${publishedPosts.length} posts and ${publishedPages.length} pages.`);
console.log(`Skipped ${draftPosts.length} draft posts.`);
console.log(`Downloaded ${downloadedMedia.length} media files; ${missingMedia.length} missing or external files remain.`);
console.log(`Wrote ${path.relative(root, reportPath)}.`);

async function writeImportedEntry(item, targetDir, kind) {
  const sourceId = field(item, "wp:post_id");
  const title = normalizeText(field(item, "title") || "Utan titel", `title:${sourceId}`);
  const rawSlug = normalizeText(field(item, "wp:post_name"), `slug:${sourceId}`);
  const date = field(item, "wp:post_date") || field(item, "pubDate") || new Date().toISOString();
  const slug = uniqueSlug(slugify(rawSlug || title || sourceId), sourceId, kind);
  const author = authorFallbacks[field(item, "dc:creator")] || field(item, "dc:creator") || "Sven Westin";
  const originalUrl = field(item, "link");
  const rawContent = normalizeText(field(item, "content:encoded"), `content:${sourceId}`);
  const content = await rewriteMedia(sanitizeHtml(rawContent));
  const excerpt = normalizeText(makeExcerpt(field(item, "excerpt:encoded") || rawContent), `excerpt:${sourceId}`);

  const markdown = [
    "---",
    `title: ${yamlString(title)}`,
    `wpSlug: ${yamlString(slug)}`,
    `date: ${yamlString(date)}`,
    `author: ${yamlString(author)}`,
    `excerpt: ${yamlString(excerpt)}`,
    `sourceId: ${yamlString(sourceId)}`,
    `originalUrl: ${yamlString(originalUrl)}`,
    "generated: true",
    "---",
    "",
    content.trim() || "<p></p>",
    "",
  ].join("\n");

  await writeFile(path.join(targetDir, `${slug}.md`), markdown, "utf8");
}

async function rewriteMedia(html) {
  const urlPattern = /https?:\/\/[^"'\s<>]+\.(?:jpe?g|png|gif|webp)(?:\?[^"'\s<>]*)?/gi;
  const replacements = new Map();
  const urls = [...new Set(html.match(urlPattern) || [])];

  for (const url of urls) {
    const localUrl = await downloadMedia(url);
    if (localUrl) {
      replacements.set(url, localUrl);
    }
  }

  let rewritten = html;
  for (const [from, to] of replacements) {
    rewritten = rewritten.split(from).join(to);
  }

  return rewritten;
}

async function downloadMedia(url) {
  if (mediaByUrl.has(url) && mediaByUrl.get(url)) {
    return mediaByUrl.get(url);
  }

  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase() || ".jpg";
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
    const basename = path.basename(parsed.pathname, ext).replace(/[^a-zA-Z0-9._-]+/g, "-") || "media";
    const filename = `${basename}-${hash}${ext}`;
    const publicPath = `${publicBasePath}/media/imported/${filename}`;
    const filePath = path.join(mediaDir, filename);

    const response = await fetch(url, {
      headers: {
        "user-agent": "svenwestin-static-import/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, bytes);

    mediaByUrl.set(url, publicPath);
    downloadedMedia.push({ source: url, local: publicPath, bytes: bytes.length });
    return publicPath;
  } catch (error) {
    if (!missingMedia.some((entry) => entry.source === url)) {
      missingMedia.push({ source: url, reason: error.message });
    }
    mediaByUrl.set(url, null);
    return null;
  }
}

async function resetGeneratedDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

function field(object, key) {
  return textValue(object?.[key]);
}

function textValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textValue).join("");
  }
  if (typeof value === "object") {
    return textValue(value["#cdata"] ?? value["#text"] ?? "");
  }
  return "";
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value, context) {
  const text = String(value || "");
  if (!/[ÃÂ]/.test(text)) {
    return text;
  }

  const fixed = Buffer.from(text, "latin1").toString("utf8");
  if (scoreSwedish(fixed) > scoreSwedish(text)) {
    encodingFixes.push({ context, from: preview(text), to: preview(fixed) });
    return fixed;
  }

  return text;
}

function scoreSwedish(value) {
  const good = (value.match(/[åäöÅÄÖéÉ]/g) || []).length * 2;
  const bad = (value.match(/[ÃÂ�]/g) || []).length * 3;
  return good - bad;
}

function preview(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function sanitizeHtml(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function makeExcerpt(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim().slice(0, 220);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function uniqueSlug(slug, sourceId, kind) {
  const normalized = slug || `${kind}-${sourceId}`;
  return normalized.replace(/^-+|-+$/g, "") || `${kind}-${sourceId}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}
