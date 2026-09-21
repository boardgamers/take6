import { expect } from "chai";
import * as wrapper from "../wrapper.js";
import { setup, move as play } from "./engine.js";
import { getCard } from "./card.js";
import type { Move } from "./move.js";

describe("analysis", () => {
 it("restores a public log boundary and lets a human play every seat", () => {
  let source = setup(2, { points: 40, handSize: 4 }, "test");
  source = play(source, { name: "chooseCard", data: getCard(34) } as Move, 0);
  const to = source.log.length;
  source = play(source, { name: "chooseCard", data: getCard(32) } as Move, 1);
  source.players[1].isAI = true;
  const original = JSON.stringify(source);
  const copy = wrapper.createAnalysis(source, { to, sourceEnded: true });
  expect(copy.log.length).to.equal(to);
  expect(copy.players.every(p => !p.isAI)).to.equal(true);
  const next = wrapper.analysisMove(copy, { name: "chooseCard", data: getCard(32) } as Move, 1);
  expect(next.log.length).to.be.greaterThan(to);
  expect(JSON.stringify(source)).to.equal(original);
 });
});
