#!/usr/bin/env node
/**
 * Test script for sprite sheet generation pipeline.
 * Generates a sprite sheet image via Gemini, removes background, slices into poses, and saves all files.
 *
 * Usage:
 *   node scripts/test-sprite-sheet.mjs [character-description]
 *
 * Examples:
 *   node scripts/test-sprite-sheet.mjs "a dark knight in black armor"
 *   node scripts/test-sprite-sheet.mjs                                  # uses default
 *
 * Output goes to: test-output/sprite-sheets/<timestamp>/
 */

import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import dotenv from 'dotenv';

// Load env vars
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local'), override: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY or GOOGLE_API_KEY must be set in .env or .env.local');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ─── Prompt builders (mirrors geminiService.ts) ───

function buildSpriteSheetPrompt(characterDesc) {
  const prefix = "A 2D video game character sprite sheet, clean lines, flat colors, solid green screen background (#00FF00), highly detailed. ";

  const characterBase = `A character sprite of ${characterDesc}, facing right, looking right, side profile, on a solid green background (#00FF00), 2D vector art.`;

  const sheetSuffix = `
IMPORTANT: Generate exactly 5 poses of the SAME character arranged in a SINGLE HORIZONTAL ROW from left to right. Do NOT use multiple rows — all 5 poses must be in ONE row side by side. The image should be very wide (landscape orientation).

Think of the image as divided into 5 EQUAL columns. Each character pose must be CENTERED within its column and must NOT extend beyond its column boundaries. This ensures equal spacing between all poses.

Column 1: Idle standing pose (centered)
Column 2: Attack / action pose (centered)
Column 3: Hurt / taking damage pose (centered)
Column 4: Defensive / blocking pose (centered)
Column 5: Defeated / collapsed on the ground (centered)

CRITICAL SIZE AND SPACING RULES:
- Each character (with ALL weapons, capes, shields, limbs) must fit within 50% of one column width — leaving 25% empty green space on each side
- NO part of any pose may overlap or touch an adjacent pose — there must be CLEAR green gap between every pair of poses
- The ENTIRE character with all accessories must be FULLY visible — NOTHING cropped at any edge
- Leave at least 15% green margin at top and bottom
- NO divider lines, NO borders, NO frames — only solid green (#00FF00) gaps between poses
- NO text labels, NO sound effects text, NO decorative elements
- Keep consistent character design, proportions, and scale across all 5 poses
- The green (#00FF00) background must be uniform and solid everywhere`;

  return `${prefix}${characterBase} ${sheetSuffix}`;
}

// ─── Image generation ───

async function generateSpriteSheetImage(prompt) {
  console.log('Generating sprite sheet via Gemini...');
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: { parts: [{ text: prompt }] },
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '16:9',
      },
    },
  });

  const candidates = response?.candidates;
  if (!candidates?.length) throw new Error('No candidates in response');

  for (const candidate of candidates) {
    const parts = candidate.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
      }
    }
  }
  throw new Error('No image found in response');
}

// ─── Chroma-key green background removal with despill ───

async function removeGreenAndDarkBackground(buffer) {
  console.log('Removing green background (chroma key + despill)...');
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const output = Buffer.from(data);

  // Pass 1: Chroma key — make green pixels transparent
  for (let i = 0; i < width * height; i++) {
    const idx = i * channels;
    const r = output[idx];
    const g = output[idx + 1];
    const b = output[idx + 2];

    // Green-screen detection: green channel dominant
    const maxRB = Math.max(r, b);
    if (g > 60 && g > maxRB * 1.15) {
      // Stronger greenness = more transparent
      const greenExcess = g - maxRB;
      const greenRatio = greenExcess / g; // 0-1
      const newAlpha = Math.max(0, Math.round(255 * (1 - greenRatio * 1.8)));
      output[idx + 3] = newAlpha;

      // Despill: remove green tint from semi-transparent edge pixels
      if (newAlpha > 0) {
        // Clamp green channel to max of red and blue to neutralize green cast
        output[idx + 1] = Math.min(g, Math.max(r, b));
      }
    }
  }

  // Pass 2: Edge erosion — find pixels adjacent to transparent pixels and
  // reduce their alpha to eliminate 1px green fringe
  const alphaMap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alphaMap[i] = output[i * channels + 3];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (alphaMap[i] === 0) continue; // already transparent

      // Check if any neighbor is fully transparent
      let hasTransparentNeighbor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (alphaMap[ny * width + nx] === 0) {
            hasTransparentNeighbor = true;
            break;
          }
        }
        if (hasTransparentNeighbor) break;
      }

      if (hasTransparentNeighbor) {
        const idx = i * channels;
        const r = output[idx];
        const g = output[idx + 1];
        const b = output[idx + 2];
        const a = output[idx + 3];

        // Reduce alpha for edge pixels that still have green tint
        if (g > Math.max(r, b)) {
          const greenTint = (g - Math.max(r, b)) / 255;
          output[idx + 3] = Math.max(0, Math.round(a * (1 - greenTint * 2)));
          // Despill edge pixel
          output[idx + 1] = Math.min(g, Math.max(r, b));
        }
      }
    }
  }

  return { buffer: output, width, height, channels };
}

