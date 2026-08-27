/**
 * The grade report — ONE component for every surface (analyze tab, documents
 * tab, and later the Docs widget). INLINE STYLES ONLY, deliberately: the spec
 * requires a form that works in a window with no stylesheet, so nothing here
 * may lean on style.css. Theming: ONE palette object below with light and dark
 * variants that mirror the shell's tokens; the variant is chosen at render
 * time from html[data-theme] (light when absent). Flag colours come from
 * shared/marks.js COLORS — the three colours plus grey, never anything else —
 * with dark-tuned equivalents keyed by the same names.
 */
import { COLORS, kindInfo } from "/shared/marks.js";
import { RUBRIC, FLAG_CLAUSES, GRADE_COMPONENTS } from "/shared/rubric.js";

const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/** Light and dark variants of the shell palette — the single source for every
    inline colour in this file. */
const PALETTE = {
  light: {
    surface: "#ffffff",
    panel: "#fdfbf8",
    line: "#eae5dd",
    lineStrong: "#ddd6ca",
    ink: "#23201a",
    inkDim: "#6f685c",
    inkFaint: "#a39a8a",
    accent: "#f97316",
    accentDeep: "#ea580c",
    accentSoft: "#fff1e6",
    accentEdge: "#fbd6b5",
    track: "#f1ece4",
    backdrop: "#00000038",
    shadow: "0 1px 2px #0000001a, 0 20px 70px #00000040",
    marks: COLORS,
  },
  dark: {
    surface: "#1e1a15",
    panel: "#1a1712",
    line: "#2c2721",
    lineStrong: "#3a342b",
    ink: "#ece7dc",
    inkDim: "#a89f8f",
    inkFaint: "#6e675c",
    accent: "#fb8c3c",
    accentDeep: "#f97316",
    accentSoft: "#2a2018",
    accentEdge: "#453425",
    track: "#2c2721",
    backdrop: "#00000073",
    shadow: "0 1px 2px #00000040, 0 24px 80px #00000066",
    marks: { red: "#ff5f52", amber: "#ffc233", orange: "#ff7433", grey: "#8a8b90" },
  },
};

function palette() {
  return document.documentElement.dataset.theme === "dark" ? PALETTE.dark : PALETTE.light;
}

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function el(tag, style = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  for (const c of [].concat(children)) node.append(c);
  return node;
}

function truncate(s, n = 140) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n - 1).trimEnd() + "…" : str;
}

let closeCurrent = null;

