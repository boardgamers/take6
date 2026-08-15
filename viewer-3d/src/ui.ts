import type { GameState, Player } from "take6-engine";
import { getTheme, onThemeChange, toggleThemeOverride } from "./theme";

/**
 * All DOM overlay: player badges, status bar, toasts, end-of-game screen.
 * Styled by injected CSS so the viewer stays a single self-contained package.
 * Colors follow the host `dark` class via CSS variables on the container.
 */

const CSS = `
.t6-root {
  --t6-bg: #f2f5f7;
  --t6-panel: rgba(255,255,255,0.82);
  --t6-panel-border: rgba(0,0,0,0.08);
  --t6-text: #1c2733;
  --t6-text-dim: #5b6b7b;
  --t6-accent: #b3541e;
  --t6-good: #1e8e4e;
  --t6-bad: #c62828;
  --t6-chip: #fff8e1;
  position: absolute; inset: 0; overflow: hidden;
  font-family: "Avenir Next", "Segoe UI", system-ui, -apple-system, sans-serif;
  color: var(--t6-text);
  background: var(--t6-bg);
  touch-action: none;
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
html.dark .t6-root, .t6-root.t6-dark {
  --t6-bg: #10151d;
  --t6-panel: rgba(24,30,40,0.85);
  --t6-panel-border: rgba(255,255,255,0.09);
  --t6-text: #e8eef5;
  --t6-text-dim: #8fa0b3;
  --t6-accent: #f0a35e;
  --t6-good: #4ade80;
  --t6-bad: #f87171;
  --t6-chip: #3a2f14;
}
.t6-root canvas { display: block; position: absolute; inset: 0; }

.t6-topbar {
  position: absolute; top: max(8px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; align-items: center; z-index: 5; pointer-events: none;
}
/* Narrow screens: the centered top bar would collide with the corner player
   badges, which live in the same top band. Drop it below the badge row. */
@media (max-width: 620px) {
  .t6-topbar { top: max(44px, calc(env(safe-area-inset-top) + 36px)); }
}
.t6-round {
  background: var(--t6-panel); border: 1px solid var(--t6-panel-border);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border-radius: 999px; padding: 5px 14px; font-weight: 700; font-size: 13px;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--t6-text-dim);
  box-shadow: 0 2px 10px rgba(0,0,0,0.12);
}
.t6-round b { color: var(--t6-text); }

.t6-myscore {
  display: flex; align-items: center; gap: 6px;
  background: var(--t6-panel); border: 1px solid var(--t6-accent);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border-radius: 999px; padding: 5px 14px; font-weight: 700; font-size: 13px;
  letter-spacing: 0.04em; color: var(--t6-text);
  box-shadow: 0 2px 10px rgba(0,0,0,0.12);
}
.t6-myscore .t6-you { color: var(--t6-text-dim); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; }
.t6-myscore .t6-pts { display: flex; align-items: center; gap: 3px; color: var(--t6-accent); font-variant-numeric: tabular-nums; }
.t6-myscore .t6-pts svg { width: 14px; height: 14px; }

.t6-status {
  position: absolute; bottom: calc(env(safe-area-inset-bottom, 0px) + 10px); left: 50%;
  transform: translateX(-50%); z-index: 5; pointer-events: none;
  background: var(--t6-panel); border: 1px solid var(--t6-panel-border);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  padding: 7px 18px; border-radius: 999px; font-size: 14px; font-weight: 600;
  box-shadow: 0 2px 10px rgba(0,0,0,0.12);
  transition: opacity .25s, transform .25s; white-space: nowrap; max-width: 92vw;
  overflow: hidden; text-overflow: ellipsis;
}
.t6-status.t6-hidden { opacity: 0; transform: translateX(-50%) translateY(8px); }

.t6-players {
  position: absolute; z-index: 5; display: flex; gap: 6px; flex-wrap: wrap;
  max-width: 46vw; pointer-events: none;
}
.t6-players.t6-left { top: max(8px, env(safe-area-inset-top)); left: 8px; flex-direction: column; flex-wrap: nowrap; max-width: 34vw; }
.t6-players.t6-right { top: max(8px, env(safe-area-inset-top)); right: 8px; flex-direction: column; flex-wrap: nowrap; align-items: flex-end; max-width: 34vw; }

.t6-badge {
  display: flex; align-items: center; gap: 6px;
  background: var(--t6-panel); border: 1px solid var(--t6-panel-border);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border-radius: 10px; padding: 4px 8px; font-size: 12px; font-weight: 600;
  box-shadow: 0 1px 6px rgba(0,0,0,0.10); min-width: 0; max-width: 100%;
  transition: box-shadow .2s, border-color .2s;
}
.t6-badge .t6-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1.5px rgba(0,0,0,0.18); }
.t6-badge .t6-pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14ch; }
.t6-badge .t6-pts { color: var(--t6-text-dim); display: flex; align-items: center; gap: 2px; flex: none; font-variant-numeric: tabular-nums; }
.t6-badge .t6-pts svg { width: 11px; height: 11px; }
.t6-badge.t6-active { border-color: var(--t6-accent); box-shadow: 0 0 0 1.5px var(--t6-accent), 0 2px 10px rgba(0,0,0,0.18); }
.t6-badge.t6-me::after { content: ""; }
.t6-badge.t6-clickable { pointer-events: auto; cursor: pointer; }
.t6-badge.t6-clickable:hover { border-color: var(--t6-accent); }
.t6-badge.t6-thinking .t6-dot { animation: t6-pulse 0.9s ease-in-out infinite; }
@keyframes t6-pulse { 50% { opacity: 0.35; transform: scale(0.8); } }

.t6-toasts {
  position: absolute; top: 18%; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 6; pointer-events: none;
}
.t6-toast {
  background: var(--t6-panel); border: 1px solid var(--t6-panel-border);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: var(--t6-text); border-radius: 12px; padding: 8px 20px;
  font-weight: 700; font-size: clamp(15px, 2.6vw, 22px);
  box-shadow: 0 4px 24px rgba(0,0,0,0.25);
  animation: t6-toast-in .35s cubic-bezier(.2,1.4,.4,1) both;
}
.t6-toast.t6-warn { color: var(--t6-bad); }
.t6-toast.t6-out { animation: t6-toast-out .3s ease-in both; }
@keyframes t6-toast-in { from { opacity: 0; transform: scale(.7) translateY(14px); } }
@keyframes t6-toast-out { to { opacity: 0; transform: scale(.85) translateY(-10px); } }

.t6-theme-btn {
  position: absolute; bottom: calc(env(safe-area-inset-bottom, 0px) + 10px); right: 10px; z-index: 7;
  width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--t6-panel-border);
  background: var(--t6-panel); color: var(--t6-text); cursor: pointer;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: transform .15s;
}
.t6-theme-btn:hover { transform: scale(1.08); }
.t6-theme-btn svg { width: 19px; height: 19px; }

.t6-end {
  position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--t6-bg) 55%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  animation: t6-fade-in .5s ease both;
}
@keyframes t6-fade-in { from { opacity: 0; } }
.t6-end-panel {
  background: var(--t6-panel); border: 1px solid var(--t6-panel-border);
  border-radius: 20px; padding: 28px 34px; text-align: center;
  box-shadow: 0 18px 60px rgba(0,0,0,0.35); max-width: min(92vw, 420px);
  animation: t6-toast-in .5s cubic-bezier(.2,1.4,.4,1) both;
}
.t6-end-panel h2 { margin: 0 0 4px; font-size: 26px; }
.t6-end-panel .t6-sub { color: var(--t6-text-dim); font-size: 13px; margin-bottom: 16px; }
.t6-end-row { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 8px; font-weight: 600; }
.t6-end-row .t6-rank { width: 2ch; color: var(--t6-text-dim); font-variant-numeric: tabular-nums; }
.t6-end-row .t6-dot { width: 10px; height: 10px; border-radius: 50%; }
.t6-end-row .t6-nm { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t6-end-row .t6-sc { font-variant-numeric: tabular-nums; color: var(--t6-accent); }
.t6-end-row.t6-winner { background: color-mix(in srgb, var(--t6-accent) 14%, transparent); }
`;

