/**
 * Tracer — the bottom-left writing-tutor dock. Lives in #tracerDock, OUTSIDE
 * #view, so it survives tab navigation. openTracer() opens (or focuses) the
 * panel; closing it collapses to a launcher pill rather than destroying the
 * conversation, so the tutor stays one click away across tabs.
 * All colour flows through the shell's tokens so the dock follows the theme.
 */
import { api } from "/app/api.js";

const STARTER = "What are you working on? Paste a thesis or ask me anything about your draft.";
const PANEL_MS = 200; // must match the .tracer-panel transition below

let built = false;
let conversationId = null;
let currentDocumentId = null;
let currentDraftGetter = null;
let panelEl, launcherEl, listEl, inputEl, sendBtn, formEl;
let collapseTimer = null;
let typingEl = null;

function injectStyles() {
  if (document.querySelector('style[data-tab="tracer"]')) return;
  const style = document.createElement("style");
  style.dataset.tab = "tracer";
  style.textContent = `
.tracer-root { font-family: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
.tracer-root .tracer-panel {
  width: 344px; height: 464px; max-height: calc(100vh - 64px);
  background: var(--bg-raised, #ffffff);
  border: 1px solid var(--line, #eae5dd);
  border-radius: 12px;
  box-shadow: var(--shadow-float, 0 2px 8px #00000014, 0 20px 56px #0000002e);
  display: flex; flex-direction: column; overflow: hidden;
  transform-origin: bottom left;
  opacity: 0; transform: translateY(8px) scale(.96);
  transition: opacity .2s ease, transform .2s ease;
}
.tracer-root .tracer-panel.open { opacity: 1; transform: none; }
.tracer-root .tracer-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line, #eae5dd);
  background: var(--accent-soft, #fff1e6);
  flex-shrink: 0;
}
.tracer-root .tracer-title { font-size: 13.5px; font-weight: 700; color: var(--accent-deep, #ea580c); }
.tracer-root .tracer-close {
  margin-left: auto; border: none; background: transparent; cursor: pointer;
  font-size: 15px; line-height: 1; color: var(--ink-dim, #6f685c);
  padding: 4px 8px; border-radius: 6px;
  transition: color .15s ease, background .15s ease, transform .1s ease;
}
.tracer-root .tracer-close:hover {
  color: var(--ink, #23201a);
  background: color-mix(in srgb, var(--bg-raised, #ffffff) 65%, transparent);
}
.tracer-root .tracer-close:active { transform: translateY(1px); }
.tracer-root .tracer-msgs {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong, #ddd6ca) transparent;
}
.tracer-root .tracer-msgs::-webkit-scrollbar { width: 8px; }
.tracer-root .tracer-msgs::-webkit-scrollbar-track { background: transparent; }
.tracer-root .tracer-msgs::-webkit-scrollbar-thumb {
  background: var(--line-strong, #ddd6ca); border-radius: 8px;
  border: 2px solid transparent; background-clip: padding-box;
}
.tracer-root .tracer-msg {
  white-space: pre-wrap; font-size: 13.5px; line-height: 1.55;
  max-width: 88%; overflow-wrap: break-word;
  animation: tracer-msg-in .22s ease both;
}
.tracer-root .tracer-msg.assistant {
  font-family: var(--serif, Georgia, "Times New Roman", serif);
  color: var(--ink, #23201a);
  background: var(--bg-panel, #fdfbf8);
  border: 1px solid var(--line, #eae5dd);
  border-left: 2px solid var(--accent, #f97316);
  border-radius: 4px 12px 12px 12px;
  padding: 8px 12px;
  align-self: flex-start;
}
.tracer-root .tracer-msg.user {
  background: var(--accent-soft, #fff1e6);
  color: var(--ink, #23201a);
  border-radius: 12px 12px 4px 12px; padding: 8px 12px;
  align-self: flex-end;
}
.tracer-root .tracer-typing {
  display: inline-flex; gap: 4px; align-items: center;
  padding: 10px 12px; align-self: flex-start;
  background: var(--bg-panel, #fdfbf8);
  border: 1px solid var(--line, #eae5dd);
  border-radius: 4px 12px 12px 12px;
  animation: tracer-msg-in .22s ease both;
}
.tracer-root .tracer-typing i {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--ink-faint, #a39a8a);
  animation: tracer-blink 1s ease-in-out infinite;
}
.tracer-root .tracer-typing i:nth-child(2) { animation-delay: .15s; }
.tracer-root .tracer-typing i:nth-child(3) { animation-delay: .3s; }
.tracer-root .tracer-err {
  color: var(--mark-red, #d93636); font-size: 12.5px; align-self: flex-start;
  animation: tracer-msg-in .22s ease both;
}
.tracer-root .tracer-form {
  display: flex; gap: 8px; padding: 12px;
  border-top: 1px solid var(--line, #eae5dd); flex-shrink: 0;
}
.tracer-root .tracer-input {
  flex: 1; min-width: 0;
  border: 1px solid var(--line-strong, #ddd6ca); border-radius: 8px;
  padding: 8px 12px; font: 13.5px inherit; color: var(--ink, #23201a);
  background: var(--bg-raised, #ffffff); outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.tracer-root .tracer-input::placeholder { color: var(--ink-faint, #a39a8a); }
.tracer-root .tracer-input:focus {
  border-color: var(--accent, #f97316);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #f97316) 18%, transparent);
}
.tracer-root .tracer-send {
  border: none; background: var(--accent, #f97316); color: var(--accent-ink, #ffffff);
  border-radius: 8px; padding: 8px 16px; font-size: 13.5px; font-weight: 600; cursor: pointer;
  transition: background .15s ease, transform .1s ease;
}
.tracer-root .tracer-send:hover { background: var(--accent-deep, #ea580c); }
.tracer-root .tracer-send:active:not([disabled]) { transform: translateY(1px); }
.tracer-root .tracer-send[disabled] { opacity: .5; cursor: default; }
.tracer-root .tracer-launcher {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--accent, #f97316);
  background: var(--bg-raised, #ffffff); color: var(--accent-deep, #ea580c);
  border-radius: 999px; padding: 8px 16px;
  font-size: 13.5px; font-weight: 600; cursor: pointer;
  box-shadow: var(--shadow-float, 0 2px 8px #00000014, 0 20px 56px #0000002e);
  transition: background .15s ease, transform .15s ease, box-shadow .15s ease;
}
.tracer-root .tracer-launcher:hover {
  background: var(--accent-soft, #fff1e6);
  transform: translateY(-1px);
}
.tracer-root .tracer-launcher:active { transform: none; }
.tracer-root :is(.tracer-send, .tracer-close, .tracer-launcher):focus-visible {
  outline: 2px solid var(--accent, #f97316); outline-offset: 2px;
}
@keyframes tracer-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes tracer-blink {
  0%, 100% { opacity: .25; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-2px); }
}
@media (prefers-reduced-motion: reduce) {
  .tracer-root .tracer-panel,
  .tracer-root .tracer-close,
  .tracer-root .tracer-send,
  .tracer-root .tracer-launcher { transition: none; }
  .tracer-root .tracer-msg,
  .tracer-root .tracer-err,
  .tracer-root .tracer-typing,
  .tracer-root .tracer-typing i { animation: none; }
}
`;
  document.head.append(style);
}

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = "tracer-msg " + role;
  el.textContent = text;
  listEl.append(el);
  listEl.scrollTop = listEl.scrollHeight;
  return el;
}

