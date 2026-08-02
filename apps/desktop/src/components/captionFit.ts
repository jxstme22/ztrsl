const FIT_MIN_SCALE = 0.7;
const FIT_SHRINK_START = 60;
const FIT_SHRINK_FLOOR = 140;

/** Scale factor that shrinks a caption's font as its text grows, so long
    captions stay inside the fixed caption card instead of resizing it. */
export function fitScaleForLength(length: number): number {
  if (length <= FIT_SHRINK_START) return 1;
  const span = FIT_SHRINK_FLOOR - FIT_SHRINK_START;
  const t = Math.min(1, (length - FIT_SHRINK_START) / span);
  const scale = 1 - t * (1 - FIT_MIN_SCALE);
  return Math.round(scale * 100) / 100;
}
