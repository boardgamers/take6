import * as THREE from "three";
import { EventEmitter } from "events";
import { cloneDeep } from "lodash";
import type { AvailableMoves, Card, GameState, LogItem, Move } from "take6-engine";
import { ended, GameEventName, MoveName, Phase, reconstructState } from "take6-engine";
import { Easing, Spring, cancelTweensOf, delay, isViewAnimating, tweenView, tweenViewAsync, updateTweens } from "./anim";
import { advance } from "./anim-controls";
import { animLog } from "./anim-log";
import { CARD_H, CARD_T, CARD_W, CardView, refreshCardTextures } from "./cards";
import { logToText } from "./log-text";
import { SceneManager, boardSlot, handSlot, handY, pickSlot, BOARD_COLS, BOARD_ROWS, HAND_LIFT_Y as HAND_LIFT } from "./scene";
import { getTheme, onThemeChange } from "./theme";
import { UIManager } from "./ui";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface GameControllerOptions {
  emitter: EventEmitter;
  /** Standalone mode shows the theme toggle button. */
  standalone?: boolean;
}

type Zone =
  | { kind: "hand"; index: number }
  | { kind: "board"; row: number; col: number }
  | { kind: "pick"; player: number }
  | { kind: "stage"; player: number }
  | { kind: "taken"; player: number; index: number }
  | { kind: "offscreen" };

interface CardEntry {
  view: CardView;
  zone: Zone;
}

/** Extra height while dragging — clears the whole fan stack. */
const DRAG_LIFT = 4.2;

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

export class GameController {
  private sceneMgr: SceneManager;
  private ui: UIManager;
  private emitter: EventEmitter;

  private G: GameState | null = null;
  private futureG: GameState | null = null; // for replay
  private me: number | undefined = undefined;
  private replaying = false;
  private logQueue: LogItem[] = [];
  private applying = false;
  /**
   * Number of log items ACCEPTED so far (applied + still queued). Incoming
   * logs are deduped against this watermark, NOT against `G.log.length`:
   * items queued in `logQueue` but not yet applied (mid-animation) would
   * otherwise be re-accepted when a full `start: 0` redelivery arrives.
   */
  private acceptedLog = 0;

  private cards = new Map<number, CardEntry>();
  /**
   * Hidden (face-down, number 0) picks, tracked per player. stripSecret logs
   * every hidden opponent ChooseCard as `{number: 0, points: 0}`, so keying
   * `cards` by card number cannot disambiguate them — keying by player can.
   * The entry ALSO sits in `cards` under its current map key; the entry is
   * removed from both maps when it is discarded. Invariant: at any time at
   * most ONE entry per player lives in this map, and it is resolved to its
   * real card number exactly once (in applyReveal / applyPlace).
   */
  private hiddenPicks = new Map<number, CardEntry>();
  private drag: {
    entry: CardEntry;
    pointerId: number;
    offsetX: number;
    offsetZ: number;
    target: THREE.Vector3;
    springX: Spring;
    springZ: Spring;
    moved: boolean;
    startClient: { x: number; y: number };
    hoveredRow: number | null;
  } | null = null;

  private clock = new THREE.Clock();
  private disposed = false;
  private portraitBias = 0;
  private unsubTheme: (() => void) | null = null;

  constructor(container: HTMLElement, options: GameControllerOptions) {
    this.emitter = options.emitter;
    this.ui = new UIManager(container, { showThemeToggle: !!options.standalone });
    this.ui.onPlayerClick = (index) => {
      const name = this.G?.players[index]?.name ?? `Player ${index + 1}`;
      this.emitter.emit("player:clicked", { index, name });
    };
    this.sceneMgr = new SceneManager(this.ui.root);

    this.unsubTheme = onThemeChange(() => {
      refreshCardTextures([...this.cards.values()].map((c) => c.view));
    });

    this.bindEmitter();
    this.bindInput();

    window.addEventListener("resize", this.onResize);
    this.onResize();
    this.renderer_loop();

    // Testing / debugging hook
    (window as any).__take6ctrl = this;
  }

  /* --------------------------- wiring ---------------------------- */

  private bindEmitter() {
    this.emitter.on("state", (G: GameState) => this.onFullState(G));
    this.emitter.on("player", ({ index }: { index: number }) => {
      this.me = index;
      if (this.G) {
        this.syncAll(false);
      }
    });
    this.emitter.on("addLog", (data: { start: number; log: LogItem[]; availableMoves?: AvailableMoves[] }) => {
      this.applyLog(data);
    });
    this.emitter.on("replayStart", () => {
      this.replaying = true;
      this.futureG = this.G ? cloneDeep(this.G) : null;
      if (this.futureG) {
        this.emitter.emit("replay:info", { start: 1, current: this.G!.log.length, end: this.futureG.log.length });
      }
    });
    this.emitter.on("replayTo", (to: number) => {
      void this.replayTo(to);
    });
    this.emitter.on("replayEnd", () => {
      this.replaying = false;
      this.futureG = null;
      this.emitter.emit("fetchState");
    });
  }

  private onResize = () => {
    this.sceneMgr.resize();
    const w = this.ui.root.clientWidth || 1;
    const h = this.ui.root.clientHeight || 1;
    const aspect = w / h;
    this.portraitBias = THREE.MathUtils.clamp((1.25 - aspect) / 0.75, 0, 1);
  };

  /* --------------------------- state intake ---------------------------- */

  private onFullState(G: GameState) {
    if (this.replaying) {
      this.futureG = cloneDeep(G);
      return;
    }
    this.G = cloneDeep(G);
    this.logQueue = [];
    this.acceptedLog = this.G.log.length;
    this.syncAll(true);
    // Host sidebar: full refresh of the textual log
    this.emitter.emit("replaceLog", this.G.log.map((item) => logToText(this.G!, item, this.me)).flat());
  }

  /** Rebuild the whole scene from the current state (initial load / resync). */
  private syncAll(animated: boolean) {
    if (!this.G) {
      return;
    }
    this.ui.hideEndScreen();
    this.ui.updatePlayers(this.G, this.me);
    this.rebuildCards(animated);
    this.updateStatus();
    this.emitter.emit("ready");
  }

