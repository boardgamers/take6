<template>
  <g :class="['placeholder', {enabled, playerTurn, danger, overlapping, canClick}]" @click="onClick">
    <rect width="50" height="70" x="-25" y="-35" />
  </g>
</template>
<script lang="ts">
import {Vue, Component, Prop, Watch, Inject, InjectReactive} from "vue-property-decorator";
import { UIData } from '../types/ui-data';
import { EventEmitter, Listener } from 'events';
import { Card } from "take6-engine";
import { GameState } from 'take6-engine/src/gamestate';

@Component({
  created(this: PlaceHolder) {
    if (this.row !== undefined) {
      this.ui.placeholders.rows[this.row] = this.ui.placeholders.rows[this.row] || [];
      this.ui.placeholders.rows[this.row][this.rowPos!] = this;
    } else if (this.player !== undefined) {
      this.ui.placeholders.players[this.player] = this;
    }
  }
})
export default class PlaceHolder extends Vue {
  @Inject()
  readonly ui!: UIData;

  @Inject()
  readonly communicator!: EventEmitter;

  @InjectReactive("player")
  readonly mainPlayer!: number;

  @InjectReactive()
  G!: GameState;

  @Prop({default: false})
  enabled!: boolean;

  @Prop({default: false})
  playerTurn!: boolean;

  @Prop({default: false})
  danger!: boolean;

  overlapping = false;

  updateOverlapping(card: Card) {
    if (!this.enabled || !this.ui.dragged) {
      if (this.overlapping && this.enabled && !this.ui.dragged) {
        // console.log("emitting card drop");
        this.$emit("cardDrop", card, {row: this.row, rowPos: this.rowPos, player: this.player});
      }
      this.overlapping = false;
      return;
    }

    const rect1 = this.$el.getBoundingClientRect();
    const rect2 = this.ui.dragged!.$el.getBoundingClientRect();

    this.overlapping = rect1.bottom >= rect2.top && rect1.right >= rect2.left && rect1.top <= rect2.bottom && rect1.left <= rect2.right;
  }

  @Watch("enabled", {immediate: true})
  onEnabledChanged() {
    if (!this.listener) {
      this.listener = (card) => this.updateOverlapping(card);
      this.$on("hook:beforeDestroy", () => this.communicator.off("draggedPosChanged", this.listener!));
    }

    if (this.enabled) {
      this.communicator.on("draggedPosChanged", this.listener!);
    } else {
      this.communicator.off("draggedPosChanged", this.listener!);
    }
  }

  get canClick() {
    return this.enabled && this.row !== undefined;
  }

  onClick() {
    if (!this.canClick) {
      return;
    }

    this.$emit("cardDrop", this.G.players[this.mainPlayer].faceDownCard, {row: this.row, rowPos: this.rowPos, player: this.player});

    this.overlapping = false;
  }

  listener?: Listener;

  @Prop()
  row?: number;

  @Prop()
  rowPos?: number;

  @Prop()
  player?: number;
}

</script>
<style lang="scss">
g.placeholder {
  & > rect {
    fill: #00000022;
  }

  &.danger > rect {
    fill: #ff000044;
  }

  &.enabled > rect {
    stroke-width: 2;
    stroke: #71ec1fe3;
  }

  &.playerTurn > rect {
    stroke-width: 2;
    stroke: #77ff7755;
  }

  &.overlapping > rect, &.canClick:hover > rect{
    fill: #ffffff22;
  }

  &.canClick {
    cursor: pointer;
  }
}
</style>