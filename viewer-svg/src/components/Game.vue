<template>
  <div class="game">
    <svg :viewBox="`${viewBoxX} -255 ${viewBoxWidth} 475`" id="scene">
      <defs>
        <filter id="shadow">
          <feGaussianBlur stdDeviation="0.5 0.5" result="shadow"/>
          <feOffset dx="1" dy="1"/>
        </filter>
      </defs>
      <!-- Game Info -->
      <GameInfo :round="round" transform="translate(-190, -240)" />
      <!-- Players -->
      <PlayerLabel :player="G.players[player || 0]" :playerIndex=player :main=true :points=G.players[player||0].points transform="translate(-150, 120)" v-if="G" />
      <PlaceHolder :player="player || 0" transform="translate(-220, 170)" :playerTurn="canPlayerMove(player||0)" :enabled="canPlayerMove(player||0) && !G.players[player||0].faceDownCard" v-if="G" @cardDrop="onCardDrop" />

      <template v-for="(player, i) in otherPlayers">
        <PlayerLabel :player="G.players[player]" :playerIndex=player :points=G.players[player].points :transform="`translate(${i <= 5 ? 173 + 115 * (i % 2) : -300}, ${i <= 5 ? -218 + 110 * Math.floor(i /2) : -218 + 110 * (i - 6)})`" :key="'label-'+player" />
        <PlaceHolder :player="player" :playerTurn="canPlayerMove(player)" :key="'placehold-player-' + player" :transform="`translate(${i <= 5 ? 173 + 115 * (i % 2) : -300}, ${i <= 5 ? -163 + 110 * Math.floor(i /2) : -163 + 110 * (i - 6)})`" />
      </template>

      <!-- Board -->
      <template v-for="row in 4">
        <template v-for="rowPos in 6">
          <PlaceHolder
            :key="`board-${row-1}-${rowPos-1}`"
            :row=row-1
            :rowPos=rowPos-1
            :danger="rowPos===6"
            :transform="`translate(${-203 + (rowPos-1) * 55}, ${((row - 1) - 1.5) * 80 - 75})`"
            :enabled="isPlaceholderEnabled(row-1, rowPos-1)"
            @cardDrop="onCardDrop"
          />
        </template>
      </template>

      <!-- All the cards -->
      <Card v-for="(card, i) in [...sortedHandCards].reverse()" :card="card" :key="card.number || `hand-${i}`" :targetState="handTargetState(handCards.length - 1 - i)" @fastClick="onCardDrop(card, {player})" />

      <template v-if="G">
        <template v-for="(player, i) in G.players">
          <Card v-if="player.faceDownCard" :card="player.faceDownCard" :key="player.faceDownCard.number || 'player-'+i" :targetState="facedownTargetState(i)" @fastClick="onCardDrop(player.faceDownCard, {player: i, autoChooseRow: true})" />
        </template>
      </template>

      <template v-for="row in 4">
        <template v-for="rowPos in 6">
          <Card v-if="G && G.rows[row-1][rowPos-1]" :card="G.rows[row-1][rowPos-1]" :key="G.rows[row-1][rowPos-1].number || 'board-card-'+row+'-'+rowPos" :targetState="boardTargetState(row-1, rowPos-1)" />
        </template>
      </template>

      <use xlink:href="#dragged"/>
    </svg>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch, Provide, ProvideReactive } from 'vue-property-decorator';
import { LogItem, MoveName, Card as ICard, AvailableMoves, GameEventName, Phase, reconstructState } from 'take6-engine';
import type { GameState } from 'take6-engine';
import { EventEmitter } from 'events';
import Card from "./Card.vue";
import PlaceHolder from "./Placeholder.vue";
import PlayerLabel from "./PlayerLabel.vue";
import GameInfo from "./GameInfo.vue";
import { range, isEqual, sumBy, sortBy } from "lodash";
import { UIData } from '../types/ui-data';
import { logToText } from '../utils/log-to-text';