  private rebuildCards(animated: boolean) {
    const G = this.G!;
    // Drop card views that no longer exist
    const alive = new Set<number>();
    const keep = (card: Card | null | undefined) => card && alive.add(card.number);
    for (const row of G.rows) {
      row.forEach(keep);
    }
    for (const pl of G.players) {
      pl.hand.forEach(keep);
      keep(pl.faceDownCard);
    }
    for (const [num, entry] of this.cards) {
      if (!alive.has(num)) {
        this.sceneMgr.scene.remove(entry.view.group);
        entry.view.dispose();
        this.cards.delete(num);
      }
    }
    // The card map was rebuilt from scratch; hidden picks are re-derived below.
    this.hiddenPicks.clear();

    const spawn = (card: Card, zone: Zone, faceUp: boolean): CardEntry => {
      let entry = this.cards.get(card.number);
      if (!entry) {
        const view = new CardView(card);
        view.anim.flip = faceUp ? 0 : Math.PI;
        view.anim.y = CARD_T;
        entry = { view, zone };
        this.cards.set(card.number, entry);
        this.sceneMgr.scene.add(view.group);
        if (animated) {
          view.anim.scale = 0.01;
          view.anim.y = 12;
        }
      } else {
        entry.zone = zone;
        if (entry.view.number === 0 && card.number !== 0) {
          entry.view.setCard(card);
        }
      }
      return entry;
    };

    // Board rows
    G.rows.forEach((row, r) => {
      row.forEach((card, c) => {
        const entry = spawn(card, { kind: "board", row: r, col: c }, true);
        const pos = boardSlot(r, c);
        this.flyTo(entry, pos.x, pos.z, 0, { faceUp: true, y: CARD_T, animated, zIndex: c, preserveFlip: true });
      });
    });

    // Hands
    G.players.forEach((pl, p) => {
      if (p === this.me) {
        pl.hand.forEach((card, i) => {
          const entry = spawn(card, { kind: "hand", index: i }, true);
          const pos = handSlot(i, pl.hand.length);
          this.flyTo(entry, pos.x, pos.z, pos.rotZ, { faceUp: true, y: handY(i), animated, zIndex: 100 + i });
        });
      } else {
        // Opponent hands are hidden: one shared face-down placeholder per
        // player (keyed by synthetic negative id, like applyRoundStart).
        const key = -(p * 1000 + 1);
        let entry = this.cards.get(key);
        if (!entry) {
          const view = new CardView({ number: 0, points: 0 });
          entry = { view, zone: { kind: "offscreen" } };
          this.cards.set(key, entry);
          this.sceneMgr.scene.add(view.group);
        } else {
          entry.zone = { kind: "offscreen" };
        }
        this.flyTo(entry, 0, -80 - p * 4, 0, { faceUp: false, y: CARD_T, animated: false, scale: 0.01 });
      }
      if (pl.faceDownCard) {
        const faceUp = G.phase === Phase.PlaceCard && pl.faceDownCard.number !== 0;
        const entry = spawn(pl.faceDownCard, { kind: "pick", player: p }, faceUp);
        const pos = pickSlot(p, G.players.length);
        this.flyTo(entry, pos.x, pos.z, pos.rotZ, { faceUp, y: CARD_T, animated, zIndex: 40 + p, preserveFlip: true });
        if (entry.view.card.number === 0) {
          this.hiddenPicks.set(p, entry);
        }
      } else {
        // No pick staged: drop any leftover placeholder for this player (a
        // just-placed pick still keyed under its synthetic hidden id).
        for (const key of [-(p * 1000 + 500), -(p * 1000 + 990)]) {
          const stale = this.cards.get(key);
          if (stale && stale.zone.kind === "pick") {
            this.sceneMgr.scene.remove(stale.view.group);
            stale.view.dispose();
            this.cards.delete(key);
          }
        }
      }
    });

    this.updateContentBounds();
  }

  private updateContentBounds() {
    // Frame the content: board rows + the player's hand fan.
    this.sceneMgr.setContentBounds(31, 33);
  }

  /* --------------------------- log application ---------------------------- */

  private applyLog(data: { start: number; log: LogItem[]; availableMoves?: AvailableMoves[] }) {
    if (!this.G || !data || !Array.isArray(data.log)) {
      return;
    }
    // Ignore stale / duplicate logs
    const fresh = data.log.slice(Math.max(0, this.acceptedLog - data.start));
    if (fresh.length === 0 && !data.availableMoves) {
      return;
    }
    this.acceptedLog += fresh.length;
    this.logQueue.push(...fresh);
    if (data.availableMoves) {
      this.pendingAvailableMoves = data.availableMoves;
    }
    // Never nest applyLoop calls: emitting "uplink:addLog" from inside applyLoop
    // can synchronously re-enter applyLog (host may immediately answer with a new
    // gamelog). If a batch arrives mid-animation, the running loop picks it up.
    if (this.applying) {
      return;
    }
    this.applying = true;
    void this.applyLoop().finally(() => {
      this.applying = false;
    });
  }

  private async applyLoop() {
    try {
      while (this.logQueue.length > 0) {
        const item = this.logQueue.shift()!;
        await this.applyLogItem(item);
        if (this.G) {
          this.G.log.push(item);
          this.emitter.emit("uplink:addLog", logToText(this.G, item, this.me));
        }
      }
      this.finishLogApplication();
    } catch (err) {
      console.error("take6-3d: error while applying log", err);
    }
  }

  private pendingAvailableMoves: AvailableMoves[] | null = null;

  private finishLogApplication() {
    if (!this.G) {
      return;
    }
    this.pruneStaleCards();
    if (this.pendingAvailableMoves) {
      this.G.players.forEach((pl, i) => {
        pl.availableMoves = this.pendingAvailableMoves![i] ?? null;
      });
      this.pendingAvailableMoves = null;
    }
    this.ui.updatePlayers(this.G, this.me);
    this.updateStatus();
    this.emitter.emit("state:updated");
    this.checkEnd();
  }

  private async applyLogItem(item: LogItem) {
    if (!this.G) {
      return;
    }
    switch (item.type) {
      case "phase":
        // Cosmetic only; status text updated at the end of the batch.
        return;
      case "event":
        switch (item.event.name) {
          case GameEventName.GameStart:
            this.ui.toast("Game started!");
            return;
          case GameEventName.GameEnd:
            return; // handled once final scores are visible
          case GameEventName.RoundStart: {
            await this.applyRoundStart(item.event.cards.players.map((cards) => cards), item.event.cards.board, item.event.round);
            return;
          }
          case GameEventName.RevealCards:
            await this.applyReveal(item.event.cards);
            return;
        }
        return;
      case "move":
        switch (item.move.name) {
          case MoveName.ChooseCard:
            await this.applyChoose(item.player, item.move.data);
            return;
          case MoveName.PlaceCard:
            await this.applyPlace(item.player, item.move.data.row, item.move.data.replace);
            return;
        }
    }
  }

  /* --------------------------- move animations ---------------------------- */

