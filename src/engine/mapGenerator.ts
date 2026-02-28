import { Enemy, MapNode, RunData } from '../../shared/types/game';

type NodeType = MapNode['type'];

const PLAYABLE_ROWS = 5; // requested pacing: 5 playable floors before boss
const MIN_ROW_WIDTH = 3;
const MAX_ROW_WIDTH = 6;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const range = (start: number, end: number): number[] => {
  const values: number[] = [];
  for (let i = start; i <= end; i++) values.push(i);
  return values;
};

const pickRandom = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

const pickUniqueRows = (candidates: number[], count: number, blocked = new Set<number>()): number[] => {
  const pool = candidates.filter(row => !blocked.has(row));
  const picked: number[] = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
};

const buildRowWidths = (playableRows: number): number[] => {
  const dynamicMin = playableRows <= 5 ? 3 : MIN_ROW_WIDTH;
  const dynamicMax = playableRows <= 5 ? 5 : MAX_ROW_WIDTH;
  const center = (playableRows - 1) / 2;
  return Array.from({ length: playableRows }, (_, row) => {
    if (row === 0 || row === playableRows - 1) return dynamicMin;
    const normalizedDistance = center === 0 ? 0 : Math.abs(row - center) / center;
    const widthSpread = dynamicMax - dynamicMin;
    const base = Math.round(dynamicMax - normalizedDistance * (widthSpread + 0.8));
    const jitterChance = playableRows <= 5 ? 0.25 : 0.5;
    const jitter = row > 1 && row < playableRows - 2 && Math.random() < jitterChance
      ? (Math.random() < 0.5 ? -1 : 1)
      : 0;
    return clamp(base + jitter, dynamicMin, dynamicMax);
  });
};

const createEliteFromEnemy = (enemy: Enemy, eliteIndex: number): Enemy => {
  const hpMultiplier = 1.6;
  const intentMultiplier = 1.35;
  const maxHp = Math.max(35, Math.round(enemy.maxHp * hpMultiplier));

  return {
    ...enemy,
    id: `elite-${enemy.id}-${eliteIndex}`,
    name: `Ascended ${enemy.name}`,
    maxHp,
    currentHp: maxHp,
    description: `${enemy.description} This foe has been empowered as an elite encounter.`,
    intents: enemy.intents.map(intent => ({
      ...intent,
      value: Math.max(1, Math.round(intent.value * intentMultiplier)),
    })),
  };
};

const pickEnemy = (enemies: Enemy[], index: number): Enemy => enemies[index % enemies.length];

const centerPreference = (width: number): number[] => {
  const center = Math.floor((width - 1) / 2);
  const offsets = [0, -1, 1, -2, 2];
  return offsets
    .map(offset => center + offset)
    .filter(idx => idx >= 0 && idx < width);
};

const sidePreference = (width: number): number[] => {
  const center = Math.floor((width - 1) / 2);
  const indices = [center - 1, center + 1, center, 0, width - 1];
  return indices.filter((idx, i) => idx >= 0 && idx < width && indices.indexOf(idx) === i);
};

const placeType = (
  types: NodeType[],
  lockedIndices: Set<number>,
  type: NodeType,
  preferredIndices: number[],
) => {
  const candidate = preferredIndices.find(idx => !lockedIndices.has(idx));
  if (candidate !== undefined) {
    types[candidate] = type;
    lockedIndices.add(candidate);
    return;
  }

  const fallbackIndices = types.map((_, idx) => idx).filter(idx => !lockedIndices.has(idx));
  if (fallbackIndices.length === 0) return;
  const idx = pickRandom(fallbackIndices);
  types[idx] = type;
  lockedIndices.add(idx);
};

const buildBaseRowTypes = (row: number, playableRows: number, width: number): NodeType[] => {
  if (row === 0) {
    // Start row should be simple and forgiving.
    return Array.from({ length: width }, (_, idx) => (idx === Math.floor(width / 2) ? 'Event' : 'Combat'));
  }

  const progress = row / (playableRows - 1);
  const eventChance = progress < 0.3 ? 0.22 : progress < 0.7 ? 0.35 : 0.25;
  return Array.from({ length: width }, () => (Math.random() < eventChance ? 'Event' : 'Combat'));
};

