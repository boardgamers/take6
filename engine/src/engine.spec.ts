import { expect } from "chai";
import { setup, move as execMove, ended } from './engine.js';
import { getCard } from './card.js';
import type { Move } from './move.js';

describe("Engine", () => {
  it ("should stop after the point limit is reached", () => {
    // Seed "test" deals rows 93/81/75/42, player 0: 59,34,88,50, player 1:
    // 89,32,80,37. Round 1: 32 is lower than every tail (a real row choice),
    // 34's placement is forced. Round 2: both placements are forced — no
    // placeCard move is sent at all (see switchToNextPlayer).
    const moves: Array<{player: number; move: Move}> = [
      {player: 0, move: {name: "chooseCard", data: getCard(34)} as Move},
      {player: 1, move: {name: "chooseCard", data: getCard(32)} as Move},
      {player: 1, move: {name: "placeCard", data: {row: 0, replace: true}} as Move},
      // 34 auto-places on row 0 behind 32
      {player: 0, move: {name: "chooseCard", data: getCard(50)} as Move},
      {player: 1, move: {name: "chooseCard", data: getCard(89)} as Move},
      // 50 auto-places on row 3, 89 auto-places on row 1
      {player: 0, move: {name: "chooseCard", data: getCard(59)} as Move},
      {player: 1, move: {name: "chooseCard", data: getCard(37)} as Move},
      // 37 auto-places on row 0, 59 auto-places on row 3 (6th card: 42,50,59)
      {player: 0, move: {name: "chooseCard", data: getCard(88)} as Move},
      {player: 1, move: {name: "chooseCard", data: getCard(80)} as Move}
      // 80 auto-places on row 2, 88 auto-places on row 1
    ];

    let G = setup(2, {points: 1, handSize: 4}, "test");

    for (const move of moves) {
      G = execMove(G, move.move, move.player);
    }

    expect(G.players[0].points).to.equal(0);
    expect(G.players[1].points).to.equal(1);

    expect(ended(G)).to.be.true;

    G = setup(2, {points: 40, handSize: 4}, "test");

    for (const move of moves) {
      G = execMove(G, move.move, move.player);
    }

    expect(G.players[0].points).to.equal(0);
    expect(G.players[1].points).to.equal(1);

    expect(ended(G)).to.be.false;
  });

  it ("should auto-resolve a placeCard move with a single legal option", () => {
    let G = setup(2, {points: 66, handSize: 10}, "test");

    // Hand both players cards that fit on row 0: each placement is forced, so
    // the second chooseCard resolves the whole phase on its own.
    const tail = G.rows[0][0].number;
    G.players[0].hand[0] = getCard(tail + 1);
    G.players[1].hand[0] = getCard(tail + 2);
    for (const pl of G.players) {
      pl.availableMoves = {chooseCard: pl.hand};
    }

    G = execMove(G, {name: "chooseCard", data: G.players[0].hand[0]} as Move, 0);
    G = execMove(G, {name: "chooseCard", data: G.players[1].hand[0]} as Move, 1);

    expect(G.players.every(pl => !pl.faceDownCard && !pl.availableMoves?.placeCard)).to.be.true;
    expect(G.phase).to.equal("choose");
    expect(G.rows[0].map(c => c.number)).to.deep.equal([tail, tail + 1, tail + 2]);

    const placeMoves = G.log.filter(item => item.type === "move" && item.move.name === "placeCard");
    expect(placeMoves).to.have.length(2);
    expect(placeMoves[0]).to.deep.equal({type: "move", player: 0, move: {name: "placeCard", data: {row: 0, replace: false}}});
    expect(placeMoves[1]).to.deep.equal({type: "move", player: 1, move: {name: "placeCard", data: {row: 0, replace: false}}});
  });

  it ("should not auto-resolve a placeCard move with several rows to take", () => {
    let G = setup(2, {points: 66, handSize: 10}, "test");

    // Player 0 gets a card lower than every row tail: picking the row to take
    // is a real decision and must be left to the player.
    const low = Math.min(...G.rows.map(row => row[0].number)) - 1;
    G.players[0].hand[0] = getCard(low);
    for (const pl of G.players) {
      pl.availableMoves = {chooseCard: pl.hand};
    }

    G = execMove(G, {name: "chooseCard", data: G.players[0].hand[0]} as Move, 0);
    G = execMove(G, {name: "chooseCard", data: G.players[1].hand[0]} as Move, 1);

    expect(G.players[0].availableMoves?.placeCard).to.have.length(4);
    expect(G.players[1].faceDownCard).to.exist;

    G = execMove(G, {name: "placeCard", data: {row: 0, replace: true}} as Move, 0);

    // Player 1's placement is forced (single option) and auto-resolves.
    expect(G.players.every(pl => !pl.faceDownCard && !pl.availableMoves?.placeCard)).to.be.true;
    expect(G.phase).to.equal("choose");
    expect(G.rows[0][0].number).to.equal(low);
  });
});