// ─── Slicer ───

const POSE_ORDER = ['idle', 'attack', 'hurt', 'block', 'death'];
const NUM_POSES = POSE_ORDER.length;

/**
 * After bg removal, gaps between poses become transparent columns.
 * Uses a "valley finding" approach: compute opacity density per column,
 * smooth it, then find the N-1 deepest valleys as divider positions.
 * This works even when poses are close together.
 */
function detectDividerPositions(rawPixels, width, height, channels) {
  // 1. Compute opacity ratio per column (0 = fully transparent, 1 = fully opaque)
  const opacityProfile = new Float32Array(width);
  const rowStep = Math.max(1, Math.floor(height / 150));

  for (let x = 0; x < width; x++) {
    let opaqueCount = 0;
    let sampledCount = 0;
    for (let y = 0; y < height; y += rowStep) {
      const idx = (y * width + x) * channels;
      const a = channels === 4 ? rawPixels[idx + 3] : 255;
      sampledCount++;
      if (a > 30) opaqueCount++;
    }
    opacityProfile[x] = opaqueCount / sampledCount;
  }

  // 2. Smooth the profile with a box filter to reduce noise
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

  // 3. Find valleys: local minima in the smoothed profile
  //    Exclude edges (first/last 5% of image)
  const edgeMargin = Math.floor(width * 0.05);
  const minSpacing = Math.floor(width / (NUM_POSES + 1) * 0.4); // min distance between dividers

  // Collect all local minima with their opacity value
  const valleys = [];
  for (let x = edgeMargin; x < width - edgeMargin; x++) {
    // Is this a local minimum? (lower than neighbors within a window)
    const windowSize = Math.max(5, Math.floor(width / 100));
    let isMin = true;
    for (let k = 1; k <= windowSize; k++) {
      if (x - k >= 0 && smoothed[x] > smoothed[x - k]) { isMin = false; break; }
      if (x + k < width && smoothed[x] > smoothed[x + k]) { isMin = false; break; }
    }
    if (isMin) {
      valleys.push({ x, opacity: smoothed[x] });
    }
  }

  // 4. Sort valleys by opacity (most transparent first) and pick N-1
  valleys.sort((a, b) => a.opacity - b.opacity);

  const picked = [];
  for (const v of valleys) {
    if (picked.length >= NUM_POSES - 1) break;
    // Ensure minimum spacing from already-picked dividers
    const tooClose = picked.some(p => Math.abs(p.x - v.x) < minSpacing);
    if (!tooClose) picked.push(v);
  }

  picked.sort((a, b) => a.x - b.x);
  console.log(`  Divider positions: ${picked.map(p => `x=${p.x} (opacity=${p.opacity.toFixed(3)})`).join(', ')}`);
  return picked;
}

/**
 * Build panel boundaries from divider x-positions.
 * Panels span from one divider to the next.
 */
function buildPanelsFromDividers(dividers, width) {
  if (dividers.length === NUM_POSES - 1) {
    const panels = [];
    let prevX = 0;
    for (const d of dividers) {
      panels.push({ start: prevX, end: d.x });
      prevX = d.x;
    }
    panels.push({ start: prevX, end: width });
    return panels;
  }

  // Fallback: equal split
  console.log('  Falling back to equal-width split');
  const poseWidth = Math.floor(width / NUM_POSES);
  const panels = [];
  for (let i = 0; i < NUM_POSES; i++) {
    panels.push({ start: i * poseWidth, end: i === NUM_POSES - 1 ? width : (i + 1) * poseWidth });
  }
  return panels;
}

