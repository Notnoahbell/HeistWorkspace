// Figma-style smoothed corners ("corner smoothing"), which CSS border-radius
// can't do. Produces a clip-path for a square of a given size.

import { getSvgPath } from 'figma-squircle';

const SMOOTHING = 0.6;
const cache = new Map<string, string>();

/** SVG path for a `size`×`size` smoothed square with the given corner radius. */
export function squirclePath(size: number, radius = size * 0.25): string {
  const key = `${size}/${radius}`;
  let d = cache.get(key);
  if (!d) {
    d = getSvgPath({ width: size, height: size, cornerRadius: radius, cornerSmoothing: SMOOTHING });
    cache.set(key, d);
  }
  return d;
}

/** clip-path value for a `size`×`size` square, 25% radius, 60% smoothing. */
export const squircleClip = (size: number) => `path('${squirclePath(size)}')`;