  private async applyRoundStart(playerHands: Card[][], board: Card[], round: number) {
    const G = this.G!;
    animLog.call("applyRoundStart", `round=${round} board=[${board.map((c) => c.number)}]`);
    G.round = round;
    // Reset the mirror's rows to the new starters. Without this G.rows keeps
    // last round's cards, and pruneStaleCards (which builds its alive-set from
    // G.rows) deletes the freshly dropped starters as "stale".
    G.rows = board.map((card) => [card]) as GameState["rows"];
    this.ui.setRound(round);
    this.ui.toast(`Round ${round}`);
    this.ui.hideEndScreen();

    // Existing table cards (taken rows etc.) fly away
    const gone: Promise<void>[] = [];
    for (const [num, entry] of this.cards) {
      if (entry.zone.kind === "board" || entry.zone.kind === "taken") {
        gone.push(this.flyAway(entry));
        this.cards.delete(num);
      }
    }
    await Promise.all(gone);

    // New row starters drop in with a bounce
    const drops: Promise<void>[] = [];
    board.forEach((card, r) => {
      const view = new CardView(card);
      view.anim.y = 14;
      view.anim.flip = Math.PI;
      const pos = boardSlot(r, 0);
      view.anim.x = pos.x;
      view.anim.z = pos.z;
      this.sceneMgr.scene.add(view.group);
      const entry: CardEntry = { view, zone: { kind: "board", row: r, col: 0 } };
      this.cards.set(card.number, entry);
      drops.push(
        (async () => {
          await tweenViewAsync(view, {
            duration: 0.5,
            delay: r * 0.09,
            easing: Easing.bounceOut,
            onUpdate: (t) => {
              view.anim.y = THREE.MathUtils.lerp(14, CARD_T, t);
              view.anim.flip = Math.PI * (1 - t);
              view.applyAnim();
            }
          });
        })()
      );
    });
    await Promise.all(drops);

    // Deal hands
    const deals: Promise<void>[] = [];
    playerHands.forEach((hand, p) => {
      const pl = G.players[p];
      pl.hand = hand;
      hand.forEach((card, i) => {
        if (p === this.me) {
          const view = new CardView(card);
          view.anim.flip = Math.PI;
          view.anim.y = CARD_T;
          const pos = handSlot(i, hand.length);
          // Deal from the deck corner
          view.anim.x = 34;
          view.anim.z = 24;
          view.anim.scale = 0.6;
          this.sceneMgr.scene.add(view.group);
          this.cards.set(card.number, { view, zone: { kind: "hand", index: i } });
          deals.push(
            (async () => {
              await delay(0.15 + i * 0.07);
              await tweenViewAsync(view, {
                duration: 0.55,
                easing: Easing.easeOutCubic,
                onUpdate: (t) => {
                  view.anim.x = THREE.MathUtils.lerp(34, pos.x, t);
                  view.anim.z = THREE.MathUtils.lerp(24, pos.z, t);
                  view.anim.y = THREE.MathUtils.lerp(CARD_T, handY(i), t) + Math.sin(t * Math.PI) * 6;
                  view.anim.rotZ = pos.rotZ * t;
                  view.anim.flip = Math.PI * (1 - t);
                  view.anim.scale = THREE.MathUtils.lerp(0.6, 1, t);
                  view.applyAnim();
                }
              });
              view.zIndex = 100 + i;
              view.applyAnim();
            })()
          );
        } else {
          // Opponent hands stay hidden offscreen. Park them far behind the
          // table (z=-80), not just low — a stand-in at the table origin (x=0,
          // z=0) is what shows up as the stray card in the middle of the board.
          const view = new CardView(card.number === 0 ? card : { number: 0, points: 0 });
          view.anim.x = 0;
          view.anim.z = -80 - p * 4;
          view.anim.y = -100;
          view.anim.scale = 0.01;
          // The constructor's applyAnim ran while anim was still at the origin;
          // re-apply so the card actually moves offscreen.
          view.applyAnim();
          this.sceneMgr.scene.add(view.group);
          this.cards.set(card.number || -(p * 1000 + i + 1), { view, zone: { kind: "offscreen" } });
        }
      });
    });
    await Promise.all(deals);
    this.updateContentBounds();
  }

  private async applyReveal(cards: Card[]) {
    const G = this.G!;
    animLog.call("applyReveal", `cards=[${cards.map((c) => c.number)}]`);
    const flips: Promise<void>[] = [];
    const nPlayers = G.players.length;
    cards.forEach((card, p) => {
      // A 0-numbered reveal slot means that player's pick is still hidden to
      // us (pro/privacy rules) OR the pick was already revealed — the entry
      // may already sit at its real number. Try the player's hidden pick
      // first, then fall back to any pick entry we already track for them.
      let entry: CardEntry | undefined;
      let resolvedFrom: "hidden" | "known" | "materialized" = "hidden";

      if (card.number !== 0) {
        entry = this.cards.get(card.number);
      }
      if (!entry) {
        entry = this.hiddenPicks.get(p);
        if (entry) {
          this.hiddenPicks.delete(p);
          // Remove the entry's CURRENT map key (a synthetic negative key for a
          // hidden pick) — deleting by entry.view.number would be a no-op
          // (it's 0) and leave a stale duplicate frozen on the table.
          for (const [key, e] of this.cards) {
            if (e === entry) {
              this.cards.delete(key);
            }
          }
          if (card.number !== 0) {
            this.cards.set(card.number, entry);
            entry.view.setCard(card);
            // Keep the mirror authoritative: applyPlace reads faceDownCard.
            G.players[p].faceDownCard = card;
          } else {
            // Unresolved for us (pick still secret): re-key under the
            // synthetic slot so applyPlace can find it.
            this.cards.set(-(p * 1000 + 500), entry);
          }
          resolvedFrom = "hidden";
        }
      }
      if (!entry) {
        // Last resort: materialize at the pick slot. The card is ALWAYS
        // real (known) at this point — a 0 number means we lost track of the
        // pick entirely, so materialize a face-down placeholder.
        const realCard = card.number !== 0 ? card : { number: 0, points: 0 };
        const view = new CardView(realCard);
        const pos = pickSlot(p, nPlayers);
        view.anim.x = pos.x;
        view.anim.z = pos.z;
        view.anim.y = CARD_T;
        view.anim.flip = Math.PI;
        this.sceneMgr.scene.add(view.group);
        entry = { view, zone: { kind: "pick", player: p } };
        this.cards.set(card.number !== 0 ? card.number : -(p * 1000 + 500), entry);
        resolvedFrom = "materialized";
      }
      entry.zone = { kind: "pick", player: p };
      const view = entry.view;
      const pos = pickSlot(p, nPlayers);
      view.zIndex = 40 + p;
      // Only flip face-up when we actually know the card. A card that already
      // reads face-up must never be sent back face-down by this tween.
      const targetFlip = card.number !== 0 || resolvedFrom === "materialized" ? 0 : Math.PI;
      const startFlip = targetFlip === 0 ? view.anim.flip : Math.max(view.anim.flip, Math.PI);
      const startY = view.anim.y;
      const startScale = view.anim.scale;
      flips.push(
        (async () => {
          await delay(p * 0.05);
          await tweenViewAsync(view, {
            duration: 0.55,
            easing: Easing.easeInOutCubic,
            onUpdate: (t) => {
              view.anim.flip = THREE.MathUtils.lerp(startFlip, targetFlip, t);
              view.anim.y = startY + Math.sin(t * Math.PI) * 3.5;
              view.anim.x = pos.x;
              view.anim.z = pos.z;
              view.anim.rotZ = pos.rotZ;
              view.anim.scale = THREE.MathUtils.lerp(startScale, 1, t);
              view.applyAnim();
            }
          });
        })()
      );
    });
    await Promise.all(flips);
    await delay(0.55); // let players read the reveal
  }