// Points marker: a stylized "6" emblem — original artwork, not the trademarked bull head
const BULL_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="900" font-family="Arial, sans-serif">6</text></svg>`;
const SUN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>`;

const PLAYER_COLORS = [
  "#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa",
  "#fb8c00", "#00acc1", "#d81b60", "#7cb342", "#5e35b1"
];

export function playerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export class UIManager {
  readonly root: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private roundEl!: HTMLDivElement;
  private myScoreEl!: HTMLDivElement;
  private leftPlayers!: HTMLDivElement;
  private rightPlayers!: HTMLDivElement;
  private toastsEl!: HTMLDivElement;
  private endEl: HTMLDivElement | null = null;
  private badges: HTMLDivElement[] = [];
  private styleEl: HTMLStyleElement;
  /** Called when a player badge is clicked (host uses it to open profiles). */
  onPlayerClick: ((index: number) => void) | null = null;

  constructor(parent: HTMLElement, opts: { showThemeToggle: boolean }) {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);

    this.root = document.createElement("div");
    this.root.className = "t6-root";
    parent.appendChild(this.root);
    // Ensure the container actually has a size; the root fills it absolutely.
    const pos = getComputedStyle(parent).position;
    if (pos === "static") {
      parent.style.position = "relative";
    }
    if (!parent.style.width && !parent.style.height && parent.clientHeight === 0) {
      parent.style.width = "100%";
      parent.style.height = "100%";
    }

    this.buildChrome(opts.showThemeToggle);
  }

  private buildChrome(showThemeToggle: boolean) {
    const topbar = document.createElement("div");
    topbar.className = "t6-topbar";
    this.roundEl = document.createElement("div");
    this.roundEl.className = "t6-round";
    topbar.appendChild(this.roundEl);
    this.myScoreEl = document.createElement("div");
    this.myScoreEl.className = "t6-myscore";
    topbar.appendChild(this.myScoreEl);
    this.root.appendChild(topbar);

    this.leftPlayers = document.createElement("div");
    this.leftPlayers.className = "t6-players t6-left";
    this.rightPlayers = document.createElement("div");
    this.rightPlayers.className = "t6-players t6-right";
    this.root.appendChild(this.leftPlayers);
    this.root.appendChild(this.rightPlayers);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "t6-status t6-hidden";
    this.root.appendChild(this.statusEl);

    this.toastsEl = document.createElement("div");
    this.toastsEl.className = "t6-toasts";
    this.root.appendChild(this.toastsEl);

    if (showThemeToggle) {
      const btn = document.createElement("button");
      btn.className = "t6-theme-btn";
      btn.title = "Toggle dark mode";
      const sync = () => {
        btn.innerHTML = getTheme().name === "dark" ? SUN_ICON : MOON_ICON;
      };
      sync();
      btn.addEventListener("click", () => toggleThemeOverride());
      onThemeChange(sync);
      this.root.appendChild(btn);
    }
  }

  setRound(round: number) {
    this.roundEl.innerHTML = `Round <b>${round}</b>`;
  }

  setStatus(text: string | null) {
    if (!text) {
      this.statusEl.classList.add("t6-hidden");
      return;
    }
    this.statusEl.textContent = text;
    this.statusEl.classList.remove("t6-hidden");
  }

  toast(text: string, warn = false, durationMs = 2200) {
    const el = document.createElement("div");
    el.className = "t6-toast" + (warn ? " t6-warn" : "");
    el.textContent = text;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.classList.add("t6-out"), durationMs);
    setTimeout(() => el.remove(), durationMs + 400);
  }

  updatePlayers(G: GameState, meIndex: number | undefined) {
    // Spectators (no "me") don't get a personal score pill.
    this.myScoreEl.style.display = meIndex === undefined ? "none" : "";
    // Rebuild badges if player count changed
    if (this.badges.length !== G.players.length) {
      this.leftPlayers.innerHTML = "";
      this.rightPlayers.innerHTML = "";
      this.badges = [];
      G.players.forEach((pl, i) => {
        if (i === meIndex) {
          this.badges.push(null as unknown as HTMLDivElement);
          return; // main player doesn't get a corner badge
        }
        const badge = document.createElement("div");
        badge.className = "t6-badge t6-clickable";
        badge.addEventListener("click", () => this.onPlayerClick?.(i));
        this.badges[i] = badge;
        // Split players between left and right columns
        const side = i % 2 === 0 ? this.leftPlayers : this.rightPlayers;
        side.appendChild(badge);
      });
    }

    G.players.forEach((pl, i) => {
      if (i === meIndex) {
        // Our own score lives in the top bar, always visible.
        this.myScoreEl.innerHTML = `<span class="t6-you">You</span><span class="t6-pts">${BULL_ICON}${pl.points}</span>`;
        return;
      }
      const badge = this.badges[i];
      if (!badge) {
        return;
      }
      const active = !!pl.availableMoves;
      const thinking = active && pl.isAI;
      badge.classList.toggle("t6-active", active);
      badge.classList.toggle("t6-thinking", thinking);
      badge.innerHTML = `
        <span class="t6-dot" style="background:${playerColor(i)}"></span>
        <span class="t6-pname">${escapeHtml(pl.name ?? `Player ${i + 1}`)}</span>
        <span class="t6-pts">${BULL_ICON}${pl.points}</span>
      `;
    });

    this.setRound(G.round);
  }

  showEndScreen(G: GameState, meIndex: number | undefined) {
    this.hideEndScreen();
    const el = document.createElement("div");
    el.className = "t6-end";

    const order = G.players
      .map((pl, i) => ({ pl, i }))
      .sort((a, b) => a.pl.points - b.pl.points);
    const winner = order[0];
    const meWon = meIndex !== undefined && winner.i === meIndex;

    const rows = order
      .map(({ pl, i }, rank) => {
        const name = escapeHtml(pl.name ?? `Player ${i + 1}`) + (i === meIndex ? " (you)" : "");
        return `<div class="t6-end-row${rank === 0 ? " t6-winner" : ""}">
          <span class="t6-rank">${rank + 1}</span>
          <span class="t6-dot" style="background:${playerColor(i)}"></span>
          <span class="t6-nm">${name}</span>
          <span class="t6-sc">${pl.points} pts</span>
        </div>`;
      })
      .join("");

    el.innerHTML = `<div class="t6-end-panel">
      <h2>${meWon ? "🎉 You win!" : `${escapeHtml(winner.pl.name ?? `Player ${winner.i + 1}`)} wins!`}</h2>
      <div class="t6-sub">Fewest points wins — final scores</div>
      ${rows}
    </div>`;
    this.root.appendChild(el);
    this.endEl = el;
  }

  hideEndScreen() {
    this.endEl?.remove();
    this.endEl = null;
  }

  dispose() {
    this.root.remove();
    this.styleEl.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
