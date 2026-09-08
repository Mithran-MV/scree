import Phaser from "phaser";
import { SHEET, SURVEYOR } from "./figures";
import { LAYOUT } from "./layout";

const SCALE = LAYOUT.scale;
const ANIM = (row: (typeof SURVEYOR.rows)[number]) => `surveyor-${row}`;

/**
 * The surveyor: a sprite off the derived walk-cycle sheet, with a shadow on
 * the ground and a survey mark that pulses under his feet. `walkTo` plays the
 * directional walk for the leg and returns him to idle on arrival.
 */
export class Surveyor extends Phaser.GameObjects.Sprite {
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly mark: Phaser.GameObjects.Arc;
  private walk: Phaser.Tweens.Tween | undefined;

  static registerAnimations(scene: Phaser.Scene): void {
    SURVEYOR.rows.forEach((row, i) => {
      const key = ANIM(row);
      if (scene.anims.exists(key)) return;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(SHEET.surveyor, { start: i * 4, end: i * 4 + 3 }),
        frameRate: row === "idle" ? 3 : 8,
        repeat: -1,
      });
    });
  }

  constructor(scene: Phaser.Scene, x: number, y: number, depth: number) {
    super(scene, x, y, SHEET.surveyor, 0);
    scene.add.existing(this);
    this.setOrigin(0.5, 1).setScale(SCALE * 1.1).setDepth(depth);
    this.shadow = scene.add.ellipse(x, y - SCALE, SCALE * 11, SCALE * 4, 0x000000, 0.38).setDepth(depth - 0.2);
    this.mark = scene.add.circle(x, y - SCALE, SCALE * 4, 0x35e0e8, 0).setStrokeStyle(2, 0x35e0e8, 0.7).setDepth(depth - 0.1);
    scene.tweens.add({ targets: this.mark, scale: { from: 0.7, to: 2.2 }, alpha: { from: 0.8, to: 0 }, duration: 2000, repeat: -1, ease: "Quad.Out" });
    this.play(ANIM("idle"));
  }

  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    this.shadow.setPosition(this.x, this.y - SCALE);
    this.mark.setPosition(this.x, this.y - SCALE);
  }

  get walking(): boolean {
    return this.walk?.isPlaying() ?? false;
  }

  /** Walk to a world point at `speed` px/s; `onArrive` fires when he stops. */
  walkTo(x: number, y: number, speed: number, onArrive: () => void): void {
    this.walk?.destroy();
    const dx = x - this.x;
    const dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "walk_left" : "walk_right") : dy < 0 ? "walk_up" : "walk_down";
    this.play(ANIM(dir), true);
    this.walk = this.scene.tweens.add({
      targets: this,
      x,
      y,
      duration: Math.max(120, (dist / speed) * 1000),
      ease: "Linear",
      onComplete: () => {
        this.play(ANIM("idle"), true);
        onArrive();
      },
    });
  }

  override destroy(fromScene?: boolean): void {
    this.shadow.destroy();
    this.mark.destroy();
    super.destroy(fromScene);
  }
}
