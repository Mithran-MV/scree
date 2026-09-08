import Phaser from "phaser";
import { FX, MONSTERS, SHEET } from "./figures";
import { LAYOUT } from "./layout";

const SCALE = LAYOUT.scale;
type Spec = (typeof MONSTERS.kinds)[number];
type Phase = "swim" | "diving" | "under" | "surfacing";

export interface MonsterHooks {
  /** A random point in deep water, well away from any shore. */
  pickWaypoint: () => { x: number; y: number };
  /** Y-sorted depth for something standing at world y. */
  depthAt: (y: number) => number;
  onHover: (monster: SeaMonster, entered: boolean, pointer: Phaser.Input.Pointer) => void;
  onClick: (monster: SeaMonster, pointer: Phaser.Input.Pointer) => void;
}

/**
 * A leviathan of the deep: a physics sprite off the derived monster sheet
 * that patrols the deep water by tween, trails bubbles while it swims, dives
 * and surfaces on its own clock, and splashes when it breaks the surface.
 */
export class SeaMonster extends Phaser.Physics.Arcade.Sprite {
  readonly spec: Spec;
  private phase: Phase = "swim";
  private leg: Phaser.Tweens.Tween | undefined;
  private clock: Phaser.Time.TimerEvent | undefined;
  private readonly bubbles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly splash: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly hooks: MonsterHooks;

  static registerAnimations(scene: Phaser.Scene): void {
    for (const kind of MONSTERS.kinds) {
      const base = kind.row * 12;
      const add = (name: string, start: number, end: number, frameRate: number, repeat: number) => {
        const key = `${kind.key}-${name}`;
        if (!scene.anims.exists(key)) {
          scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(SHEET.monsters, { start: base + start, end: base + end }), frameRate, repeat });
        }
      };
      add("idle_swim", 0, 3, 5, -1);
      add("dive", 4, 7, 7, 0);
      add("surface", 8, 11, 7, 0);
    }
  }

  constructor(scene: Phaser.Scene, x: number, y: number, spec: Spec, hooks: MonsterHooks) {
    super(scene, x, y, SHEET.monsters, spec.row * 12);
    this.spec = spec;
    this.hooks = hooks;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(SCALE * 1.5).setDepth(hooks.depthAt(y));
    this.setInteractive({ useHandCursor: true });
    this.on("pointerover", (p: Phaser.Input.Pointer) => this.hooks.onHover(this, true, p));
    this.on("pointerout", (p: Phaser.Input.Pointer) => this.hooks.onHover(this, false, p));
    this.on("pointerdown", (p: Phaser.Input.Pointer) => this.hooks.onClick(this, p));

    // A thin trail of bubbles from under the body while it swims.
    this.bubbles = scene.add.particles(0, 0, SHEET.fx, {
      frame: FX.bubble,
      lifespan: { min: 900, max: 1700 },
      speedY: { min: -18, max: -36 },
      speedX: { min: -8, max: 8 },
      scale: { start: SCALE * 0.35, end: SCALE * 0.8 },
      alpha: { start: 0.85, end: 0 },
      frequency: 260,
      quantity: 1,
    });
    this.bubbles.setDepth(hooks.depthAt(y) + 0.01);
    this.bubbles.startFollow(this, 0, SCALE * 5);

    // The splash when it breaks the surface: a burst that falls back in.
    this.splash = scene.add.particles(0, 0, SHEET.fx, {
      frame: FX.droplet,
      lifespan: { min: 380, max: 620 },
      speed: { min: 90, max: 240 },
      angle: { min: 200, max: 340 },
      gravityY: 620,
      scale: { start: SCALE * 0.9, end: SCALE * 0.3 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.splash.setDepth(hooks.depthAt(y) + 0.02);

    this.play(`${spec.key}-idle_swim`);
    this.nextLeg();
    this.scheduleDive();
  }

  get submerged(): boolean {
    return this.phase === "under" || this.phase === "diving";
  }

  /** Pick the next waypoint in deep water and swim there. */
  private nextLeg(): void {
    if (!this.active) return;
    const target = this.hooks.pickWaypoint();
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    this.setFlipX(target.x < this.x);
    this.leg = this.scene.tweens.add({
      targets: this,
      x: target.x,
      y: target.y,
      duration: Math.max(1500, (dist / (9 * SCALE)) * 1000),
      ease: "Sine.InOut",
      onUpdate: () => {
        const d = this.hooks.depthAt(this.y);
        this.setDepth(d);
        this.bubbles.setDepth(d + 0.01);
      },
      onComplete: () => this.nextLeg(),
    });
  }

  private scheduleDive(): void {
    this.clock = this.scene.time.delayedCall(Phaser.Math.Between(4000, 9000), () => this.dive());
  }

  private dive(): void {
    if (!this.active || this.phase !== "swim") return;
    this.phase = "diving";
    this.bubbles.stop();
    this.play(`${this.spec.key}-dive`);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.phase = "under";
      this.setVisible(false);
      this.clock = this.scene.time.delayedCall(Phaser.Math.Between(1800, 4500), () => this.surface());
    });
  }

  private surface(): void {
    if (!this.active) return;
    this.phase = "surfacing";
    this.setVisible(true);
    this.splash.setDepth(this.depth + 0.02);
    this.splash.explode(22, this.x, this.y + SCALE * 3);
    this.play(`${this.spec.key}-surface`);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.phase = "swim";
      this.play(`${this.spec.key}-idle_swim`);
      this.bubbles.start();
      this.scheduleDive();
    });
  }

  override destroy(fromScene?: boolean): void {
    this.leg?.destroy();
    this.clock?.remove(false);
    this.bubbles.destroy();
    this.splash.destroy();
    super.destroy(fromScene);
  }
}