/**
 * Detect a horizontal transparent band that splits the image into two rows of content.
 * Only returns a split if there is significant opaque content BOTH ABOVE and BELOW the gap.
 * Returns the y-coordinate where the top row ends, or 0 if no split found.
 */
function detectHorizontalSplit(rawPixels, width, height, channels) {
  const colStep = Math.max(1, Math.floor(width / 200));

  // First, find the vertical extent of content (top-most and bottom-most opaque rows)
  let contentTop = height;
  let contentBottom = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += colStep) {
      const idx = (y * width + x) * channels;
      const a = channels === 4 ? rawPixels[idx + 3] : 255;
      if (a > 30) {
        if (y < contentTop) contentTop = y;
        if (y > contentBottom) contentBottom = y;
      }
    }
  }

  if (contentTop >= contentBottom) return 0;

  // Search for a transparent horizontal band within the content range
  // (not at edges, but between actual content rows)
  const searchStart = contentTop + Math.floor((contentBottom - contentTop) * 0.25);
  const searchEnd = contentTop + Math.floor((contentBottom - contentTop) * 0.75);

  let gapStart = -1;
  let gapEnd = -1;

  for (let y = searchStart; y < searchEnd; y++) {
    let transparentCount = 0;
    let sampledCount = 0;
    for (let x = 0; x < width; x += colStep) {
      const idx = (y * width + x) * channels;
      const a = channels === 4 ? rawPixels[idx + 3] : 255;
      sampledCount++;
      if (a < 30) transparentCount++;
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

  // Verify content exists both above AND below
  let aboveContent = 0, aboveTotal = 0;
  for (let y = contentTop; y < gapStart; y += 3) {
    for (let x = 0; x < width; x += colStep) {
      const idx = (y * width + x) * channels;
      aboveTotal++;
      if ((channels === 4 ? rawPixels[idx + 3] : 255) > 30) aboveContent++;
    }
  }

  let belowContent = 0, belowTotal = 0;
  for (let y = gapEnd + 1; y <= contentBottom; y += 3) {
    for (let x = 0; x < width; x += colStep) {
      const idx = (y * width + x) * channels;
      belowTotal++;
      if ((channels === 4 ? rawPixels[idx + 3] : 255) > 30) belowContent++;
    }
  }

  // Need at least 3% opaque pixels on BOTH sides
  const aboveRatio = aboveTotal > 0 ? aboveContent / aboveTotal : 0;
  const belowRatio = belowTotal > 0 ? belowContent / belowTotal : 0;
  console.log(`  Horizontal split candidate at y=${gapStart}: above=${(aboveRatio * 100).toFixed(1)}%, below=${(belowRatio * 100).toFixed(1)}%`);

  if (aboveRatio < 0.03 || belowRatio < 0.03) return 0;

  return gapStart;
}

function findContentBounds(rawPixels, width, channels, rx, ry, rw, rh) {
  let top = rh, bottom = 0, left = rw, right = 0;

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const absX = rx + x;
      const absY = ry + y;
      const idx = (absY * width + absX) * channels;
      const alpha = channels === 4 ? rawPixels[idx + 3] : 255;
      if (alpha > 20) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (top >= bottom) return null;
  return { top: ry + top, bottom: ry + bottom, left: rx + left, right: rx + right };
}

async function sliceSpriteSheet(rawPixels, width, height, channels, sheetPngBuffer, outputDir) {
  console.log('Slicing sprite sheet...');
  console.log(`  Sheet size: ${width}x${height}`);

  // Always check for multiple rows — Gemini sometimes generates 2 rows
  // even when asked for a single horizontal strip
  const rowSplit = detectHorizontalSplit(rawPixels, width, height, channels);
  if (rowSplit > 0) {
    console.log(`  Multi-row detected! Cropping to top row: height ${height} -> ${rowSplit}`);
    height = rowSplit;
    sheetPngBuffer = await sharp(sheetPngBuffer)
      .extract({ left: 0, top: 0, width, height: rowSplit })
      .png()
      .toBuffer();
    const { data } = await sharp(sheetPngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    rawPixels = data;
  }

  // Detect dividers using valley-finding on opacity profile
  const dividers = detectDividerPositions(rawPixels, width, height, channels);
  const panels = buildPanelsFromDividers(dividers, width);
  console.log(`  Panels: ${panels.map(p => `[${p.start}-${p.end}]`).join(', ')}`);

  if (panels.length !== NUM_POSES) {
    console.error(`  Expected ${NUM_POSES} panels, got ${panels.length}. Aborting.`);
    return {};
  }

  // Find global vertical content bounds across all panels
  let globalTop = height;
  let globalBottom = 0;
  const panelInfos = [];

  for (let i = 0; i < NUM_POSES; i++) {
    const { start: sx, end } = panels[i];
    const sw = end - sx;
    const bounds = findContentBounds(rawPixels, width, channels, sx, 0, sw, height);
    panelInfos.push({ sx, sw, bounds });
    if (bounds) {
      if (bounds.top < globalTop) globalTop = bounds.top;
      if (bounds.bottom > globalBottom) globalBottom = bounds.bottom;
    }
  }

  // Add top padding for head clearance
  const topPadding = Math.max(0, Math.floor(globalTop * 0.5));
  const cropTop = Math.max(0, globalTop - topPadding);
  const uniformHeight = height - cropTop;

  console.log(`  Global content: top=${globalTop}, bottom=${globalBottom}`);
  console.log(`  Crop region: top=${cropTop}, height=${uniformHeight}`);

  const results = {};
  for (let i = 0; i < NUM_POSES; i++) {
    const { sx, sw, bounds } = panelInfos[i];

    // Trim horizontal transparent space but keep some padding
    let contentLeft = sx;
    let contentRight = sx + sw;
    if (bounds) {
      contentLeft = bounds.left;
      contentRight = bounds.right;
    }
    const contentWidth = contentRight - contentLeft;
    const hPad = Math.max(4, Math.floor(contentWidth * 0.1));
    const finalLeft = Math.max(sx, contentLeft - hPad);
    const finalRight = Math.min(sx + sw, contentRight + hPad);
    const finalWidth = finalRight - finalLeft;

    const poseBuffer = await sharp(sheetPngBuffer)
      .extract({ left: finalLeft, top: cropTop, width: finalWidth, height: uniformHeight })
      .png()
      .toBuffer();

    const poseName = POSE_ORDER[i];
    const posePath = join(outputDir, `${i + 1}_${poseName}.png`);
    writeFileSync(posePath, poseBuffer);
    results[poseName] = posePath;
    console.log(`  Saved: ${poseName} -> ${finalWidth}x${uniformHeight}`);
  }

  return results;
}

// ─── Main ───

async function main() {
  const characterDesc = process.argv[2] || 'a heroic fantasy warrior with sword and shield';
  console.log(`\nCharacter: "${characterDesc}"\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = resolve(process.cwd(), 'test-output', 'sprite-sheets', timestamp);
  mkdirSync(outputDir, { recursive: true });
  console.log(`Output: ${outputDir}\n`);

  // Step 1: Generate sprite sheet
  const prompt = buildSpriteSheetPrompt(characterDesc);
  const promptPath = join(outputDir, 'prompt.txt');
  writeFileSync(promptPath, prompt);
  console.log(`Prompt saved to: ${promptPath}\n`);

  const { data: base64Data } = await generateSpriteSheetImage(prompt);
  const rawBuffer = Buffer.from(base64Data, 'base64');
  const rawPath = join(outputDir, '0_raw_sheet.png');
  writeFileSync(rawPath, rawBuffer);
  console.log(`Raw sheet saved: ${rawPath} (${rawBuffer.length} bytes)\n`);

  // Step 2: Remove green background + divider lines from full sheet
  const { buffer: bgRemovedPixels, width, height, channels } = await removeGreenAndDarkBackground(rawBuffer);
  const bgRemovedPng = await sharp(bgRemovedPixels, { raw: { width, height, channels } })
    .png()
    .toBuffer();
  const bgRemovedPath = join(outputDir, '0_bg_removed_sheet.png');
  writeFileSync(bgRemovedPath, bgRemovedPng);
  console.log(`BG-removed sheet saved: ${bgRemovedPath}\n`);

  // Step 3: Detect dividers on transparent image and slice
  const poses = await sliceSpriteSheet(bgRemovedPixels, width, height, channels, bgRemovedPng, outputDir);

  console.log('\nDone! Output directory:', outputDir);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