@Component({
  created (this: Game) {
    this.emitter.on("addLog", this.addLog.bind(this));

    this.emitter.on("replayStart", () => {
      this.emitter.emit("replay:info", {start: 1, current: this.G!.log.length, end: this._futureState!.log.length});
      this.paused = true;
    });

    this.emitter.on("replayTo", (to: number) => {
      if (to < this.G!.log.length) {
        const baseState = {
          players: this.G!.players.map(player => ({
            hand: [],
            points: 0,
            faceDownCard: null,
            name: player.name,
            availableMoves: null,
            discard: [],
            isAI: player.isAI
          })),
          rows: [[], [], [], []] as [ICard[], ICard[], ICard[], ICard[]],
          seed: '',
          round: 0,
          phase: Phase.ChooseCard,
          options: this.G!.options,
          log: []
        };

        this.replaceState(reconstructState(baseState, this._futureState!.log.slice(0, to)), false);
      }

      if (this.G!.log.length + 1 === to) {
        this.advanceLog();
      } else if (this.G!.log.length + 1 < to) {
        this.replaceState(reconstructState(this.G!, this._futureState!.log.slice(this.G!.log.length, to)), false);
      }

      this.emitter.emit("replay:info", {start: 1, current: this.G!.log.length, end: this._futureState!.log.length});
    });

    this.emitter.on("replayEnd", () => {
      this.paused = false;
      this.emitter.emit("fetchState");
    });
  },
  components: {
    Card,
    PlaceHolder,
    PlayerLabel,
    GameInfo
  }
})
export default class Game extends Vue {
  @Prop()
  private state?: GameState;

  @Prop()
  @ProvideReactive()
  player?: number;

  @Prop()
  emitter!: EventEmitter;

  paused = false;

  @Provide()
  ui: UIData = {cards: {}, placeholders: {rows: [], players: []}, waitingAnimations: 0};

  @Provide()
  communicator: EventEmitter = new EventEmitter();

  @ProvideReactive()
  G?: GameState | null = null;
  _futureState?: GameState;

  addLog ({ log, availableMoves, start }: {log: LogItem[]; start: number; availableMoves: AvailableMoves[]}) {
    console.log("adding log...");

    this._pendingAvailableMoves = null;
    if (start > this._futureState!.log.length) {
      this.emitter.emit("fetchState");
      return;
    }

    if (log.length === 0) {
      this.loadAvailableMoves(availableMoves);
      return;
    }

    // edge case when we do a move and another player just did a move
    if (start === this._futureState!.log.length && start > 0 && isEqual(log[0], this._futureState!.log.slice(-1)[0])) {
      this.emitter.emit("fetchState");
      return;
    }


    this._futureState!.log = [...this._futureState!.log.slice(0, start), ...log];
    this._pendingAvailableMoves = {index: start + log.length, availableMoves: availableMoves};
    this.updateUI();
  }

  @Watch("state", { immediate: true })
  onStateChanged(state: GameState) {
    this.replaceState(state);
  }

  replaceState (state: GameState, replaceFuture = true) {
    console.log("replace state", state, replaceFuture);
    if (replaceFuture) {
      this._futureState = state;
    }

    this.G = JSON.parse(JSON.stringify(state));

    if (this.G) {
      this.emitter.emit("uplink:replaceLog", [...this.G!.log.map((x: LogItem) => logToText(this.G!, x))].flat(1));
    }
  }

  get handCards() {
    return this.G?.players[this.player!]?.hand;
  }

  get sortedHandCards() {
    return sortBy(this.G?.players[this.player!]?.hand ?? [], "number");
  }

  get round(){
    return this.G?.round;
  }

  get viewBoxX() {
    return this.G?.players.length! > 7 ? "-350" : "-265";
  }

  get viewBoxWidth() {
    if (this.G?.players.length! > 7) {
      return "690";
    } else if (this.G?.players.length! > 2) {
      return "605";
    } else {
      return "560";
    }
  }