function addError(text) {
  const el = document.createElement("div");
  el.className = "tracer-err";
  el.textContent = text;
  listEl.append(el);
  listEl.scrollTop = listEl.scrollHeight;
}

function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "tracer-typing";
  typingEl.setAttribute("role", "status");
  typingEl.setAttribute("aria-label", "Tracer is thinking");
  for (let i = 0; i < 3; i++) typingEl.append(document.createElement("i"));
  listEl.append(typingEl);
  listEl.scrollTop = listEl.scrollHeight;
}

function hideTyping() {
  typingEl?.remove();
  typingEl = null;
}

function showPanel() {
  clearTimeout(collapseTimer);
  launcherEl.classList.add("hidden");
  panelEl.classList.remove("hidden");
  // Reflow so the entrance transition runs from the collapsed state.
  void panelEl.offsetWidth;
  panelEl.classList.add("open");
  inputEl.focus();
  listEl.scrollTop = listEl.scrollHeight;
}

function collapseToLauncher() {
  panelEl.classList.remove("open");
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    panelEl.classList.add("hidden");
    launcherEl.classList.remove("hidden");
  }, PANEL_MS);
}

async function send() {
  const message = inputEl.value.trim();
  if (!message || sendBtn.disabled) return;
  inputEl.value = "";
  addMessage("user", message);
  sendBtn.disabled = true;
  const idle = sendBtn.textContent;
  sendBtn.textContent = "…";
  showTyping();
  try {
    const res = await api.tracer({
      conversationId: conversationId ?? undefined,
      documentId: currentDocumentId ?? undefined,
      message,
      draft: currentDraftGetter?.() ?? "",
    });
    conversationId = res.conversationId ?? conversationId;
    hideTyping();
    addMessage("assistant", res.reply ?? "");
  } catch (e) {
    hideTyping();
    addError(e?.message ?? "Tracer couldn't reply — try again.");
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = idle;
    inputEl.focus();
  }
}

