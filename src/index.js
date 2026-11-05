// Pixel stickers Worker.
// Static site is served from ./public. This Worker only runs for /api/* and /img/*
// (see "run_worker_first" in wrangler.jsonc). The R2 bucket is never public:
// the only way to reach it is through the two read-only routes below.

const IMAGE_TYPES = {
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
  // SVG is deliberately not allowed: an SVG opened directly can run scripts.
};

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function getPrefix(env) {
  let p = (env.STICKER_PREFIX || "").replace(/^\/+/, "");
  if (p && !p.endsWith("/")) p += "/";
  return p;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...BASE_HEADERS,
      ...extra,
    },
  });
}

async function listStickers(env) {
  const prefix = getPrefix(env);
  const stickers = [];
  let cursor;
  do {
    const page = await env.STICKERS.list({ prefix, cursor, limit: 1000 });
    for (const obj of page.objects) {
      const name = obj.key.slice(prefix.length);
      // Only files directly inside the folder, and only image types.
      if (!name || name.includes("/")) continue;
      if (!IMAGE_TYPES[extOf(name)]) continue;
      stickers.push({ name, size: obj.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  stickers.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  return stickers;
}

async function serveImage(request, env, rawName, asDownload) {
  let name;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return json({ error: "Bad file name." }, 400);
  }

  // Block anything that could climb out of the sticker folder.
  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0") ||
    !IMAGE_TYPES[extOf(name)]
  ) {
    return json({ error: "Not found." }, 404);
  }

  const obj = await env.STICKERS.get(getPrefix(env) + name, {
    onlyIf: request.headers, // lets browsers revalidate with If-None-Match
  });
  if (!obj) return json({ error: "Not found." }, 404);

  const headers = new Headers({
    "Content-Type": IMAGE_TYPES[extOf(name)], // from extension, not stored metadata
    "Cache-Control": "public, max-age=3600",
    ETag: obj.httpEtag,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ...BASE_HEADERS,
  });

  if (asDownload) {
    const safe = name.replace(/["\r\n]/g, "_");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
  }

  // No body on the object means the conditional request matched.
  if (!("body" in obj) || obj.body === undefined) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(obj.size));
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed." }, 405, { Allow: "GET, HEAD" });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/stickers") {
        const stickers = await listStickers(env);
        return json({ stickers }, 200, {
          "Cache-Control": "public, max-age=60",
        });
      }

      if (url.pathname.startsWith("/img/")) {
        return await serveImage(
          request,
          env,
          url.pathname.slice("/img/".length),
          url.searchParams.has("download")
        );
      }
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong on the server." }, 500);
    }

    return json({ error: "Not found." }, 404);
  },
};