/** Renders the grade report modal into #modalRoot. */
export function showReport({ grade = {}, flags = [], meta = {} } = {}) {
  const root = document.getElementById("modalRoot");
  if (!root) return;
  if (closeCurrent) closeCurrent();

  const P = palette();
  const components = grade.components ?? {};
  const bars = []; // { node, pct } — widths animate in on mount
  const reveals = []; // rows that fade-slide in with an 80ms stagger

  function stagger(node) {
    node.style.opacity = "0";
    node.style.transform = "translateY(6px)";
    node.style.transition = "opacity .25s ease, transform .25s ease";
    node.style.transitionDelay = Math.min(reveals.length, 8) * 80 + "ms";
    reveals.push(node);
  }

  // ── header: big serif letter in an accent-tinted circle ──
  const letter = el("div", {
    fontFamily: SERIF, fontSize: "32px", fontWeight: "700", lineHeight: "1",
    color: P.accentDeep, width: "72px", height: "72px", flexShrink: "0",
    background: P.accentSoft, border: "1px solid " + P.accentEdge,
    borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
  }, String(grade.letter ?? "—"));
  const title = el("div", {
    fontFamily: SERIF, fontSize: "18px", fontWeight: "700", lineHeight: "1.25", color: P.ink,
  }, String(meta.title ?? "Untitled"));
  const words = el("div", {
    fontFamily: SANS, fontSize: "12.5px", color: P.inkFaint, marginTop: "4px",
  }, String(meta.words ?? 0) + " words");
  const header = el("div", {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "24px 24px 16px", borderBottom: "1px solid " + P.line,
  }, [letter, el("div", { minWidth: "0" }, [title, words])]);

  // ── the arithmetic — a clean mono strip a student can trace ──
  const arithmetic = el("div", {
    fontFamily: MONO, fontSize: "13.5px", color: P.ink, whiteSpace: "pre-wrap",
    lineHeight: "1.5", letterSpacing: "0.2px",
    background: P.panel, border: "1px solid " + P.line, borderRadius: "8px",
    padding: "12px 16px", margin: "16px 24px 0",
  }, [
    "Rubric " + grade.rubricScore + "  +  Level credit " + grade.credit + "  =  ",
    el("span", { color: P.accentDeep, fontWeight: "700" },
      grade.total + "/100 → " + grade.letter),
  ]);

  // ── component rows — built-in in GRADE_COMPONENTS order, or a pasted
  // rubric's own components (grade.custom) in the rubric's order. Custom
  // rows have no key, which skips the two built-in special cases below. ──
  const rows = el("div", { padding: "8px 24px 8px" });
  const rowDefs = grade.custom && Array.isArray(components)
    ? components.map((c) => ({ key: null, def: { title: c.title, points: c.points }, c }))
    : GRADE_COMPONENTS.map((key) => ({ key, def: RUBRIC[key], c: components[key] ?? null }));
  for (const { key, def, c } of rowDefs) {
    const row = el("div", { padding: "16px 0", borderBottom: "1px solid " + P.line });
    stagger(row);

    const titleEl = el("div", { fontFamily: SANS, fontSize: "13.5px", fontWeight: "600", color: P.ink }, def.title);
    const head = el("div", { display: "flex", alignItems: "baseline", gap: "8px" }, [titleEl]);

    const absent = key === "counterargument" && Boolean(c?.absent);
    if (absent) {
      row.append(head, el("div", {
        fontFamily: SANS, fontSize: "12.5px", color: P.inkDim, marginTop: "8px", fontStyle: "italic",
      }, "Not required — no counterargument in this draft (leaves the denominator)"));
      rows.append(row);
      continue;
    }

    const score = Math.max(0, Math.min(def.points, Number(c?.score ?? 0)));
    head.append(el("div", {
      marginLeft: "auto", fontFamily: MONO, fontSize: "12.5px", color: P.inkDim,
    }, score + "/" + def.points));

    const pct = def.points > 0 ? Math.round((score / def.points) * 100) : 0;
    const fill = el("div", {
      width: "0%", height: "100%", background: P.accent, borderRadius: "999px",
      transition: "width .6s cubic-bezier(.22, 1, .36, 1)",
    });
    bars.push({ node: fill, pct });
    const bar = el("div", {
      height: "6px", background: P.track, borderRadius: "999px", overflow: "hidden", marginTop: "8px",
    }, fill);
    row.append(head, bar);

    if (key === "governingClaims" && c && c.paragraphsGoverning != null && c.bodyParagraphs != null) {
      row.append(el("div", {
        fontFamily: MONO, fontSize: "12.5px", color: P.inkDim, marginTop: "8px",
      }, c.paragraphsGoverning + "/" + c.bodyParagraphs + " body paragraphs govern a claim"));
    }

    if (c?.note) {
      row.append(el("div", {
        fontFamily: SANS, fontSize: "12.5px", color: P.inkDim, marginTop: "8px", lineHeight: "1.55",
      }, String(c.note)));
    }
    if (c?.quote) {
      row.append(el("div", {
        fontFamily: SERIF, fontStyle: "italic", fontSize: "13.5px", color: P.ink, lineHeight: "1.6",
        borderLeft: "1px solid " + P.accent, paddingLeft: "12px", marginTop: "8px",
      }, "“" + String(c.quote) + "”"));
    }
    rows.append(row);
  }

  // ── credibility flags ──
  const flagsWrap = el("div", { padding: "16px 24px 24px" });
  flagsWrap.append(el("div", {
    fontFamily: SANS, fontSize: "10px", fontWeight: "700", textTransform: "uppercase",
    letterSpacing: "1.2px", color: P.inkFaint, marginBottom: "8px",
  }, "Credibility flags"));

  const list = Array.isArray(flags) ? flags : [];
  if (list.length === 0) {
    const empty = el("div", {
      fontFamily: SANS, fontSize: "13.5px", color: P.inkDim,
      background: P.panel, border: "1px solid " + P.line, borderRadius: "8px",
      padding: "12px 16px",
    }, "No credibility flags on this draft.");
    stagger(empty);
    flagsWrap.append(empty);
  } else {
    for (const flag of list) {
      const info = kindInfo(flag.kind);
      const hex = P.marks[info?.color] ?? P.marks.grey;
      const dot = el("span", {
        display: "inline-block", width: "10px", height: "10px", borderRadius: "50%",
        background: hex, boxShadow: "0 0 0 3px " + hex + "26", flexShrink: "0", marginTop: "4px",
      });
      const label = el("div", { fontFamily: SANS, fontSize: "13.5px", fontWeight: "600", color: P.ink },
        info?.label ?? String(flag.kind ?? "Flag"));
      const sentence = el("div", {
        fontFamily: SERIF, fontStyle: "italic", fontSize: "12.5px", color: P.inkDim,
        marginTop: "4px", lineHeight: "1.55",
      }, truncate(flag.sentence ?? flag.text ?? "", 140));
      const body = el("div", { minWidth: "0" }, [label, sentence]);
      const clause = FLAG_CLAUSES[flag.kind]?.clause;
      if (clause) {
        body.append(el("div", {
          fontFamily: SANS, fontSize: "12.5px", fontVariant: "all-small-caps",
          letterSpacing: "0.4px", color: P.inkFaint, marginTop: "4px",
        }, "Rubric · " + clause));
      }
      const item = el("div", {
        display: "flex", gap: "12px", padding: "8px 0", alignItems: "flex-start",
      }, [dot, body]);
      stagger(item);
      flagsWrap.append(item);
    }
  }

  // ── modal chrome ──
  const closeBtn = el("button", {
    marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer",
    fontFamily: SANS, fontSize: "18px", lineHeight: "1", color: P.inkFaint,
    padding: "4px 8px", borderRadius: "8px", alignSelf: "flex-start",
    transition: "color .15s ease, background .15s ease",
  }, "✕");
  closeBtn.setAttribute("aria-label", "Close report");
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.color = P.ink;
    closeBtn.style.background = P.panel;
  });
  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.color = P.inkFaint;
    closeBtn.style.background = "transparent";
  });
  closeBtn.addEventListener("focus", () => {
    if (closeBtn.matches(":focus-visible")) {
      closeBtn.style.outline = "2px solid " + P.accent;
      closeBtn.style.outlineOffset = "2px";
    }
  });
  closeBtn.addEventListener("blur", () => {
    closeBtn.style.outline = "none";
  });

  const modal = el("div", {
    background: P.surface, borderRadius: "14px", boxShadow: P.shadow,
    border: "1px solid " + P.line,
    maxWidth: "680px", width: "calc(100vw - 60px)", maxHeight: "84vh", overflowY: "auto",
    color: P.ink, fontFamily: SANS, position: "relative",
    transform: "translateY(8px) scale(.98)",
    transition: "transform .2s ease",
  }, [header, arithmetic, rows, flagsWrap]);
  header.append(closeBtn);
  if (grade.custom) {
    // Name which rubric produced the number — a grade that silently switched
    // rubrics reads as Tracely disagreeing with itself.
    arithmetic.after(el("div", {
      fontFamily: SANS, fontSize: "12.5px", color: P.inkFaint, margin: "8px 24px 0",
    }, "Graded against your pasted rubric (Settings → Custom rubric)."));
  }

  const backdrop = el("div", {
    position: "fixed", inset: "0", background: P.backdrop, zIndex: "80",
    display: "flex", alignItems: "center", justifyContent: "center",
    opacity: "0", transition: "opacity .2s ease",
  }, modal);
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  function close() {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    closeCurrent = null;
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  closeCurrent = close;

  root.append(backdrop);
  closeBtn.focus();

  // ── mount animation: fade the backdrop, lift the sheet, slide the rows in,
  //    then let the score bars grow. Synchronous (thus animation-free) when
  //    the user prefers reduced motion. ──
  const settle = () => {
    backdrop.style.opacity = "1";
    modal.style.transform = "none";
    for (const node of reveals) {
      node.style.opacity = "1";
      node.style.transform = "none";
    }
    for (const b of bars) b.node.style.width = b.pct + "%";
  };
  if (reducedMotion()) settle();
  else requestAnimationFrame(() => requestAnimationFrame(settle));
}
