/**
 * Library tab — saved sources that persist across documents.
 * Search, per-source notes, formatted citations in the user's default style,
 * copy and remove.
 */
import { applyAppearance, emptyState, esc } from "/app/settings.js";

const CSS = `
.library-tab {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  padding: var(--tab-pad, 32px); gap: var(--tab-gap, 16px);
}
.library-tab .lib-frame { max-width: 880px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; flex: 1; min-height: 0; gap: var(--tab-gap, 16px); }
.library-tab h1 { font-family: var(--serif); font-size: var(--fs-2xl, 32px); font-weight: 700; letter-spacing: -.3px; }
.library-tab .lib-sub { color: var(--ink-dim); margin-top: 4px; font-size: var(--fs-sm, 13.5px); }
.library-tab .lib-search { max-width: 440px; width: 100%; }

.library-tab .lib-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
  padding-bottom: var(--s-3, 24px);
}
.library-tab .lib-item { padding: var(--card-pad, 24px); display: flex; flex-direction: column; gap: 10px; }
.library-tab .lib-item:hover { transform: none; box-shadow: var(--shadow); border-color: var(--line-strong); }
.library-tab .lib-top { display: flex; align-items: baseline; gap: 12px; }
.library-tab .lib-title {
  font-family: var(--serif); font-size: var(--fs-md, 15px); font-weight: 700; line-height: 1.3;
  color: var(--ink); text-decoration: none; flex: 1; min-width: 0;
  transition: color var(--t-fast, 150ms) var(--ease, ease);
}
.library-tab a.lib-title:hover { color: var(--accent-deep); text-decoration: underline; text-underline-offset: 3px; }
.library-tab .lib-free {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px;
  color: var(--accent-deep); background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius: 6px; padding: 2px 8px; white-space: nowrap;
}
.library-tab .lib-meta { font-size: var(--fs-xs, 12.5px); color: var(--ink-dim); }
.library-tab .lib-cite {
  display: flex; align-items: flex-start; gap: 12px;
  background: var(--bg-panel); border: 1px solid var(--line);
  border-left: 3px solid color-mix(in srgb, var(--accent) 55%, var(--line));
  border-radius: var(--radius-sm, 8px); padding: 10px 14px;
}
.library-tab .lib-cite .cite-text { font-family: var(--serif); font-size: var(--fs-sm, 13.5px); line-height: 1.6; flex: 1; min-width: 0; }
.library-tab .lib-note { width: 100%; resize: vertical; min-height: 36px; font-family: var(--sans); line-height: 1.5; }
.library-tab .lib-actions { display: flex; justify-content: flex-end; }
.library-tab .lib-remove:hover { border-color: var(--mark-red); color: var(--mark-red); }
.library-tab .lib-note-msg { color: var(--ink-faint); padding: var(--s-4, 32px) 0; text-align: center; font-size: var(--fs-sm, 13.5px); }
`;

function ensureStyles() {
  if (document.querySelector('style[data-tab="library"]')) return;
  const st = document.createElement("style");
  st.dataset.tab = "library";
  st.textContent = CSS;
  document.head.appendChild(st);
}

function metaLine(source) {
  const bits = [];
  if (Array.isArray(source.authors) && source.authors.length > 0) bits.push(source.authors.join(", "));
  if (source.year) bits.push(String(source.year));
  if (source.venue) bits.push(source.venue);
  return bits.join(" · ");
}

function citationFor(item, ctx) {
  try {
    const c = ctx.citations.formatCitation(item.source, ctx.settings.citationStyle ?? "apa");
    return c?.entry || "";
  } catch {
    return "";
  }
}

export async function render(mount, ctx) {
  applyAppearance(ctx.settings);
  ensureStyles();

  const root = document.createElement("div");
  root.className = "library-tab";
  mount.appendChild(root);

  root.innerHTML = `
    <div class="lib-frame">
      <div>
        <h1>Library</h1>
        <div class="lib-sub">Sources you saved, available to every document.</div>
      </div>
      <input class="input lib-search" id="libSearch" type="search" placeholder="Search titles, authors and notes..." />
      <div class="lib-list" id="libList"><div class="lib-note-msg">Loading…</div></div>
    </div>
  `;

  const listEl = root.querySelector("#libList");
  const searchEl = root.querySelector("#libSearch");
  let seq = 0;

  async function load(q) {
    const my = ++seq;
    let items = [];
    try {
      ({ items } = await ctx.api.library.list(q));
    } catch (e) {
      if (my === seq) listEl.innerHTML = `<div class="lib-note-msg">Could not load the library: ${esc(e.message)}</div>`;
      return;
    }
    if (my !== seq || !root.isConnected) return;

    if (items.length === 0) {
      listEl.innerHTML = q
        ? emptyState("Nothing matches that search", "Try fewer words, or search an author's name.")
        : emptyState("No saved sources yet", "Save one from an analysis and it will be here for every document.");
      return;
    }

    listEl.innerHTML = items.map((item, i) => {
      const s = item.source;
      const href = s.url || s.oaUrl || "";
      const title = href
        ? `<a class="lib-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`
        : `<span class="lib-title">${esc(s.title)}</span>`;
      const meta = metaLine(s);
      const entry = citationFor(item, ctx);
      return `
        <div class="card lib-item" data-idx="${i}" data-id="${esc(item.id)}">
          <div class="lib-top">
            ${title}
            ${s.oaUrl ? `<span class="lib-free">Free to read</span>` : ""}
          </div>
          ${meta ? `<div class="lib-meta">${esc(meta)}</div>` : ""}
          ${entry ? `
            <div class="lib-cite">
              <div class="cite-text">${esc(entry)}</div>
              <button class="btn btn-ghost lib-copy" title="Copy citation">Copy</button>
            </div>` : ""}
          <textarea class="input lib-note" placeholder="Why did you save this?" rows="1">${esc(item.note ?? "")}</textarea>
          <div class="lib-actions">
            <button class="btn btn-ghost lib-remove">Remove</button>
          </div>
        </div>
      `;
    }).join("");

    for (const card of listEl.querySelectorAll(".lib-item")) {
      const item = items[Number(card.dataset.idx)];

      const copyBtn = card.querySelector(".lib-copy");
      if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
          const entry = citationFor(item, ctx);
          try {
            await navigator.clipboard.writeText(entry);
            ctx.toast("Citation copied");
          } catch {
            ctx.toast("Could not copy — clipboard unavailable", true);
          }
        });
      }

      const noteEl = card.querySelector(".lib-note");
      let noteTimer = null;
      noteEl.addEventListener("input", () => {
        clearTimeout(noteTimer);
        noteTimer = setTimeout(async () => {
          try {
            await ctx.api.library.update(item.id, { note: noteEl.value });
          } catch (e) {
            ctx.toast(`Could not save the note: ${e.message}`, true);
          }
        }, 600);
      });

      card.querySelector(".lib-remove").addEventListener("click", async () => {
        if (!confirm(`Remove "${item.source.title}" from your library?`)) return;
        try {
          await ctx.api.library.remove(item.id);
          ctx.toast("Source removed");
          load(searchEl.value.trim());
        } catch (e) {
          ctx.toast(`Could not remove: ${e.message}`, true);
        }
      });
    }
  }

  let searchTimer = null;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(searchEl.value.trim()), 250);
  });

  await load("");
}