  handTargetState(index: number) {
    const hand = this.handCards!;

    const angle = (index - (hand.length - 1)/2) * 0.03;
    const xPos = index * 45;

    return {
      x: -150  +  xPos ,
      y: 175,
      rotation: 0
    };
  }

  facedownTargetState(player: number) {
    const placeholder = this.ui.placeholders.players[player];

    if (!placeholder) {
      return {
        x: 0,
        y: 0,
        rotation: 0
      };
    }

    const elem: SVGGElement = placeholder.$el as SVGGElement;
    const transform = elem.transform.baseVal.getItem(0);

    return {
      x: transform.matrix.e,
      y: transform.matrix.f,
      rotation: 0,
      // NEEDED to trigger recompute on player change
      currentPlayer: this.player
    }
  }

  boardTargetState(row: number, rowPos: number) {
    return {
      x: -203 + rowPos * 55,
      y: (row - 1.5) * 80 - 75,
      rotation: 0
    };
  }

  isPlaceholderEnabled(row: number, rowPos: number) {
    if (!this.G || this.player === undefined) {
      return false;
    }

    const availableMoves = this.G!.players[this.player].availableMoves;

    const choice = availableMoves?.placeCard?.find(pos => pos.row === row);

    if (!choice) {
      return false;
    }

    if (choice.replace) {
      return rowPos === 5;
    } else {
      return rowPos === this.G.rows[choice.row].length;
    }
  }

  get otherPlayers() {
    if (!this.G) {
      return [];
    }
    return range(0, this.G.players.length).filter(pl => pl !== (this.player || 0));
  }

  canPlayerMove(player: number) {
    return !!this.G?.players[player]?.availableMoves;
  }

  onCardDrop(card: ICard, {player, row, rowPos, autoChooseRow}: {player?: number, row?: number, rowPos?: number, autoChooseRow?: boolean}) {
    console.log("card drop");
    if (this.player === undefined || (player !== undefined && player !== this.player)) {
      return;
    }

    const commands = this.G!.players[this.player].availableMoves!;

    if (!commands) {
      return;
    }

    if (this.G!.log.length !== this._futureState!.log.length) {
      return;
    }

    if (autoChooseRow) {
      if (commands.placeCard!.length > 1) {
        return;
      }
      row = commands.placeCard![0].row;
    }

    this.G!.players[this.player].availableMoves = null;

    console.log(player, row, rowPos, autoChooseRow);

    if (player !== undefined && !autoChooseRow) {
      this._futureState!.log.push({player: this.player!, type: "move", move: {name: MoveName.ChooseCard, data: card}});
      this.emitter.emit("move", {name: MoveName.ChooseCard, data: card});
    } else {
      this._futureState!.log.push({player: this.player!, type: "move", move: {name: MoveName.PlaceCard, data: commands.placeCard!.find(item => item.row === row)!}});
      this.emitter.emit("move", {name: MoveName.PlaceCard, data: commands.placeCard!.find(item => item.row === row)});
    }

    this.updateUI();
  }

  loadAvailableMoves(availableMoves: AvailableMoves[]) {
    for (let i = 0; i < availableMoves.length; i++) {
      this.G!.players[i].availableMoves = availableMoves[i];
    }
    this._pendingAvailableMoves = null;
  }

  @Watch("ui.waitingAnimations")
  updateUI() {
    if (this.ui.waitingAnimations > 0) {
      return;
    }
    if (this.animationQueue.length > 0) {
      this.animationQueue.shift()!();
      setTimeout(() => this.updateUI());
      return;
    }
    if (this.paused) {
      return;
    }
    if (this.G!.log.length < this._futureState!.log.length) {
      this.advanceLog();
      setTimeout(() => this.updateUI());
      return;
    }

    if (this._pendingAvailableMoves && this._pendingAvailableMoves.index === this.G!.log.length) {
      console.log("loading available moves", JSON.stringify(this._pendingAvailableMoves));
      this.loadAvailableMoves(this._pendingAvailableMoves.availableMoves);
    }
  }