  /** Player p's hidden (number 0) pick, waiting to be revealed/placed. */
  private findHiddenPick(p: number): CardEntry | undefined {
    return this.hiddenPicks.get(p);
  }

  /**
   * Safety net, run after each log batch: remove views whose card no longer
   * exists anywhere in the mirrored state (board, hands, face-down picks).
   * If the hidden-card bookkeeping ever drifts (dupes, stale placeholders),
   * this guarantees nothing is left frozen on the table — worst case the next
   * log item materializes a fresh view.
   */
  private pruneStaleCards() {
    const G = this.G!;
    const alive = new Set<number>();
    const keep = (card: Card | null | undefined) => card && card.number > 0 && alive.add(card.number);
    for (const row of G.rows) {
      row.forEach(keep);
    }
    for (const pl of G.players) {
      pl.hand.forEach(keep);
      keep(pl.faceDownCard);
    }
    const trackedHidden = new Set<CardEntry>(this.hiddenPicks.values());
    for (const [key, entry] of this.cards) {
      if (entry.view.card.number === 0) {
        // Hidden placeholders are managed through hiddenPicks (pick slots)
        // and the offscreen hand stand-ins; a 0-numbered entry anywhere else
        // (e.g. a placed pick that was never resolved because the game ended
        // mid-reveal) can only remain if it occupies a board slot.
        if (!trackedHidden.has(entry) && entry.zone.kind !== "board" && entry.zone.kind !== "offscreen") {
          this.sceneMgr.scene.remove(entry.view.group);
          entry.view.dispose();
          this.cards.delete(key);
        }
        continue;
      }
      if (!alive.has(entry.view.card.number)) {
        this.hiddenPicks.forEach((v, p) => v === entry && this.hiddenPicks.delete(p));
        this.sceneMgr.scene.remove(entry.view.group);
        entry.view.dispose();
        this.cards.delete(key);
      }
    }
  }

  private async applyChoose(player: number, card: Card) {
    const G = this.G!;
    animLog.call("applyChoose", `player=${player} card=${card.number} hidden=${player !== this.me && card.number === 0}`);
    const pl = G.players[player];
    pl.faceDownCard = card;
    // Remove from hand (engine semantics)
    const handIdx = pl.hand.findIndex((c) => c.number === card.number);
    if (handIdx >= 0) {
      pl.hand.splice(handIdx, 1);
    }

    const isMe = player === this.me;
    const hidden = !isMe && card.number === 0;
    // Hidden opponent cards all carry number 0, so NEVER key the map by
    // card.number here — two opponents' picks would collide. Known cards are
    // keyed by number; hidden cards keep their synthetic offscreen key and are
    // additionally tracked per-player in `hiddenPicks`.
    let entry = hidden ? undefined : this.cards.get(card.number);

    if (hidden) {
      // Take one of the player's remaining offscreen hand cards as the pick.
      entry = this.findOffscreenCard(player);
      if (!entry) {
        // Materialize a stand-in (should be rare: resync or spectator join)
        const view = new CardView({ number: 0, points: 0 });
        view.anim.flip = Math.PI;
        view.anim.y = -100;
        view.anim.x = 0;
        view.anim.z = -80;
        this.sceneMgr.scene.add(view.group);
        entry = { view, zone: { kind: "offscreen" } };
        this.cards.set(-(player * 1000 + 990), entry);
      }
      this.hiddenPicks.set(player, entry);
    } else if (!entry) {
      // Materialize (should be rare)
      const view = new CardView(card);
      view.anim.flip = isMe ? 0 : Math.PI;
      view.anim.y = isMe ? HAND_LIFT : -100;
      view.anim.x = 0;
      view.anim.z = isMe ? 26 : -80;
      this.sceneMgr.scene.add(view.group);
      entry = { view, zone: { kind: "hand", index: 0 } };
      this.cards.set(card.number, entry);
    }

    entry.zone = { kind: "pick", player };
    const pos = pickSlot(player, G.players.length);
    const view = entry.view;
    view.zIndex = 40 + player;

    if (hidden) {
      // The offscreen stand-in sits far below the table (y=-100, scale 0.01);
      // flying it from there sweeps it up through the visible board. A hidden
      // pick is anonymous, so materialize it just above the pick slot and let
      // the tween be a short settle-in instead.
      view.anim.x = pos.x;
      view.anim.z = pos.z;
      view.anim.y = CARD_T + 6;
      view.anim.scale = 1;
      view.applyAnim();
    }

    const fromX = view.anim.x;
    const fromY = view.anim.y;
    const fromZ = view.anim.z;
    const fromRotZ = view.anim.rotZ;
    const fromFlip = view.anim.flip;
    const fromScale = view.anim.scale;
    await tweenViewAsync(view, {
      duration: 0.5,
      easing: Easing.easeInOutCubic,
      onUpdate: (t) => {
        view.anim.x = THREE.MathUtils.lerp(fromX, pos.x, t);
        view.anim.z = THREE.MathUtils.lerp(fromZ, pos.z, t);
        view.anim.y = THREE.MathUtils.lerp(fromY, CARD_T, t) + Math.sin(t * Math.PI) * 4;
        view.anim.rotZ = THREE.MathUtils.lerp(fromRotZ, pos.rotZ, t);
        // Own card: flip to face down; opponent card: stays face down
        view.anim.flip = THREE.MathUtils.lerp(fromFlip, Math.PI, Math.min(t * 1.6, 1));
        view.anim.scale = THREE.MathUtils.lerp(fromScale, 1, t);
        view.applyAnim();
      }
    });

    this.relayoutHand();
    this.ui.updatePlayers(G, this.me);
  }

  private findOffscreenCard(player: number): CardEntry | undefined {
    // Find a hidden (number 0) card belonging to the opponent — but never one
    // that is already serving as another player's pick.
    for (const [num, entry] of this.cards) {
      if (entry.zone.kind !== "offscreen" || [...this.hiddenPicks.values()].includes(entry)) {
        continue;
      }
      if (num <= -(player * 1000 + 1) && num > -(player * 1000 + 1000)) {
        return entry;
      }
    }
    // Any hidden card works as a stand-in
    for (const entry of this.cards.values()) {
      if (entry.zone.kind === "offscreen" && entry.view.card.number === 0 && ![...this.hiddenPicks.values()].includes(entry)) {
        return entry;
      }
    }
    return undefined;
  }

