import type { SpritePose, SpriteSheet } from '../../shared/types/game';

const POSE_ORDER: SpritePose[] = ['idle', 'attack', 'hurt', 'block', 'death'];
const NUM_POSES = POSE_ORDER.length;

/**
 * Chroma-key green background removal with despill and edge erosion.
 * Runs on raw ImageData (Canvas API) — browser equivalent of the sharp-based test script approach.
 */
function chromaKeyRemoveBackground(imageData: ImageData): void {
  const { data, width, height } = imageData;

  // Pass 1: Chroma key — make green pixels transparent + despill
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    const maxRB = Math.max(r, b);
    if (g > 60 && g > maxRB * 1.15) {
      const greenExcess = g - maxRB;
      const greenRatio = greenExcess / g;
      const newAlpha = Math.max(0, Math.round(255 * (1 - greenRatio * 1.8)));
      data[idx + 3] = newAlpha;

      // Despill: clamp green to max(r, b) for semi-transparent edge pixels
      if (newAlpha > 0) {
        data[idx + 1] = Math.min(g, maxRB);
      }
    }
  }

  // Pass 2: Edge erosion — reduce alpha of pixels adjacent to transparent ones
  const alphaMap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alphaMap[i] = data[i * 4 + 3];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (alphaMap[i] === 0) continue;

      let hasTransparentNeighbor = false;
      for (let dy = -1; dy <= 1 && !hasTransparentNeighbor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (alphaMap[ny * width + nx] === 0) {
            hasTransparentNeighbor = true;
            break;
          }
        }
      }

      if (hasTransparentNeighbor) {
        const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (g > Math.max(r, b)) {
          const greenTint = (g - Math.max(r, b)) / 255;
          data[idx + 3] = Math.max(0, Math.round(a * (1 - greenTint * 2)));
          data[idx + 1] = Math.min(g, Math.max(r, b));
        }
      }
    }
  }
}

/**
 * Slices a horizontal sprite sheet into individual pose images.
 * Applies chroma-key green background removal, then uses valley-finding
 * on the opacity profile to detect divider positions between poses.
 * Falls back to equal-width division when detection fails.
 */