const createRowTypePlan = (playableRows: number): NodeType[][] => {
  const rowWidths = buildRowWidths(playableRows);
  const allRows = range(0, playableRows - 1);
  const earlySafeRows = Math.max(1, Math.floor(playableRows * 0.25));
  const midRows = allRows.filter(r => r >= Math.max(2, Math.floor(playableRows * 0.4)) && r <= playableRows - 2);
  const lateRows = allRows.filter(r => r >= Math.max(2, Math.floor(playableRows * 0.55)) && r <= playableRows - 2);
  const preBossRow = playableRows - 1;

  const shopCount = playableRows >= 8 ? (Math.random() < 0.45 ? 2 : 1) : 1;
  const shopRows = pickUniqueRows(midRows, shopCount);

  const treasureCandidates = allRows.filter(r => r >= Math.max(2, Math.floor(playableRows * 0.45)) && r <= playableRows - 2);
  const treasureRow = pickUniqueRows(
    treasureCandidates,
    1,
    new Set(shopRows),
  )[0] ?? pickUniqueRows(treasureCandidates, 1)[0] ?? Math.max(2, playableRows - 2);

  const campfireRows = new Set<number>([preBossRow]);
  if (playableRows >= 6) {
    const extraCampfire = pickUniqueRows(lateRows, 1, new Set([...shopRows, treasureRow, preBossRow]))[0];
    if (extraCampfire !== undefined) campfireRows.add(extraCampfire);
  }

  const eliteTarget = playableRows >= 9 ? 3 : playableRows >= 7 ? 2 : 1;
  const eliteCandidates = allRows.filter(r => r >= Math.max(2, Math.floor(playableRows * 0.5)) && r <= playableRows - 2);
  let eliteRows = pickUniqueRows(
    eliteCandidates,
    eliteTarget,
    new Set([...shopRows, treasureRow, ...campfireRows]),
  );
  if (eliteRows.length === 0) {
    eliteRows = pickUniqueRows(
      eliteCandidates,
      eliteTarget,
      new Set(campfireRows),
    );
  }

  return rowWidths.map((width, row) => {
    const types = buildBaseRowTypes(row, playableRows, width);
    const locked = new Set<number>();

    if (shopRows.includes(row)) {
      placeType(types, locked, 'Shop', centerPreference(width));
    }

    if (row === treasureRow) {
      placeType(types, locked, 'Treasure', centerPreference(width));
    }

    if (campfireRows.has(row)) {
      placeType(types, locked, 'Campfire', centerPreference(width));
    }

    if (eliteRows.includes(row)) {
      placeType(types, locked, 'Elite', sidePreference(width));
    }

    if (row <= earlySafeRows) {
      for (let i = 0; i < types.length; i++) {
        if (types[i] !== 'Combat' && types[i] !== 'Event') types[i] = 'Combat';
      }
    }

    return types;
  });
};

const connectRows = (rows: MapNode[][]) => {
  const compactMap = rows.length <= 6;

  for (let row = 0; row < rows.length - 1; row++) {
    const current = rows[row];
    const next = rows[row + 1];

    if (next.length === 1) {
      current.forEach(node => {
        node.nextNodes = [next[0].id];
      });
      continue;
    }

    current.forEach((node, index) => {
      const ratio = current.length > 1 ? index / (current.length - 1) : 0.5;
      const anchor = Math.round(ratio * (next.length - 1));
      const targets = new Set<number>([anchor]);

      const branchChance = compactMap
        ? (row <= 1 ? 0.5 : row <= rows.length - 4 ? 0.38 : 0.28)
        : (row <= 1 ? 0.8 : row <= rows.length - 4 ? 0.6 : 0.45);
      if (Math.random() < branchChance) {
        const second = clamp(anchor + (Math.random() < 0.5 ? -1 : 1), 0, next.length - 1);
        targets.add(second);
      }

      if (!compactMap && Math.random() < 0.2 && next.length > 3) {
        const third = clamp(anchor + (Math.random() < 0.5 ? -2 : 2), 0, next.length - 1);
        targets.add(third);
      }

      node.nextNodes = Array.from(targets)
        .sort((a, b) => a - b)
        .map(target => next[target].id);
    });

    // Keep all nodes in the next row reachable.
    next.forEach((nextNode, nextIndex) => {
      const reachable = current.some(node => node.nextNodes.includes(nextNode.id));
      if (reachable) return;

      let bestSource = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      current.forEach((_, sourceIndex) => {
        const sourceRatio = current.length > 1 ? sourceIndex / (current.length - 1) : 0.5;
        const projected = sourceRatio * (next.length - 1);
        const distance = Math.abs(projected - nextIndex);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSource = sourceIndex;
        }
      });

      rows[row][bestSource].nextNodes = Array.from(
        new Set([...rows[row][bestSource].nextNodes, nextNode.id]),
      );
    });
  }
};

export const generateFallbackNodeMap = (runData: RunData): MapNode[] => {
  const enemies = runData.enemies.length > 0
    ? runData.enemies
    : [{
      id: 'fallback-enemy',
      name: 'Wandering Shade',
      maxHp: 35,
      currentHp: 35,
      description: 'A fallback enemy spawned because no enemies were generated.',
      intents: [
        { type: 'Attack' as const, value: 7, description: 'Deal 7 damage.' },
      ],
    }];

  const rowTypePlan = createRowTypePlan(PLAYABLE_ROWS);
  const rows: MapNode[][] = [];
  let combatIndex = 0;
  let eliteIndex = 0;

  rowTypePlan.forEach((types, row) => {
    const rowNodes = types.map((type, col) => {
      let data: unknown;
      if (type === 'Combat') {
        data = pickEnemy(enemies, combatIndex);
        combatIndex++;
      } else if (type === 'Elite') {
        data = createEliteFromEnemy(pickEnemy(enemies, eliteIndex), eliteIndex);
        eliteIndex++;
      }

      return {
        id: `r${row}c${col}`,
        type,
        x: col * 20,
        y: row * 20,
        row,
        nextNodes: [],
        completed: false,
        data,
      } satisfies MapNode;
    });

    rows.push(rowNodes);
  });

  const bossRowIndex = PLAYABLE_ROWS;
  rows.push([{
    id: 'boss',
    type: 'Boss',
    x: 0,
    y: bossRowIndex * 20,
    row: bossRowIndex,
    nextNodes: [],
    completed: false,
    data: runData.boss,
  } satisfies MapNode]);

  connectRows(rows);
  return rows.flat();
};
