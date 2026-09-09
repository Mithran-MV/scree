import Phaser from "phaser";
import { SHEET, SURVEYOR } from "./figures";
import { LAYOUT } from "./layout";

const SCALE = LAYOUT.scale;
const ANIM = (row: (typeof SURVEYOR.rows)[number]) => `surveyor-${row}`;

/**
 * The surveyor: a 32×40 sprite off the baked sheet, with an idle that
 * breathes, blinks and taps the staff, eight-frame walks in four directions,
 * a shadow on the ground and a survey mark that pulses under his feet.
 * `walkTo` plays the walk for the leg and returns him to idle on arrival;
 * the world sets his depth every frame from his feet.
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
        frames: scene.anims.generateFrameNumbers(SHEET.surveyor, { start: i * SURVEYOR.perRow, end: i * SURVEYOR.perRow + SURVEYOR.perRow - 1 }),
        frameRate: row === "idle" ? 6 : 12,
        repeat: -1,
      });
    });
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, SHEET.surveyor, 0);
    scene.add.existing(this);
    this.setOrigin(0.5, 1).setScale(SCALE);
    this.setInteractive({ useHandCursor: true });
    this.shadow = scene.add.ellipse(x, y - SCALE, SCALE * 22, SCALE * 7, 0x000000, 0.38);
    this.mark = scene.add.circle(x, y - SCALE, SCALE * 5, 0x35e0e8, 0).setStrokeStyle(2, 0x35e0e8, 0.7);
    scene.tweens.add({ targets: this.mark, scale: { from: 0.7, to: 2.4 }, alpha: { from: 0.8, to: 0 }, duration: 2000, repeat: -1, ease: "Quad.Out" });
    this.play(ANIM("idle"));
  }

  /** The shadow follows the feet exactly; the mark rides with it. */
  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    this.shadow.setPosition(this.x, this.y - SCALE);
    this.mark.setPosition(this.x, this.y - SCALE);
  }

  /** Depth from the feet: the shadow just under him, the mark under the shadow. */
  setGroundDepth(depth: number): this {
    this.setDepth(depth);
    this.shadow.setDepth(depth - 0.0005);
    this.mark.setDepth(depth - 0.001);
    return this;
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