export async function sliceSpriteSheet(sheetDataUrl: string): Promise<SpriteSheet | null> {
  try {
    const img = await loadImage(sheetDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0);

    // Apply chroma-key background removal before slicing
    const fullImageData = ctx.getImageData(0, 0, img.width, img.height);
    chromaKeyRemoveBackground(fullImageData);
    ctx.putImageData(fullImageData, 0, 0);

    let effectiveHeight = img.height;
    let imageData = ctx.getImageData(0, 0, img.width, img.height);

    // Always check for multiple rows — Gemini sometimes generates 2 rows
    const rowSplit = detectHorizontalSplit(imageData, img.width, img.height);
    if (rowSplit > 0) {
      console.log(`spriteSheetSlicer: multi-row detected, cropping to top row (height ${img.height} -> ${rowSplit})`);
      effectiveHeight = rowSplit;
      imageData = ctx.getImageData(0, 0, img.width, effectiveHeight);
    }

    // Detect divider positions using valley-finding
    const dividers = detectDividerPositions(imageData, img.width, effectiveHeight);

    let panels: { start: number; end: number }[];
    if (dividers.length === NUM_POSES - 1) {
      panels = [];
      let prevX = 0;
      for (const d of dividers) {
        panels.push({ start: prevX, end: d.x });
        prevX = d.x;
      }
      panels.push({ start: prevX, end: img.width });
    } else {
      console.warn(`spriteSheetSlicer: found ${dividers.length} dividers (expected ${NUM_POSES - 1}), using equal split`);
      const pw = Math.floor(img.width / NUM_POSES);
      panels = [];
      for (let i = 0; i < NUM_POSES; i++) {
        panels.push({ start: i * pw, end: i === NUM_POSES - 1 ? img.width : (i + 1) * pw });
      }
    }

    // Find global vertical content bounds for uniform height
    let globalTop = effectiveHeight;
    let globalBottom = 0;
    const panelBounds: (ReturnType<typeof findContentBounds>)[] = [];

    for (const panel of panels) {
      const bounds = findContentBounds(imageData, img.width, panel.start, 0, panel.end - panel.start, effectiveHeight);
      panelBounds.push(bounds);
      if (bounds) {
        if (bounds.top < globalTop) globalTop = bounds.top;
        if (bounds.bottom > globalBottom) globalBottom = bounds.bottom;
      }
    }

    const topPadding = Math.max(0, Math.floor(globalTop * 0.5));
    const cropTop = Math.max(0, globalTop - topPadding);
    const uniformHeight = effectiveHeight - cropTop;

    const poses: Partial<Record<SpritePose, string>> = {};

    for (let i = 0; i < NUM_POSES; i++) {
      const panel = panels[i];
      const bounds = panelBounds[i];

      let contentLeft = panel.start;
      let contentRight = panel.end;
      if (bounds) {
        contentLeft = bounds.left;
        contentRight = bounds.right;
      }
      const contentWidth = contentRight - contentLeft;
      const hPad = Math.max(4, Math.floor(contentWidth * 0.1));
      const finalLeft = Math.max(panel.start, contentLeft - hPad);
      const finalRight = Math.min(panel.end, contentRight + hPad);
      const finalWidth = finalRight - finalLeft;

      const poseCanvas = document.createElement('canvas');
      poseCanvas.width = finalWidth;
      poseCanvas.height = uniformHeight;
      const poseCtx = poseCanvas.getContext('2d');
      if (!poseCtx) continue;

      poseCtx.clearRect(0, 0, finalWidth, uniformHeight);
      poseCtx.drawImage(
        canvas,
        finalLeft, cropTop, finalWidth, uniformHeight,
        0, 0, finalWidth, uniformHeight,
      );

      poses[POSE_ORDER[i]] = poseCanvas.toDataURL('image/png');
    }

    console.log(`spriteSheetSlicer: sliced ${NUM_POSES} poses (dividers: ${dividers.map(d => d.x).join(', ')})`);
    return { sheetUrl: sheetDataUrl, poses };
  } catch (err) {
    console.warn('spriteSheetSlicer: slicing failed', err);
    return null;
  }
}

/**
 * Valley-finding divider detection on the opacity profile.
 * Computes opacity per column, smooths it, then finds the N-1 deepest
 * valleys (most transparent points) as divider positions.
 */
function detectDividerPositions(
  imageData: ImageData,
  width: number,
  height: number,
): { x: number; opacity: number }[] {
  const { data } = imageData;
  const rowStep = Math.max(1, Math.floor(height / 150));

  // 1. Compute opacity ratio per column
  const opacityProfile = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let opaqueCount = 0;
    let sampledCount = 0;
    for (let y = 0; y < height; y += rowStep) {
      const alpha = data[(y * width + x) * 4 + 3];
      sampledCount++;
      if (alpha > 30) opaqueCount++;
    }
    opacityProfile[x] = opaqueCount / sampledCount;
  }

  // 2. Smooth with box filter
  const kernelSize = Math.max(3, Math.floor(width / 200));
  const smoothed = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let k = -kernelSize; k <= kernelSize; k++) {
      const xx = x + k;
      if (xx >= 0 && xx < width) { sum += opacityProfile[xx]; count++; }
    }
    smoothed[x] = sum / count;
  }

  // 3. Find valleys (local minima), excluding edges
  const edgeMargin = Math.floor(width * 0.05);
  const minSpacing = Math.floor(width / (NUM_POSES + 1) * 0.4);
  const windowSize = Math.max(5, Math.floor(width / 100));

  const valleys: { x: number; opacity: number }[] = [];
  for (let x = edgeMargin; x < width - edgeMargin; x++) {
    let isMin = true;
    for (let k = 1; k <= windowSize; k++) {
      if (x - k >= 0 && smoothed[x] > smoothed[x - k]) { isMin = false; break; }
      if (x + k < width && smoothed[x] > smoothed[x + k]) { isMin = false; break; }
    }
    if (isMin) valleys.push({ x, opacity: smoothed[x] });
  }

  // 4. Pick N-1 deepest valleys with minimum spacing
  valleys.sort((a, b) => a.opacity - b.opacity);
  const picked: typeof valleys = [];
  for (const v of valleys) {
    if (picked.length >= NUM_POSES - 1) break;
    const tooClose = picked.some(p => Math.abs(p.x - v.x) < minSpacing);
    if (!tooClose) picked.push(v);
  }

  return picked.sort((a, b) => a.x - b.x);
}