function build(dock) {
  injectStyles();
  dock.classList.add("tracer-root");

  panelEl = document.createElement("div");
  panelEl.className = "tracer-panel";

  const head = document.createElement("div");
  head.className = "tracer-head";
  const title = document.createElement("div");
  title.className = "tracer-title";
  title.textContent = "Tracer — writing tutor";
  const close = document.createElement("button");
  close.className = "tracer-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close Tracer");
  close.addEventListener("click", collapseToLauncher);
  head.append(title, close);

  listEl = document.createElement("div");
  listEl.className = "tracer-msgs";

  formEl = document.createElement("form");
  formEl.className = "tracer-form";
  inputEl = document.createElement("input");
  inputEl.className = "tracer-input";
  inputEl.type = "text";
  inputEl.placeholder = "Ask Tracer…";
  sendBtn = document.createElement("button");
  sendBtn.className = "tracer-send";
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  formEl.append(inputEl, sendBtn);
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });

  panelEl.append(head, listEl, formEl);

  launcherEl = document.createElement("button");
  launcherEl.className = "tracer-launcher hidden";
  launcherEl.textContent = "✎ Tracer";
  launcherEl.setAttribute("aria-label", "Open Tracer");
  launcherEl.addEventListener("click", showPanel);

  dock.append(launcherEl, panelEl);
  addMessage("assistant", STARTER); // client-side, not billed
  built = true;
}

/** Drops the draft getter so a torn-down editor's text (and DOM) is never
    read again — called by analyze's teardown when the editor leaves. */
export function clearTracerDraft() {
  currentDraftGetter = null;
}

/** Opens (or focuses) the tutor dock, bottom-left. */
export function openTracer(documentId, draftGetter) {
  const dock = document.getElementById("tracerDock");
  if (!dock) return;
  if (documentId !== undefined) currentDocumentId = documentId;
  if (typeof draftGetter === "function") currentDraftGetter = draftGetter;
  // A document-less open (the Home launcher) must not keep sending a dead
  // editor's draft to the paid endpoint on every message.
  if (documentId === null) currentDraftGetter = null;
  if (!built) build(dock);
  dock.classList.remove("hidden");
  showPanel();
}

/** Interface-parity stub — Tracer is a dock, not a tab. */
export async function render() {}