  private async applyPlace(player: number, row: number, replace: boolean) {
    const G = this.G!;
    animLog.call("applyPlace", `player=${player} row=${row} replace=${replace}`);
    const pl = G.players[player];
    const card = pl.faceDownCard;
    if (!card) {
      return;
    }

    let entry = this.cards.get(card.number);
    if (entry && entry.zone.kind === "pick" && entry.zone.player === player) {
      // The revealed pick of this player — the common case.
    } else {
      // Resolve (and consume) this player's hidden pick, if any.
      const hiddenEntry = this.findHiddenPick(player);
      if (hiddenEntry) {
        this.hiddenPicks.delete(player);
      }
      if (!entry) {
        entry = hiddenEntry;
      }
    }

    const rowCards = G.rows[row];
    const col = rowCards.length;
    // On a take the row cards are about to fly away — land on slot 0 directly.
    const pos = boardSlot(row, replace ? 0 : Math.min(col, BOARD_COLS - 1));
    const anims: Promise<void>[] = [];

    if (!entry) {
      // The view for this card is missing (bookkeeping drifted). Materialize
      // it at the pick slot so the placement animation ALWAYS completes —
      // a card must never freeze on the pick zone.
      const view = new CardView(card);
      const pick = pickSlot(player, G.players.length);
      view.anim.x = pick.x;
      view.anim.z = pick.z;
      view.anim.y = CARD_T;
      view.anim.flip = 0;
      view.anim.rotZ = pick.rotZ;
      this.sceneMgr.scene.add(view.group);
      view.applyAnim();
      entry = { view, zone: { kind: "pick", player } };
      this.cards.set(card.number, entry);
    }

    {
      // The entry may be keyed under a synthetic negative id (unresolved
      // hidden pick) — re-key under the real card number either way.
      for (const [key, e] of this.cards) {
        if (e === entry && key !== card.number) {
          this.cards.delete(key);
        }
      }
      this.cards.set(card.number, entry);
      if (entry.view.card.number !== card.number) {
        entry.view.setCard(card);
      }
      entry.zone = { kind: "board", row, col: replace ? 0 : col };
      const view = entry.view;
      view.zIndex = 60 + (replace ? 0 : col);
      const startX = view.anim.x;
      const startZ = view.anim.z;
      const startRotZ = view.anim.rotZ;
      // A placed card always ends face-up — never flip a face-up card down.
      const startFlip = Math.min(view.anim.flip, Math.PI);
      const startScale = view.anim.scale;
      anims.push(
        tweenViewAsync(view, {
          duration: 0.6,
          easing: Easing.easeInOutCubic,
          onUpdate: (t) => {
            view.anim.x = THREE.MathUtils.lerp(startX, pos.x, t);
            view.anim.z = THREE.MathUtils.lerp(startZ, pos.z, t);
            view.anim.y = CARD_T + Math.sin(t * Math.PI) * 5;
            view.anim.rotZ = THREE.MathUtils.lerp(startRotZ, 0, t);
            view.anim.flip = THREE.MathUtils.lerp(startFlip, 0, Math.min(t * 2, 1));
            view.anim.scale = THREE.MathUtils.lerp(startScale, 1, t);
            view.applyAnim();
          }
        })
      );
    }

    // Shift existing row cards right to make room visually (they keep cols)
    rowCards.forEach((c, i) => {
      const e = this.cards.get(c.number);
      if (!e) {
        return;
      }
      const target = boardSlot(row, i);
      const v = e.view;
      const sx = v.anim.x;
      const sz = v.anim.z;
      anims.push(
        tweenViewAsync(v, {
          duration: 0.45,
          easing: Easing.easeInOutCubic,
          onUpdate: (t) => {
            v.anim.x = THREE.MathUtils.lerp(sx, target.x, t);
            v.anim.z = THREE.MathUtils.lerp(sz, target.z, t);
            v.applyAnim();
          }
        })
      );
    });

    await Promise.all(anims);

    if (replace) {
      const name = pl.name ?? `Player ${player + 1}`;
      this.ui.toast(`${player === this.me ? "You take" : name + " takes"} the row!`, player === this.me);
      // Cards fly to the player's score pile
      const steal: Promise<void>[] = [];
      rowCards.forEach((c, i) => {
        const e = this.cards.get(c.number);
        if (!e) {
          return;
        }
        e.zone = { kind: "taken", player, index: i };
        steal.push(this.flyAway(e, player === this.me ? 1 : -1, i * 0.06));
        this.cards.delete(c.number);
      });
      await Promise.all(steal);

      // The placed card already landed on slot 0 (see above).
      entry.zone = { kind: "board", row, col: 0 };
      // Small pause to let the "take" sink in
      await delay(0.35);
    }

    // Update engine-side mirror
    if (replace) {
      pl.discard.push(...rowCards);
      pl.points = pl.discard.reduce((s, c) => s + c.points, 0);
      G.rows[row] = [card];
    } else {
      G.rows[row].push(card);
    }
    pl.faceDownCard = null;

    this.ui.updatePlayers(G, this.me);
    this.updateStatus();
  }

  private flyAway(entry: CardEntry, dir = 1, delayS = 0): Promise<void> {
    const view = entry.view;
    const sx = view.anim.x;
    const sy = view.anim.y;
    const sz = view.anim.z;
    return tweenViewAsync(view, {
      duration: 0.55,
      delay: delayS,
      easing: Easing.easeInCubic,
      onUpdate: (t) => {
        view.anim.x = sx + t * t * 30 * dir;
        view.anim.y = sy + t * 26;
        view.anim.z = sz + t * t * 12;
        view.anim.rotZ += 0.06;
        view.applyAnim();
      },
      onComplete: () => {
        this.sceneMgr.scene.remove(view.group);
        view.dispose();
      }
    });
  }

  /* --------------------------- helpers ---------------------------- */