/**
 * Detect a horizontal transparent band that splits the image into two rows of content.
 * Only returns a split if there is significant opaque content BOTH above and below the gap.
 */
function detectHorizontalSplit(imageData: ImageData, width: number, height: number): number {
  const { data } = imageData;
  const colStep = Math.max(1, Math.floor(width / 200));

  // Find the vertical extent of content (top-most and bottom-most opaque rows)
  let contentTop = height;
  let contentBottom = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += colStep) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 30) {
        if (y < contentTop) contentTop = y;
        if (y > contentBottom) contentBottom = y;
      }
    }
  }

  if (contentTop >= contentBottom) return 0;

  // Search for a transparent horizontal band within the content range
  const searchStart = contentTop + Math.floor((contentBottom - contentTop) * 0.25);
  const searchEnd = contentTop + Math.floor((contentBottom - contentTop) * 0.75);

  let gapStart = -1;
  let gapEnd = -1;

  for (let y = searchStart; y < searchEnd; y++) {
    let transparentCount = 0;
    let sampledCount = 0;
    for (let x = 0; x < width; x += colStep) {
      const alpha = data[(y * width + x) * 4 + 3];
      sampledCount++;
      if (alpha < 30) transparentCount++;
    }
    const isTransparent = transparentCount / sampledCount > 0.9;

    if (isTransparent) {
      if (gapStart === -1) gapStart = y;
      gapEnd = y;
    } else if (gapStart !== -1) {
      if (gapEnd - gapStart >= 5) break;
      gapStart = -1;
      gapEnd = -1;
    }
  }

  if (gapStart === -1 || gapEnd - gapStart < 5) return 0;

  // Verify content exists both above AND below the gap
  let aboveContent = 0, aboveTotal = 0;
  for (let y = contentTop; y < gapStart; y += 3) {
    for (let x = 0; x < width; x += colStep) {
      aboveTotal++;
      if (data[(y * width + x) * 4 + 3] > 30) aboveContent++;
    }
  }

  let belowContent = 0, belowTotal = 0;
  for (let y = gapEnd + 1; y <= contentBottom; y += 3) {
    for (let x = 0; x < width; x += colStep) {
      belowTotal++;
      if (data[(y * width + x) * 4 + 3] > 30) belowContent++;
    }
  }

  // Need at least 3% opaque pixels on BOTH sides
  const aboveRatio = aboveTotal > 0 ? aboveContent / aboveTotal : 0;
  const belowRatio = belowTotal > 0 ? belowContent / belowTotal : 0;

  if (aboveRatio < 0.03 || belowRatio < 0.03) return 0;

  return gapStart;
}

/** Find bounding box of non-transparent pixels within a region. */
function findContentBounds(
  imageData: ImageData,
  fullWidth: number,
  rx: number, ry: number,
  rw: number, rh: number,
): { top: number; bottom: number; left: number; right: number } | null {
  const { data } = imageData;
  let top = ry + rh, bottom = ry, left = rx + rw, right = rx;

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const absX = rx + x;
      const absY = ry + y;
      const alpha = data[(absY * fullWidth + absX) * 4 + 3];
      if (alpha > 20) {
        if (absY < top) top = absY;
        if (absY > bottom) bottom = absY;
        if (absX < left) left = absX;
        if (absX > right) right = absX;
      }
    }
  }

  if (top >= bottom) return null;
  return { top, bottom, left, right };
}

/** Load an image from a data URL and return an HTMLImageElement. */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load sprite sheet image'));
    img.src = dataUrl;
  });
}
