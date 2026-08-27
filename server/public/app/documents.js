/**
 * Documents tab — every essay Tracely has graded, in one place.
 * Sortable list of documents; rows open the analyze tab, each row can be deleted.
 */
import { applyAppearance, emptyState, esc, fmtDate, gradeBand } from "/app/settings.js";

const CSS = `
.documents-tab {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  padding: var(--tab-pad, 32px); gap: var(--tab-gap, 16px);
}
.documents-tab .docs-frame { max-width: 880px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; flex: 1; min-height: 0; gap: var(--tab-gap, 16px); }
.documents-tab .docs-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s-3, 24px); }
.documents-tab h1 { font-family: var(--serif); font-size: var(--fs-2xl, 32px); font-weight: 700; letter-spacing: -.3px; }
.documents-tab .docs-sub { color: var(--ink-dim); margin-top: 4px; font-size: var(--fs-sm, 13.5px); }
.documents-tab .docs-sort { display: flex; align-items: center; gap: var(--s-1, 8px); font-size: var(--fs-sm, 13.5px); color: var(--ink-dim); flex-shrink: 0; }

.documents-tab .docs-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: var(--s-1, 8px);
  padding-bottom: var(--s-3, 24px);
}
.documents-tab .doc-row {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center;
  gap: var(--s-2, 16px);
  padding: 14px var(--s-3, 24px); cursor: pointer;
}
.documents-tab .doc-row:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.documents-tab .doc-row .doc-title {
  font-family: var(--serif); font-size: var(--fs-md, 15px); font-weight: 700;
  min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: color var(--t-fast, 150ms) var(--ease, ease);
}
.documents-tab .doc-row:hover .doc-title { color: var(--accent-deep); }
.documents-tab .doc-row .doc-date {
  font-size: var(--fs-xs, 12.5px); color: var(--ink-faint); white-space: nowrap;
  font-variant-numeric: tabular-nums; text-align: right; min-width: 130px;
}
.documents-tab .doc-row .doc-del {
  opacity: 0; transform: translateX(2px);
  transition: opacity var(--t-fast, 150ms) var(--ease, ease), transform var(--t-fast, 150ms) var(--ease, ease),
              border-color var(--t-fast, 150ms) var(--ease, ease), color var(--t-fast, 150ms) var(--ease, ease);
}
.documents-tab .doc-row:hover .doc-del,
.documents-tab .doc-row:focus-within .doc-del { opacity: 1; transform: none; }
.documents-tab .doc-del:hover { border-color: var(--mark-red); color: var(--mark-red); }
.documents-tab .docs-note { color: var(--ink-faint); padding: var(--s-4, 32px) 0; text-align: center; font-size: var(--fs-sm, 13.5px); }
`;

function ensureStyles() {
  if (document.querySelector('style[data-tab="documents"]')) return;
  const st = document.createElement("style");
  st.dataset.tab = "documents";
  st.textContent = CSS;
  document.head.appendChild(st);
}

const SORTS = [
  { id: "graded", label: "Recently graded" },
  { id: "opened", label: "Recently opened" },
  { id: "title", label: "Title A-Z" },
  { id: "score", label: "Highest score" },
];

function rowDate(doc, sort) {
  if (sort === "opened") return `Opened ${fmtDate(doc.last_opened_at)}`;
  return `Updated ${fmtDate(doc.updated_at ?? doc.created_at)}`;
}

export async function render(mount, ctx) {
  applyAppearance(ctx.settings);
  ensureStyles();

  const root = document.createElement("div");
  root.className = "documents-tab";
  mount.appendChild(root);

  root.innerHTML = `
    <div class="docs-frame">
      <div class="docs-head">
        <div>
          <h1>Documents</h1>
          <div class="docs-sub">Every essay Tracely has graded, in one place.</div>
        </div>
        <label class="docs-sort">Sort
          <select class="input" id="docsSort">
            ${SORTS.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="docs-list" id="docsList"><div class="docs-note">Loading…</div></div>
    </div>
  `;

  const listEl = root.querySelector("#docsList");
  const sortEl = root.querySelector("#docsSort");
  let seq = 0;

  async function load() {
    const my = ++seq;
    const sort = sortEl.value;
    let documents = [];
    try {
      ({ documents } = await ctx.api.documents.list(sort));
    } catch (e) {
      if (my === seq) listEl.innerHTML = `<div class="docs-note">Could not load documents: ${esc(e.message)}</div>`;
      return;
    }
    if (my !== seq || !root.isConnected) return;

    if (documents.length === 0) {
      listEl.innerHTML = emptyState("No documents yet", "Create one from the Home tab and it will land here, graded and ready.");
      return;
    }

    listEl.innerHTML = documents.map((d) => `
      <div class="card doc-row" data-id="${esc(d.id)}">
        <span class="grade-chip" data-band="${gradeBand(d.grade_letter)}">${esc(d.grade_letter ?? "—")}</span>
        <span class="doc-title">${esc(d.title)}</span>
        <span class="doc-date">${rowDate(d, sort)}</span>
        <button class="btn btn-ghost doc-del" title="Delete document">Delete</button>
      </div>
    `).join("");

    for (const row of listEl.querySelectorAll(".doc-row")) {
      const id = row.dataset.id;
      row.addEventListener("click", () => ctx.navigate("analyze", { docId: id }));
      row.querySelector(".doc-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        const title = row.querySelector(".doc-title").textContent;
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
        try {
          await ctx.api.documents.remove(id);
          ctx.toast("Document deleted");
          load();
        } catch (err) {
          ctx.toast(`Could not delete: ${err.message}`, true);
        }
      });
    }
  }

  sortEl.addEventListener("change", load);
  await load();
}