  advanceLog() {
    console.log("advancing log", this.G!.log.length, this._futureState!.log.length);
    const logItem = this._futureState!.log[this.G!.log.length];
    this.G!.log.push(logItem);
    this.emitter.emit("uplink:addLog", logToText(this.G!, logItem));

    this.delay(1);

    switch (logItem.type) {
      case "phase": return;
      case "move": {
        const {player, move} = logItem;

        switch (move.name) {
          case MoveName.ChooseCard: {
            console.log("choosing card", player);
            this.G!.players[player].faceDownCard = move.data;

            this.delay(200);

            if (player === (this.player || 0)) {
              this.G!.players[this.player!].hand = this.handCards!.filter(card => card.number !== move.data.number);
            } else {
              this.G!.players[player].hand.shift();
            }
            return;
          }
          case MoveName.PlaceCard: {
            console.log("placing card", player);
            const card = this.G!.players[player].faceDownCard!;
            this.G!.players[player].faceDownCard = null;

            if (move.data.replace) {
              // put new card on 6th spot
              this.G!.rows[move.data.row][5] = card;
              this.G!.rows = [...this.G!.rows];

              this.queueAnimation(() => {
                console.log("delaying before taking row");
                this.delay(200);
              });
              this.queueAnimation(() => {
                console.log("Taking row");
                this.G!.players[player].points += sumBy(this.G!.rows[move.data.row].slice(0, 5), "points");
                this.G!.rows[move.data.row] = [];
                this.G!.rows[move.data.row][5] = card;
                this.G!.rows = [...this.G!.rows];

                console.log("delaying after taking row");
                this.delay(300);
              });
              // Then move card to correct spot
              this.queueAnimation(() => {
                this.G!.rows[move.data.row] = [card];
                this.G!.rows = [...this.G!.rows];
              });
            } else {
              this.G!.rows[move.data.row].push(card);
              this.G!.rows = [...this.G!.rows];
            }

            return;
          }
          default: return;
        }
      }
      case "event": {
        const {event} = logItem;
        switch (event.name) {
          case GameEventName.RevealCards: {
            const cards = event.cards;

            for (let player = 0; player < cards.length; player++) {
              this.G!.players[player].faceDownCard = cards[player];
            }

            this.delay(200);

            return;
          }
          case GameEventName.RoundStart: {
            console.log(JSON.parse(JSON.stringify(event)));
            this.G!.rows = event.cards.board.map(card => [card]) as [ICard[], ICard[], ICard[], ICard[]];

            for (let i = 0; i < this.G!.players.length; i++) {
              this.G!.players[i].hand = event.cards.players[i];
            }

            return;
          }
          default: return;
        }
      }
    }
  }

  delay(ms: number) {
    this.ui.waitingAnimations += 1;
    setTimeout(() => {
      this.ui.waitingAnimations = Math.max(this.ui.waitingAnimations - 1, 0);
    }, ms);
  }

  @Watch("ui.waitingAnimations")
  onAnimationNumberChanged() {
    console.log("waiting animations", this.ui.waitingAnimations, this._futureState!.log.length, this.state!.log.length);
  }

  queueAnimation(anim: Function) {
    this.animationQueue.push(anim);
  }

  _pendingAvailableMoves: {index: number, availableMoves: AvailableMoves[]} | null = null;
  animationQueue: Array<Function> = [];
}

</script>
<style lang="scss">

.game {
  height: 100%;
  width: 100%;
  background-color: white;
  display: flex;
  align-items: center;
  flex-direction: column;
}

#scene {
  max-height: 100%;
  flex-grow: 1;
}

body, html {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
}

text {
  font-family: 'Arial';
  pointer-events: none;
  text-anchor: middle;
  dominant-baseline: central;
}

</style>