  private flyTo(
    entry: CardEntry,
    x: number,
    z: number,
    rotZ: number,
    opts: { faceUp: boolean; y: number; animated: boolean; zIndex?: number; scale?: number; preserveFlip?: boolean }
  ) {
    const view = entry.view;
    if (opts.zIndex !== undefined) {
      view.zIndex = opts.zIndex;
    }
    const sx = view.anim.x;
    const sy = view.anim.y;
    const sz = view.anim.z;
    const sr = view.anim.rotZ;
    const ss = view.anim.scale;
    const targetScale = opts.scale ?? 1;
    const targetFlip = opts.faceUp ? 0 : Math.PI;
    // Never restart a flip that is already (nearly) at its target face:
    // resync re-flying a face-up card to "face-up" would otherwise capture
    // the current angle and flip it down then back up. The clamp also keeps
    // a card meant to end face-up from ever flipping down.
    let sf = view.anim.flip;
    if (!opts.preserveFlip || Math.abs(targetFlip - sf) > 0.05) {
      sf = targetFlip === 0 ? Math.min(sf, Math.PI) : Math.max(sf, Math.PI);
    }
    if (!opts.animated) {
      view.anim.x = x;
      view.anim.y = opts.y;
      view.anim.z = z;
      view.anim.rotZ = rotZ;
      view.anim.flip = sf;
      view.anim.scale = targetScale;
      view.applyAnim();
      return;
    }
    tweenView(view, {
      duration: 0.5,
      easing: Easing.easeInOutCubic,
      onUpdate: (t) => {
        view.anim.x = THREE.MathUtils.lerp(sx, x, t);
        view.anim.y = THREE.MathUtils.lerp(sy, opts.y, t);
        view.anim.z = THREE.MathUtils.lerp(sz, z, t);
        view.anim.rotZ = THREE.MathUtils.lerp(sr, rotZ, t);
        view.anim.flip = THREE.MathUtils.lerp(sf, targetFlip, t);
        view.anim.scale = THREE.MathUtils.lerp(ss, targetScale, t);
        view.applyAnim();
      }
    });
  }

  private relayoutHand() {
    const G = this.G;
    if (!G || this.me === undefined) {
      return;
    }
    const hand = G.players[this.me].hand;
    hand.forEach((card, i) => {
      const entry = this.cards.get(card.number);
      if (!entry || entry.zone.kind !== "hand") {
        return;
      }
      entry.zone = { kind: "hand", index: i };
      const pos = handSlot(i, hand.length);
      const v = entry.view;
      const sx = v.anim.x;
      const sy = v.anim.y;
      const sz = v.anim.z;
      const sr = v.anim.rotZ;
      const ty = handY(i);
      v.zIndex = 100 + i;
      tweenView(v, {
        duration: 0.35,
        easing: Easing.easeOutCubic,
        onUpdate: (t) => {
          v.anim.x = THREE.MathUtils.lerp(sx, pos.x, t);
          v.anim.y = THREE.MathUtils.lerp(sy, ty, t);
          v.anim.z = THREE.MathUtils.lerp(sz, pos.z, t);
          v.anim.rotZ = THREE.MathUtils.lerp(sr, pos.rotZ, t);
          v.applyAnim();
        }
      });
    });
  }

  /**
   * Row picked but placement not yet applied. updateStatus MUST honor this:
   * the host can redeliver log/availableMoves between the selection and the
   * placeCard log item, and each redelivery re-runs updateStatus — without
   * this flag it would re-light every row-choice highlight over the selection.
   */
  private selectedRow: number | null = null;

  /**
   * The player just picked a row to place/take: drop every row-choice
   * highlight and light only the chosen row's slot in the "selected" color.
   * updateStatus clears it once the placement resolved (placeCard gone).
   */
  private markRowSelected(row: number) {
    this.selectedRow = row;
    this.sceneMgr.clearSlotHighlights();
    const col = Math.min(this.G!.rows[row].length, BOARD_COLS - 1);
    this.sceneMgr.setSlotHighlight(row, col, "selected");
  }

  private updateStatus() {
    const G = this.G;
    if (!G || this.me === undefined) {
      this.ui.setStatus(null);
      return;
    }
    const moves = G.players[this.me]?.availableMoves;
    if (!moves?.placeCard) {
      this.selectedRow = null;
    }
    this.sceneMgr.clearSlotHighlights();
    if (moves?.chooseCard) {
      this.ui.setStatus("Choose a card to play");
    } else if (moves?.placeCard) {
      const mustReplace = moves.placeCard.every((m) => m.replace);
      this.ui.setStatus(mustReplace ? "Too low! Pick a row to take 😬" : "Place your card on a row");
      if (this.selectedRow !== null) {
        // Selection pending: keep only the chosen row lit until it resolves.
        const col = Math.min(G.rows[this.selectedRow].length, BOARD_COLS - 1);
        this.sceneMgr.setSlotHighlight(this.selectedRow, col, "selected");
      } else {
        // Highlight the valid target rows
        for (const m of moves.placeCard) {
          const col = Math.min(G.rows[m.row].length, BOARD_COLS - 1);
          this.sceneMgr.setSlotHighlight(m.row, col, m.replace ? "danger" : "ok");
        }
      }
    } else if (G.phase === Phase.ChooseCard) {
      this.ui.setStatus("Waiting for other players…");
    } else {
      this.ui.setStatus("Resolving cards…");
    }
  }

  /** Game-over check mirrors the engine's canonical `ended()`. */
  private checkEnd() {
    const G = this.G;
    if (!G) {
      return;
    }
    if (ended(G)) {
      this.ui.setStatus(null);
      this.ui.showEndScreen(G, this.me);
    }
  }

  /* --------------------------- replay ---------------------------- */

  private async replayTo(to: number) {
    if (!this.G || !this.futureG) {
      return;
    }
    // Fast path: rebuild from scratch for seeks backwards; incremental for forward
    const base = {
      players: this.futureG.players.map((pl) => ({
        hand: [],
        points: 0,
        faceDownCard: null,
        name: pl.name,
        availableMoves: null,
        discard: [],
        isAI: pl.isAI
      })),
      rows: [[], [], [], []] as [Card[], Card[], Card[], Card[]],
      seed: "",
      round: 0,
      phase: Phase.ChooseCard,
      options: this.futureG.options,
      log: []
    };
    this.logQueue = [];
    this.G = reconstructState(base as unknown as GameState, this.futureG.log.slice(0, to));
    this.acceptedLog = this.G.log.length;
    this.syncAll(false);
    this.emitter.emit("replaceLog", this.G.log.map((item) => logToText(this.G!, item, this.me)).flat());
    this.emitter.emit("replay:info", { start: 1, current: to, end: this.futureG.log.length });
  }

  /* --------------------------- input ---------------------------- */

  private handRaycastTargets(): THREE.Object3D[] {
    const G = this.G;
    if (!G || this.me === undefined) {
      return [];
    }
    const targets: THREE.Object3D[] = [];
    for (const card of G.players[this.me].hand) {
      const entry = this.cards.get(card.number);
      if (entry && entry.zone.kind === "hand") {
        targets.push(entry.view.group);
      }
    }
    return targets;
  }

  private bindInput() {
    const el = this.sceneMgr.renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
  }

