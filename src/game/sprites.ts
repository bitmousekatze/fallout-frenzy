import doggoFront1 from "@/assets/doggo/FrontWalk1.png";
import doggoFront2 from "@/assets/doggo/FrontWalk2.png";
import doggoBack1 from "@/assets/doggo/BackWalk1.png";
import doggoBack2 from "@/assets/doggo/BackWalk2.png";
import doggoLeft1 from "@/assets/doggo/LeftWalk1.png";
import doggoLeft2 from "@/assets/doggo/LeftWalk2.png";
import doggoRight1 from "@/assets/doggo/RightWalk1.png";
import doggoRight2 from "@/assets/doggo/RightWalk2.png";
import front1 from "@/assets/player/front1.png";
import front2 from "@/assets/player/front2.png";
import back1 from "@/assets/player/back1.png";
import back2 from "@/assets/player/back2.png";
import left1 from "@/assets/player/left1.png";
import left2 from "@/assets/player/left2.png";
import right1 from "@/assets/player/right1.png";
import right2 from "@/assets/player/right2.png";
import up1 from "@/assets/player/up1.png";
import up2 from "@/assets/player/up2.png";

export type Facing = "down" | "up" | "left" | "right" | "back";

function load(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

// Two-frame walk cycles per facing direction.
// "down" = facing camera (front), "back" = idle back-turned, "up" = walking away
export const playerSprites: Record<Facing, [HTMLImageElement, HTMLImageElement]> = {
  down: [load(front1), load(front2)],
  back: [load(back1), load(back2)],
  left: [load(left1), load(left2)],
  right: [load(right1), load(right2)],
  up: [load(up1), load(up2)],
};

export const doggoSprites: Record<"down" | "up" | "left" | "right", [HTMLImageElement, HTMLImageElement]> = {
  down:  [load(doggoFront1), load(doggoFront2)],
  up:    [load(doggoBack1),  load(doggoBack2)],
  left:  [load(doggoLeft1),  load(doggoLeft2)],
  right: [load(doggoRight1), load(doggoRight2)],
};
