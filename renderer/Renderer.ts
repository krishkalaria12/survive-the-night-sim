import { assets } from "./Assets";
import { generateBg } from "./Background";
import { type RendererEffect, RendererEffectType } from "./Effect";
import { RendererItem } from "./Item";
import { canvasToImage } from "@/lib/canvasToImage";
import { prepareCanvas } from "@/lib/prepareCanvas";
import {
  type Entity,
  EntityType,
  type Position,
  VisualEventType,
  Zombie,
  ZombieSurvival,
} from "@/simulator";

const ANIMATABLE_DEAD_ENTITIES = [EntityType.Zombie];

export class Renderer {
  private readonly cellSize: number;
  private readonly map: string[][];
  private readonly replaySpeed: number;
  private readonly h: number;
  private readonly w: number;

  private bgSprite: HTMLImageElement | null = null;
  private canvas2: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ctx2: CanvasRenderingContext2D;
  private initialized = false;
  private items: RendererItem[] = [];
  private req: number | null = null;
  private playerLabels?: Record<string, string>;

  public constructor(
    map: string[][],
    canvas: HTMLCanvasElement,
    cellSize: number,
    replaySpeed: number,
    playerLabels?: Record<string, string>,
  ) {
    this.cellSize = cellSize;
    this.map = map;
    this.replaySpeed = replaySpeed;
    this.h = ZombieSurvival.boardHeight(map) * cellSize;
    this.w = ZombieSurvival.boardWidth(map) * cellSize;

    this.canvas2 = document.createElement("canvas");

    this.ctx = prepareCanvas(canvas, this.w, this.h);
    this.ctx2 = prepareCanvas(this.canvas2, this.cellSize, this.cellSize);

    this.playerLabels = playerLabels;
  }

  public isInitialized() {
    return this.initialized;
  }

  public async initialize() {
    if (this.initialized) {
      return;
    }

    if (!assets.loaded) {
      await new Promise<void>((resolve) => {
        assets.addEventListener("loaded", () => {
          resolve();
        });
      });
    }

    this.bgSprite = await generateBg(this.map);
    this.initialized = true;
  }

  public render(entities: Entity[]) {
    if (this.req !== null) {
      window.cancelAnimationFrame(this.req);
      this.req = null;
    }

    this.register(entities);
    this.draw();
  }

  private draw() {
    this.ctx.clearRect(0, 0, this.w, this.h);

    for (const item of this.items) {
      this.drawItem(item);
    }

    if (this.shouldAnimate()) {
      this.req = window.requestAnimationFrame(() => {
        this.req = null;
        this.draw();
      });
    }
  }

  private drawItem(item: RendererItem) {
    if (item.hasEffect(RendererEffectType.Opacity)) {
      const effect = item.getEffect(RendererEffectType.Opacity);
      this.ctx.globalAlpha = effect.value / 100;
    }

    let x = item.position.x;
    let y = item.position.y;

    if (item.hasEffect(RendererEffectType.PositionTo)) {
      const effect = item.getEffect(RendererEffectType.PositionTo);
      const timePassed = Date.now() - effect.startedAt;
      const delta = timePassed / effect.duration;

      x += (effect.to.x - x) * delta;
      y += (effect.to.y - y) * delta;
    }

    if (typeof item.data === "string") {
      this.ctx.fillStyle = item.data;
      this.ctx.fillRect(x, y, item.width, item.height);
      this.ctx.globalAlpha = 1;
      return;
    }

    let source: HTMLImageElement = item.data;

    if (item.hasEffect(RendererEffectType.AssetSwap)) {
      const effect = item.getEffect(RendererEffectType.AssetSwap);
      const assets = [item.data, ...effect.steps];
      const timePassed = Date.now() - effect.startedAt;
      const assetIdx = Math.floor((timePassed / effect.every) % assets.length);

      source = assets[assetIdx];
    }

    if (item.hasEffect(RendererEffectType.FlipHorizontal)) {
      this.ctx2.clearRect(0, 0, item.width, item.height);
      this.ctx2.save();
      this.ctx2.translate(item.width, 0);
      this.ctx2.scale(-1, 1);
      this.ctx2.drawImage(source, 0, 0, item.width, item.height);
      this.ctx2.restore();

      source = canvasToImage(this.canvas2);
    }

    if (item.hasEffect(RendererEffectType.HueRotate)) {
      const effect = item.getEffect(RendererEffectType.HueRotate);
      this.ctx2.clearRect(0, 0, item.width, item.height);

      this.ctx2.filter = `hue-rotate(${effect.degree}deg)`;
      this.ctx2.drawImage(source, 0, 0, item.width, item.height);
      this.ctx2.filter = "none";

      this.ctx2.globalCompositeOperation = "destination-in";
      this.ctx2.fillRect(0, 0, item.width, item.height);
      this.ctx2.globalCompositeOperation = "source-over";

      source = canvasToImage(this.canvas2);
    }

    this.ctx.drawImage(source, x, y, item.width, item.height);
    this.ctx.globalAlpha = 1;

    if (item.hasDisplayName()) {
      this.ctx.fillStyle = "#FFF";
      this.ctx.font = "18px Arial";
      this.ctx.fillText(item.getDisplayName(), x, y - 10);
    }
  }