  private unbindInput() {
    const el = this.sceneMgr.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerLeave);
  }

  private myMoves(): AvailableMoves | null {
    if (this.G && this.me !== undefined && !this.replaying) {
      return this.G.players[this.me]?.availableMoves ?? null;
    }
    return null;
  }

  private onPointerDown = (ev: PointerEvent) => {
    const moves = this.myMoves();
    if (this.drag) {
      return;
    }

    // Place phase: the player's staged card needs a row. Support both tapping
    // a row directly and dragging the staged card onto a row.
    if (moves?.placeCard) {
      const tablePos = this.sceneMgr.screenToTable(ev.clientX, ev.clientY);
      const row = this.sceneMgr.rowAtPoint(tablePos.x, tablePos.z);
      const target = row === null ? null : moves.placeCard.find((m) => m.row === row);
      if (target) {
        this.markRowSelected(target.row);
        this.sendMove({ name: MoveName.PlaceCard, data: { row: target.row, replace: target.replace } });
        return;
      }
      // Allow dragging the staged (pick) card to a row
      const staged = this.stagedEntry();
      if (staged) {
        const hit = this.sceneMgr.pick(ev.clientX, ev.clientY, [staged.view.group]);
        if (hit) {
          this.beginDrag(staged, ev);
        }
      }
      return;
    }

    if (!moves?.chooseCard) {
      return;
    }
    const targets = this.handRaycastTargets();
    const hit = this.sceneMgr.pick(ev.clientX, ev.clientY, targets);
    if (!hit) {
      return;
    }
    let group: THREE.Object3D | null = hit.object;
    while (group && !this.entryOfGroup(group)) {
      group = group.parent;
    }
    const entry = group ? this.entryOfGroup(group) : null;
    if (!entry) {
      return;
    }
    this.beginDrag(entry, ev);
  };

  /** The player's own staged (face-down/face-up pick) card during play. */
  private stagedEntry(): CardEntry | undefined {
    if (this.me === undefined) {
      return undefined;
    }
    for (const entry of this.cards.values()) {
      if (entry.zone.kind === "pick" && entry.zone.player === this.me) {
        return entry;
      }
    }
    return undefined;
  }

  private beginDrag(entry: CardEntry, ev: PointerEvent) {
    const tablePos = this.sceneMgr.screenToTable(ev.clientX, ev.clientY);
    entry.view.zIndex = 500;
    this.drag = {
      entry,
      pointerId: ev.pointerId,
      offsetX: entry.view.anim.x - tablePos.x,
      offsetZ: entry.view.anim.z - tablePos.z,
      target: new THREE.Vector3(entry.view.anim.x, 0, entry.view.anim.z),
      springX: new Spring(300, 26),
      springZ: new Spring(300, 26),
      moved: false,
      startClient: { x: ev.clientX, y: ev.clientY },
      hoveredRow: null
    };
    this.drag.springX.snap(entry.view.anim.x);
    this.drag.springZ.snap(entry.view.anim.z);
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }

  private entryOfGroup(obj: THREE.Object3D): CardEntry | undefined {
    for (const entry of this.cards.values()) {
      if (entry.view.group === obj) {
        return entry;
      }
    }
    return undefined;
  }

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.drag || ev.pointerId !== this.drag.pointerId) {
      // Hover effect on desktop
      if (ev.pointerType === "mouse") {
        this.updateHover(ev);
      }
      return;
    }
    const d = this.drag;
    const dx = ev.clientX - d.startClient.x;
    const dy = ev.clientY - d.startClient.y;
    if (!d.moved && Math.hypot(dx, dy) > 8) {
      d.moved = true;
    }
    const tablePos = this.sceneMgr.screenToTable(ev.clientX, ev.clientY);
    d.target.set(tablePos.x + d.offsetX, 0, tablePos.z + d.offsetZ);
    d.springX.target = d.target.x;
    d.springZ.target = d.target.z;

    // Highlight hovered row if placing is relevant
    const moves = this.myMoves();
    this.sceneMgr.clearSlotHighlights();
    d.hoveredRow = null;
    if (moves?.placeCard) {
      for (const m of moves.placeCard) {
        const col = Math.min(this.G!.rows[m.row].length, BOARD_COLS - 1);
        this.sceneMgr.setSlotHighlight(m.row, col, m.replace ? "danger" : "ok");
      }
      const z = d.target.z;
      let best: number | null = null;
      let bestDist = 12;
      for (const m of moves.placeCard) {
        const pos = boardSlot(m.row, Math.min(this.G!.rows[m.row].length, BOARD_COLS - 1));
        const dist = Math.hypot(pos.x - d.target.x, pos.z - d.target.z);
        if (dist < bestDist) {
          bestDist = dist;
          best = m.row;
        }
      }
      if (best !== null) {
        d.hoveredRow = best;
        const col = Math.min(this.G!.rows[best].length, BOARD_COLS - 1);
        this.sceneMgr.setSlotHighlight(best, col, "hint");
      }
    }
  };

  private hoverEntry: CardEntry | null = null;

  /** Lower the hover lift (no-op when nothing is hovered). */
  private clearHover() {
    if (!this.hoverEntry) {
      return;
    }
    const e = this.hoverEntry;
    this.hoverEntry = null;
    // Cancel the in-flight lift tween first: it would otherwise keep running
    // and re-raise the lift on the next frames, leaving the card stuck hovered
    // (e.g. after a fast sweep across the fan, where the next card's hover
    // tween only cancels *its own* tweens, not this card's).
    cancelTweensOf(e.view);
    // Settle synchronously: flight tweens about to start on this card (e.g.
    // the just-played card flying to the pick zone) would cancel a lift tween
    // before its first frame and leave the lift stuck mid-value.
    e.view.lift = 0;
    e.view.applyAnim();
    this.sceneMgr.renderer.domElement.style.cursor = "default";
  }

  private onPointerLeave = () => {
    this.clearHover();
  };

  private updateHover(ev: PointerEvent) {
    const moves = this.myMoves();
    const targets = moves?.chooseCard ? this.handRaycastTargets() : [];
    const hit = targets.length ? this.sceneMgr.pick(ev.clientX, ev.clientY, targets) : null;
    let entry: CardEntry | null = null;
    if (hit) {
      let group: THREE.Object3D | null = hit.object;
      while (group && !this.entryOfGroup(group)) {
        group = group.parent;
      }
      entry = group ? this.entryOfGroup(group) ?? null : null;
    }
    // A hover target is only a hand card that can be chosen right now; a card
    // played under a still cursor (or a stale entry after a resync) must drop
    // its lift without waiting for the next pointermove.
    if (entry && entry.zone.kind !== "hand") {
      entry = null;
    }
    if (this.hoverEntry && this.hoverEntry !== entry) {
      this.clearHover();
    }
    if (entry && this.hoverEntry !== entry) {
      this.hoverEntry = entry;
      const e = entry;
      const from = e.view.lift;
      tweenView(e.view, { duration: 0.18, easing: Easing.easeOutQuad, onUpdate: (t) => ((e.view.lift = THREE.MathUtils.lerp(from, 1.4, t)), e.view.applyAnim()) });
    }
    this.sceneMgr.renderer.domElement.style.cursor = entry ? "pointer" : "default";
  }

  private onPointerUp = (ev: PointerEvent) => {
    if (!this.drag || ev.pointerId !== this.drag.pointerId) {
      return;
    }
    const d = this.drag;
    this.drag = null;
    this.sceneMgr.clearSlotHighlights();

    const G = this.G!;
    const me = this.me!;
    const moves = this.myMoves();
    const card = d.entry.view.card;

    // Place phase: dropping the staged card on a valid row.
    if (moves?.placeCard && d.entry.zone.kind === "pick") {
      let row = d.hoveredRow;
      if (row === null) {
        row = this.sceneMgr.rowAtPoint(d.target.x, d.target.z);
      }
      const target = row === null ? null : moves.placeCard.find((m) => m.row === row);
      if (target) {
        this.markRowSelected(target.row);
        this.sendMove({ name: MoveName.PlaceCard, data: { row: target.row, replace: target.replace } });
        return;
      }
      this.resetStagedCard(d.entry);
      return;
    }

    if (moves?.chooseCard) {
      if (!d.moved) {
        // Tap: play the card straight to the pick zone
        this.sendMove({ name: MoveName.ChooseCard, data: { number: card.number, points: card.points } });
        this.resetDraggedCard(d.entry, false);
        return;
      }
      // Dropped onto the pick zone (above the board)? The z threshold sits
      // halfway between the pick arc (-26) and row 0's top edge (-20).
      const pick = pickSlot(me, G.players.length);
      const dist = Math.hypot(d.target.x - pick.x, d.target.z - pick.z);
      if (dist < 11 || d.target.z < -22) {
        this.sendMove({ name: MoveName.ChooseCard, data: { number: card.number, points: card.points } });
      }
      this.resetDraggedCard(d.entry, true);
      return;
    }

    this.resetDraggedCard(d.entry, true);
  };

  /** Return the staged (pick-zone) card to its slot after a cancelled drag. */
  private resetStagedCard(entry: CardEntry) {
    if (entry.zone.kind !== "pick" || this.me === undefined) {
      return;
    }
    const pos = pickSlot(this.me, this.G!.players.length);
    const v = entry.view;
    const sx = v.anim.x;
    const sy = v.anim.y;
    const sz = v.anim.z;
    const sr = v.anim.rotZ;
    tweenView(v, {
      duration: 0.35,
      easing: Easing.easeOutCubic,
      onUpdate: (t) => {
        v.anim.x = THREE.MathUtils.lerp(sx, pos.x, t);
        v.anim.y = THREE.MathUtils.lerp(sy, CARD_T, t);
        v.anim.z = THREE.MathUtils.lerp(sz, pos.z, t);
        v.anim.rotZ = THREE.MathUtils.lerp(sr, pos.rotZ, t);
        v.applyAnim();
      }
    });
  }

  private resetDraggedCard(entry: CardEntry, animate: boolean) {
    if (entry.zone.kind !== "hand") {
      return;
    }
    const index = entry.zone.index;
    entry.view.zIndex = 100 + index;
    const G = this.G!;
    const hand = G.players[this.me!].hand;
    const pos = handSlot(index, hand.length);
    const v = entry.view;
    const sx = v.anim.x;
    const sy = v.anim.y;
    const sz = v.anim.z;
    const sr = v.anim.rotZ;
    tweenView(v, {
      duration: animate ? 0.4 : 0.2,
      easing: Easing.easeOutCubic,
      onUpdate: (t) => {
        v.anim.x = THREE.MathUtils.lerp(sx, pos.x, t);
        v.anim.y = THREE.MathUtils.lerp(sy, handY(index), t);
        v.anim.z = THREE.MathUtils.lerp(sz, pos.z, t);
        v.anim.rotZ = THREE.MathUtils.lerp(sr, pos.rotZ, t);
        v.applyAnim();
      }
    });
  }

  private sendMove(move: Move) {
    // The played card leaves the hand: drop its hover lift immediately instead
    // of keeping it raised/glowing until the next pointermove.
    if (move.name === MoveName.ChooseCard && this.hoverEntry?.view.card.number === move.data.number) {
      this.clearHover();
    }
    this.emitter.emit("move", cloneDeep(move));
  }

  /* --------------------------- testing ---------------------------- */

  /** Internal snapshot, exposed for tests/debugging (window.__take6ctrl). */
  debugState() {
    const G = this.G;
    if (!G) {
      return null;
    }
    return {
      logLength: G.log.length,
      round: G.round,
      phase: G.phase,
      me: this.me,
      hands: G.players.map((pl) => pl.hand.length),
      faceDown: G.players.map((pl) => !!pl.faceDownCard),
      points: G.players.map((pl) => pl.points),
      myMoves: this.myMoves(),
      myHandCards: G.players[this.me!].hand.map((c) => c.number)
    };
  }

  /* --------------------------- frame loop ---------------------------- */

  private renderer_loop = () => {
    if (this.disposed) {
      return;
    }
    requestAnimationFrame(this.renderer_loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    updateTweens(advance(dt));

    // Record the trajectory of every card currently being animated (and every
    // hidden card, so stray placeholders are caught even mid-flight). Static
    // cards are skipped to keep the buffer focused on actual movement.
    if (animLog.enabled) {
      for (const entry of this.cards.values()) {
        const v = entry.view;
        if (isViewAnimating(v) || v.card.number === 0) {
          animLog.frame(`card#${v.card.number}`, entry.zone.kind, v.anim, v.lift);
        }
      }
    }

    // Drag springs
    if (this.drag) {
      const d = this.drag;
      d.springX.update(dt);
      d.springZ.update(dt);
      const v = d.entry.view;
      v.anim.x = d.springX.value;
      v.anim.z = d.springZ.value;
      // Lift above every card in the hand fan (each card rests ~0.03 higher
      // than its left neighbor to avoid z-fighting) plus the drag height.
      v.anim.y = handY(d.entry.zone.kind === "hand" ? d.entry.zone.index : 0) + DRAG_LIFT;
      v.anim.rotZ = THREE.MathUtils.lerp(v.anim.rotZ, 0, 1 - Math.exp(-dt * 10));
      v.applyAnim();
    }

    this.sceneMgr.updateCamera(dt, this.portraitBias);
    this.sceneMgr.render();
  };

  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.unsubTheme?.();
    this.unsubTheme = null;
    this.unbindInput();
    for (const entry of this.cards.values()) {
      this.sceneMgr.scene.remove(entry.view.group);
      entry.view.dispose();
    }
    this.cards.clear();
    this.hiddenPicks.clear();
    this.sceneMgr.dispose();
    this.ui.dispose();
  }
}
