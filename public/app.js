// Pixel stickers front end. No dependencies, no inline scripts (CSP friendly).

const $ = (sel) => document.querySelector(sel);

const grid = $("#grid");
const countEl = $("#count");
const statusEl = $("#status");
const btnSelectAll = $("#select-all");
const btnClear = $("#clear");
const btnSelected = $("#download-selected");
const btnAll = $("#download-all");

let stickers = [];
const selected = new Set();
let busy = false;

// Use the placeholder avatar until you add public/profile.png.
// (Done here, not with an inline onerror, because the CSP blocks inline handlers.)
const avatar = $("#avatar");
avatar.addEventListener(
  "error",
  () => { avatar.src = "/profile.svg"; },
  { once: true }
);
if (avatar.complete && avatar.naturalWidth === 0) avatar.src = "/profile.svg";

const imgUrl = (name, download = false) =>
  `/img/${encodeURIComponent(name)}${download ? "?download=1" : ""}`;

/* ---------- Status helpers ---------- */

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.dataset.error = String(isError);
}

function setBusy(value) {
  busy = value;
  updateToolbar();
}

/* ---------- Rendering ---------- */

function showSkeleton() {
  grid.setAttribute("aria-busy", "true");
  grid.replaceChildren();
  for (let i = 0; i < 12; i++) {
    const li = document.createElement("li");
    li.className = "card card--skeleton";
    li.innerHTML = '<div class="card__pick"></div><div class="card__meta"></div>';
    grid.append(li);
  }
}

function buildCard(sticker) {
  const li = document.createElement("li");
  li.className = "card";
  li.dataset.name = sticker.name;

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "card__pick";
  pick.setAttribute("aria-pressed", "false");
  pick.setAttribute("aria-label", `Select ${sticker.name}`);

  const img = document.createElement("img");
  img.src = imgUrl(sticker.name);
  img.alt = ""; // the button label already names it
  img.loading = "lazy";
  img.decoding = "async";

  const check = document.createElement("span");
  check.className = "card__check";
  check.setAttribute("aria-hidden", "true");

  pick.append(img, check);
  pick.addEventListener("click", () => toggle(sticker.name));

  const meta = document.createElement("div");
  meta.className = "card__meta";

  const name = document.createElement("span");
  name.className = "card__name";
  name.title = sticker.name;
  name.textContent = sticker.name; // textContent: file names are never parsed as HTML

  const install = document.createElement("a");
  install.className = "btn btn--small";
  install.href = imgUrl(sticker.name, true);
  install.setAttribute("download", sticker.name);
  install.textContent = "Install";

  meta.append(name, install);
  li.append(pick, meta);
  return li;
}

function render() {
  grid.setAttribute("aria-busy", "false");
  grid.replaceChildren();

  if (!stickers.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No stickers here yet. Upload images to the bucket folder and refresh.";
    grid.append(li);
  } else {
    grid.append(...stickers.map(buildCard));
  }
  updateToolbar();
}

function updateToolbar() {
  const total = stickers.length;
  countEl.textContent = total === 1 ? "1 sticker" : `${total} stickers`;

  btnSelected.textContent = `Install selected (${selected.size})`;
  btnSelected.disabled = busy || selected.size === 0;
  btnAll.disabled = busy || total === 0;
  btnSelectAll.disabled = busy || total === 0 || selected.size === total;
  btnClear.disabled = busy || selected.size === 0;
}

/* ---------- Selection ---------- */

function paint(name) {
  const card = grid.querySelector(`[data-name="${CSS.escape(name)}"]`);
  if (!card) return;
  const on = selected.has(name);
  card.classList.toggle("is-selected", on);
  card.querySelector(".card__pick").setAttribute("aria-pressed", String(on));
  card.querySelector(".card__check").textContent = on ? "X" : "";
}

function toggle(name) {
  if (selected.has(name)) selected.delete(name);
  else selected.add(name);
  paint(name);
  updateToolbar();
}

function setAll(on) {
  selected.clear();
  if (on) stickers.forEach((s) => selected.add(s.name));
  stickers.forEach((s) => paint(s.name));
  updateToolbar();
}

/* ---------- Zip (store only, no compression: pixel PNGs are already small) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true);      // stored
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/* ---------- Downloading ---------- */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function downloadList(list, zipName) {
  if (busy || !list.length) return;

  // One file: skip the zip and save it directly.
  if (list.length === 1) {
    const only = list[0].name;
    const res = await fetch(imgUrl(only));
    if (res.ok) saveBlob(await res.blob(), only);
    else setStatus(`Couldn't download ${only}. Try again.`, true);
    return;
  }

  setBusy(true);
  try {
    const files = [];
    const queue = [...list];
    let done = 0;

    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        const res = await fetch(imgUrl(s.name));
        if (!res.ok) throw new Error(`${s.name} failed (${res.status})`);
        files.push({ name: s.name, data: new Uint8Array(await res.arrayBuffer()) });
        setStatus(`Packing ${++done} of ${list.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    saveBlob(makeZip(files), zipName);
    setStatus(`Downloaded ${files.length} stickers as ${zipName}.`);
  } catch (err) {
    console.error(err);
    setStatus(`The zip didn't finish: ${err.message}. Check your connection and try again.`, true);
  } finally {
    setBusy(false);
  }
}

/* ---------- Wire up ---------- */

btnSelectAll.addEventListener("click", () => setAll(true));
btnClear.addEventListener("click", () => setAll(false));
btnSelected.addEventListener("click", () =>
  downloadList(stickers.filter((s) => selected.has(s.name)), "pixelated-stickers-selected.zip")
);
btnAll.addEventListener("click", () => downloadList(stickers, "pixelated-stickers.zip"));

async function load() {
  showSkeleton();
  setStatus("");
  try {
    const res = await fetch("/api/stickers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    stickers = Array.isArray(data.stickers) ? data.stickers : [];
    render();
  } catch (err) {
    console.error(err);
    grid.setAttribute("aria-busy", "false");
    grid.replaceChildren();
    countEl.textContent = "Stickers unavailable";
    setStatus("Couldn't load the stickers. Refresh the page to try again.", true);
  }
}

load();
