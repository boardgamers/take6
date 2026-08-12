<template>
  <g :class="['card', {dragging}]" :id="dragging ? 'dragged' : undefined" ref="card" :transform="`translate(${currentX}, ${currentY}), rotate(${rotation})`" @transitionend="onTransitionEnd">
    <rect x="-20" y="-30" width="40" height="60" :class="['card-body', {facedown}, cardColor ]" />
    <text v-if="!facedown">{{number}}</text>

    <template v-for="i in points">
        <rect
          class="point"
          width="5"
          height="5"
          :fill="pointColor"
          :a="i"
          :key="i"
          :y="yPoint(i)"
          :x="xPoint(i)"
          />
    </template>
  </g>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch, Mixins, Inject, InjectReactive } from "vue-property-decorator";
import { Card as ICard } from "take6-engine";
import Draggable from './Draggable.vue';
import { UIData } from '../types/ui-data';
import { EventEmitter } from 'events';

@Component({
  created(this: Card) {
    console.log("created card", this.card.number);
    this.$on("draggedTo", (coords: {x: number, y: number}) => {
      [this.currentX, this.currentY] = [coords.x, coords.y];

      this.$nextTick(() => {
        this.communicator.emit("draggedPosChanged", this.card);
      });
    });

    this.$on("hook:beforeDestroy", () => {
      if (this.card?.number && this.ui.cards[this.card.number] === this) {
        delete this.ui.cards[this.card.number];
      }
    });
  },
  mounted(this: Card) {
    this.mounted = true;
  },
  beforeDestroy(this: Card) {
    this.onTransitionEnd();
  }
})
export default class Card extends Mixins(Draggable) {
  @Prop()
  card!: ICard;

  @Prop({default: () => ({x: 0, y: 0, rotation: 0})})
  targetState!: {
    x: number,
    y: number,
    rotation: number
  };

  @Inject()
  readonly communicator!: EventEmitter;

  @Inject()
  readonly ui!: UIData;

  currentX = 0;
  currentY = 0;
  mounted = false;
  transitioning = false;
  transitionCount = 0;

  get facedown() {
    return !this.card || this.card.number === 0;
  }

  get number() {
    return this.card?.number ?? 0;
  }

  get points() {
    return this.card?.points ?? 0;
  }

  get cardColor() {
    return 'p' + this.card?.points ?? 0;
  }
  
  get pointColor()  {
    return this.points === 5 ? 'white' : 'red';
  }

  get rotation(): number {
    return this.targetState?.rotation ?? 0;
  }

  xPoint( num: number): number {
    const points = this.card?.points ?? 0;
    const secondLine = points<4 ? 0 : ( points===5 ? Math.max(num-3,0) : Math.max(num-4,0)  );
    const point = secondLine>0 ? secondLine : num;
    const offset = points ===1 || points===3 || (points===5 && secondLine===0) || (points===7 && secondLine>0) ? 2 : 5.75 ;
    return (((point-1) % 2 === 0) ? (- Math.ceil((point-1)/2) * 7.5 - offset) : (Math.ceil((point-1)/2) * 7.5) - offset)
  }

  yPoint( num: number): number {
    const points = this.card?.points ?? 0;
    const secondLine = points<4 ? 0 : ( points===5 ? Math.max(num-3,0) : Math.max(num-4,0)  );
    return secondLine>0 ? - 30 + 10 : - 30 + 2.5
  }

  startTransitioning() {
    if (this.transitioning) {
      return;
    }

    this.ui.waitingAnimations += 1;
    this.transitioning = true;
    this.transitionCount += 1;

    const count = this.transitionCount;

    // Safeguard to make sure even if we don't catch the transition end event, we stop the transition
    setTimeout(() => {
      if (count === this.transitionCount) {
        this.onTransitionEnd();
      }
    }, 1000);
  }

  @Watch("dragging")
  @Watch("targetState", {immediate: true})
  onTargetChanged(newVal: boolean, oldVal: boolean) {
    if (this.dragging) {
      return;
    }
    if (this.targetState.x === this.currentX && this.targetState.y === this.currentY) {
      return;
    }

    if (!this.transitioning && this.mounted && ! (oldVal && !newVal)) {
      this.startTransitioning();
    }

    if (!this.mounted) {
      this.currentX = this.targetState.x;
      this.currentY = this.targetState.y;
    } else {
      // Make sure the animation plays by waiting until the class "dragging" is removed
      // for sure from the element
      setTimeout(() => {
        this.currentX = this.targetState.x;
        this.currentY = this.targetState.y;
      });
    }
  }

  @Watch("card", {immediate: true})
  onCardChanged(newCard?: ICard, oldCard?: ICard) {
    const oldCardNumber = oldCard?.number ?? 0;
    const newCardNumber = newCard?.number ?? 0;

    if (oldCardNumber === newCardNumber) {
      return;
    }

    if (oldCardNumber) {
      delete this.ui.cards[oldCardNumber];
    }

    if (newCardNumber) {
      this.ui.cards[newCardNumber] = this;
    }
  }

  @Watch("dragging")
  onDraggingChanged() {
    if (this.dragging) {
      this.ui.dragged = this;
    } else {
      this.ui.dragged = null;
      this.communicator.emit("draggedPosChanged", this.card);
    }
  }

  onTransitionEnd() {
    console.log("on transition end", this.transitioning);
    if (this.transitioning) {
      this.transitioning = false;
      this.ui.waitingAnimations = Math.max(this.ui.waitingAnimations - 1, 0);
    }
  }
}

</script>
<style lang="scss">

.card {
  &:not(.dragging) {
    transition-property: transform;
    transition-duration: 0.8s;
    transition-timing-function: ease-in-out;
  }

  .card-body {
    stroke: gray;
    stroke-width: 1;

    fill: #fafafa;
    cursor: pointer;

    &.facedown {
      fill: rgb(28, 81, 196);
    }
    
    &.p2 {fill: cornflowerblue;}
    &.p3 {fill: orange;}
    &.p5 {fill: red;}
    &.p7 {fill: violet;}

    &:hover {
      fill: green;
    }
  }

  &.dragging .card-body {
    fill: green;
  }

  text {
    font-size: 20px;
  }

  .point {
    pointer-events: none;
  }
}

</style>