  private getEntityImage(entity: Entity): HTMLImageElement | null {
    switch (entity.getType()) {
      case EntityType.Box: {
        return assets.box;
      }
      case EntityType.Landmine: {
        return assets.landmine;
      }
      case EntityType.Player: {
        return assets.player;
      }
      case EntityType.Rock: {
        // return assets.rock;
        return null;
      }
      case EntityType.Zombie: {
        if (entity.hasVisualEvent(VisualEventType.Destructured)) {
          return assets.zombieDead;
        } else if (entity.hasVisualEvent(VisualEventType.Moving)) {
          return assets.zombieWalkingFrame1;
        } else {
          return assets.zombieIdleFrame1;
        }
      }
    }
  }

  private async register(entities: Entity[]) {
    this.items = [];
    this.registerBg();

    for (const entity of entities) {
      this.registerEntity(entity);
    }
  }

  private async registerBg() {
    if (this.bgSprite === null) {
      return;
    }

    const rendererItem = new RendererItem(
      this.bgSprite,
      { x: 0, y: 0 },
      this.w,
      this.h,
    );

    this.items.push(rendererItem);
  }

  private registerEntity(entity: Entity) {
    const entityImage = this.getEntityImage(entity);

    if (entityImage === null) {
      return;
    }

    const animatableAfterDeath =
      entity.hasVisualEvents() &&
      ANIMATABLE_DEAD_ENTITIES.includes(entity.getType());

    if (entity.dead() && !animatableAfterDeath) {
      return;
    }

    const position: Position = {
      x: entity.getPosition().x * this.cellSize,
      y: entity.getPosition().y * this.cellSize,
    };

    const rendererItem = new RendererItem(
      entityImage,
      position,
      this.cellSize,
      this.cellSize,
      this.playerLabels ? this.playerLabels[entity.getToken()] : undefined,
    );

    if (entity.hasVisualEvent(VisualEventType.Moving)) {
      const visualEvent = entity.getVisualEvent(VisualEventType.Moving);
      const { to, from } = visualEvent;

      position.x = from.x * this.cellSize;
      position.y = from.y * this.cellSize;

      const positionToEffect: RendererEffect = {
        type: RendererEffectType.PositionTo,
        duration: this.replaySpeed,
        startedAt: Date.now(),
        to: {
          x: to.x * this.cellSize,
          y: to.y * this.cellSize,
        },
      };

      rendererItem.addEffect(positionToEffect);

      if (from.x >= to.x) {
        rendererItem.addEffect({
          type: RendererEffectType.FlipHorizontal,
        });
      }
    }

    if (
      entity.getType() === EntityType.Zombie &&
      entity.hasVisualEvent(VisualEventType.Moving)
    ) {
      if (
        assets.zombieWalkingFrame2 !== null &&
        assets.zombieWalkingFrame3 !== null &&
        assets.zombieWalkingFrame4 !== null
      ) {
        rendererItem.addEffect({
          type: RendererEffectType.AssetSwap,
          duration: this.replaySpeed,
          every: this.replaySpeed / 4,
          startedAt: Date.now(),
          steps: [
            assets.zombieWalkingFrame2,
            assets.zombieWalkingFrame3,
            assets.zombieWalkingFrame4,
          ],
        });
      }
    } else if (entity.getType() === EntityType.Zombie && !entity.dead()) {
      if (
        assets.zombieIdleFrame2 !== null &&
        assets.zombieIdleFrame3 !== null &&
        assets.zombieIdleFrame4 !== null
      ) {
        rendererItem.addEffect({
          type: RendererEffectType.AssetSwap,
          duration: this.replaySpeed,
          every: this.replaySpeed / 4,
          startedAt: Date.now(),
          steps: [
            assets.zombieIdleFrame2,
            assets.zombieIdleFrame3,
            assets.zombieIdleFrame4,
          ],
        });
      }
    }

    this.items.push(rendererItem);

    if (entity.getType() === EntityType.Zombie && !entity.dead()) {
      const healthBarItem = new RendererItem(
        "#F00",
        {
          x: position.x + this.cellSize * 0.1,
          y: position.y,
        },
        (entity.getHealth() / Zombie.Health) * (this.cellSize * 0.8),
        2,
      );

      const healthBarBgItem = new RendererItem(
        "#FFF",
        {
          x: position.x + this.cellSize * 0.1,
          y: position.y,
        },
        this.cellSize * 0.8,
        2,
      );

      if (entity.hasVisualEvent(VisualEventType.Moving)) {
        const visualEvent = entity.getVisualEvent(VisualEventType.Moving);
        const { to } = visualEvent;

        const positionToEffect: RendererEffect = {
          type: RendererEffectType.PositionTo,
          duration: this.replaySpeed,
          startedAt: Date.now(),
          to: {
            x: to.x * this.cellSize + this.cellSize * 0.1,
            y: to.y * this.cellSize,
          },
        };

        healthBarItem.addEffect(positionToEffect);
        healthBarBgItem.addEffect(positionToEffect);
      }

      this.items.push(healthBarBgItem);
      this.items.push(healthBarItem);
    }
  }

  private shouldAnimate(): boolean {
    for (const item of this.items) {
      if (item.effects.length === 0) {
        continue;
      }

      for (const effect of item.effects) {
        if (
          effect.type === RendererEffectType.AssetSwap ||
          effect.type === RendererEffectType.PositionTo
        ) {
          if (Date.now() < effect.startedAt + effect.duration) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
