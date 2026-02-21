import type { Camera } from "@/lib/collab";

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function frameToCamera(
  frame: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  padding = 64
): Camera {
  const availableWidth = Math.max(1, viewport.width - 2 * padding);
  const availableHeight = Math.max(1, viewport.height - 2 * padding);
  const scale = clamp(
    Math.min(availableWidth / frame.width, availableHeight / frame.height),
    MIN_SCALE,
    MAX_SCALE
  );
  return {
    x: viewport.width / 2 - (frame.x + frame.width / 2) * scale,
    y: viewport.height / 2 - (frame.y + frame.height / 2) * scale,
    scale,
  };
}

export function animateCamera(
  from: Camera,
  to: Camera,
  applyCameraDirect: (cam: Camera) => void,
  setCameraState: (cam: Camera) => void,
  duration = 600,
  onComplete?: () => void
): () => void {
  const start = performance.now();
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(t);

    const cam: Camera = {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
      scale: from.scale + (to.scale - from.scale) * eased,
    };
    applyCameraDirect(cam);

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      setCameraState(to);
      onComplete?.();
    }
  };

  requestAnimationFrame(tick);

  return () => {
    cancelled = true;
  };
}
