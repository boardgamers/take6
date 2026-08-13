import { GameEventName, MoveName, Phase } from "take6-engine";
import type { GameState, LogItem } from "take6-engine";

/** Player display name with fallbacks, matching the badges/end screen. */
function playerName(G: GameState, index: number, me?: number): string {
  if (me !== undefined && index === me && !G.players[index]?.name) {
    return "You";
  }
  return G.players[index]?.name ?? `Player ${index + 1}`;
}

/**
 * Convert one log item to human-readable lines for the host's sidebar.
 *
 * Mirrors viewer-svg's log-to-text util so all viewers report the same
 * strings to the platform. `me` is the viewing player's index, used to
 * render "You" for their own actions.
 */
export function logToText(G: GameState, item: LogItem, me?: number): string[] {
  switch (item.type) {
    case "move": {
      switch (item.move.name) {
        case MoveName.ChooseCard:
          return [`${playerName(G, item.player, me)} made ${item.player === me ? "your" : "their"} choice`];
        case MoveName.PlaceCard: {
          const ret = [`${playerName(G, item.player, me)} placed ${item.player === me ? "your" : "their"} card on row ${item.move.data.row + 1}`];
          if (item.move.data.replace) {
            ret.push(`**${playerName(G, item.player, me)} ${item.player === me ? "take" : "takes"} the row!!**`);
          }
          return ret;
        }
      }
    }
    // eslint-disable-next-line no-fallthrough
    case "phase": {
      switch (item.phase) {
        case Phase.ChooseCard:
          return ["*Time to make a choice!*"];
        case Phase.PlaceCard:
          return ["*Here we go!*"];
      }
    }
    // eslint-disable-next-line no-fallthrough
    case "event": {
      switch (item.event.name) {
        case GameEventName.GameStart:
          return ["**Game started!!**"];
        case GameEventName.GameEnd:
          return ["**Game ended!!**"];
        case GameEventName.RevealCards: {
          const ret: string[] = [];
          item.event.cards.forEach((card, i) => {
            ret.push(`${playerName(G, i, me)} reveal${i === me ? "" : "s"} ${card.number} (${new Array(card.points).fill("★").join("")})`);
          });
          return ret;
        }
        case GameEventName.RoundStart:
          return [`**Round ${item.event.round}**`];
      }
    }
  }
}
