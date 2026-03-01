import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../../../shared/types/game';
import { CardComponent } from './CardComponent';
import { motion, AnimatePresence } from 'motion/react';

interface HandDisplayProps {
  hand: Card[];
  energy: number;
  onPlayCard: (card: Card, index: number) => void;
  onDragPlayCard?: (card: Card, index: number, targetEnemyIndex: number) => void;
  targetEnemyIndex?: number;
  multipleEnemies?: boolean;
  attackTargetEnemyIndexes?: number[];
}

/* ─── Quadratic-bezier helpers ───────────────────────────────── */

function qBez(t: number, a: number, b: number, c: number) {
  const m = 1 - t;
  return m * m * a + 2 * m * t * b + t * t * c;
}

function qBezD(t: number, a: number, b: number, c: number) {
  return 2 * (1 - t) * (b - a) + 2 * t * (c - b);
}

/* ─── STS-style curved targeting arrow (chevrons along a bezier) */

const TargetingArrow: React.FC<{
  sx: number; sy: number;
  ex: number; ey: number;
  color: string;
}> = ({ sx, sy, ex, ey, color }) => {
  const dx = ex - sx;
  const dy = ey - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 40) return null;

  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const arc = Math.min(dist * 0.35, 180);
  const cx = mx;
  const cy = my - arc;

  const n = Math.min(Math.max(Math.floor(dist / 22), 6), 24);

  return (
    <g>
      <path
        d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
        fill="none"
        stroke={color}
        strokeWidth={16}
        opacity={0.1}
        strokeLinecap="round"
      />

      {Array.from({ length: n }, (_, i) => {
        const t = (i + 1) / (n + 1);
        const px = qBez(t, sx, cx, ex);
        const py = qBez(t, sy, cy, ey);
        const tdx = qBezD(t, sx, cx, ex);
        const tdy = qBezD(t, sy, cy, ey);
        const angle = Math.atan2(tdy, tdx) * (180 / Math.PI);
        const s = 5 + t * 8;
        const op = 0.2 + t * 0.7;

        return (
          <polygon
            key={i}
            transform={`translate(${px},${py}) rotate(${angle})`}
            points={`${-s * 1.15},${-s * 0.7} ${s * 0.35},0 ${-s * 1.15},${s * 0.7}`}
            fill={color}
            opacity={op}
          />
        );
      })}

      {(() => {
        const t = 0.97;
        const ax = qBez(t, sx, cx, ex);
        const ay = qBez(t, sy, cy, ey);
        const adx = qBezD(t, sx, cx, ex);
        const ady = qBezD(t, sy, cy, ey);
        const a = Math.atan2(ady, adx) * (180 / Math.PI);
        return (
          <polygon
            transform={`translate(${ax},${ay}) rotate(${a})`}
            points="-20,-14 8,0 -20,14"
            fill={color}
            opacity={0.95}
          />
        );
      })()}
    </g>
  );
};

/* ─── Resolve target element centre (viewport coords) ─────── */

function getEnemyCenter(enemyIndex: number): { x: number; y: number } | null {
  const el = document.getElementById(`combat-enemy-${enemyIndex}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
}

function getTargetCenter(cardType: string, targetEnemyIndex?: number): { x: number; y: number } | null {
  if (cardType === 'Attack') {
    return getEnemyCenter(targetEnemyIndex ?? 0);
  }
  const el = document.getElementById('combat-player');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
}

function findNearestEnemy(px: number, py: number, indexes: number[]): number {
  let bestIdx = indexes[0] ?? 0;
  let bestDist = Infinity;
  for (const idx of indexes) {
    const center = getEnemyCenter(idx);
    if (!center) continue;
    const dx = center.x - px;
    const dy = center.y - py;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

/* ─── Card layout constants ────────────────────────────────── */

const CARD_SPACING = 120;
const CARD_HALF_WIDTH = 112; // half of 224px card width (w-56)

/* ─── Hand display ───────────────────────────────────────────── */

export const HandDisplay: React.FC<HandDisplayProps> = ({
  hand, energy, onPlayCard, onDragPlayCard, targetEnemyIndex, multipleEnemies, attackTargetEnemyIndexes = [],
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [dragArrow, setDragArrow] = useState<{
    sx: number; sy: number;
    ex: number; ey: number;
    cardType: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const cardElMap = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const dragTargetRef = useRef<number>(0);

  const arrowColor = dragArrow
    ? dragArrow.cardType === 'Attack' ? '#dc2626'
      : dragArrow.cardType === 'Defense' ? '#3b82f6'
      : '#d97706'
    : '#dc2626';
  const effectiveAttackTargetIndexes = attackTargetEnemyIndexes.length > 0
    ? attackTargetEnemyIndexes
    : [targetEnemyIndex ?? 0];

  /**
   * Zone-based hover: determine which card the cursor is closest to by X position.
   * This ignores which card element the cursor is visually over (which can be wrong
   * when a hovered card scales up and covers neighbors). Instead it divides the hand
   * into logical zones based on card center positions.
   */
  const resolveHoveredIndex = useCallback((clientX: number, clientY: number): number | null => {
    const container = containerRef.current;
    if (!container || hand.length === 0) return null;
    const rect = container.getBoundingClientRect();

    // Only detect hover in the card area
    if (clientY < rect.top + rect.height * 0.1 || clientY > rect.bottom + 30) return null;
    if (clientX < rect.left - 30 || clientX > rect.right + 30) return null;

    const centerX = rect.left + rect.width / 2;
    // Calculate visual scale: the hand container sits inside a parent with transform: scale()
    const visualScale = rect.width / (container.offsetWidth || 1);
    const spacing = CARD_SPACING * visualScale;
    const halfCard = CARD_HALF_WIDTH * visualScale;

    const n = hand.length;
    const middle = (n - 1) / 2;

    let bestIdx: number | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < n; i++) {
      const offset = i - middle;
      const cardCenterX = centerX + offset * spacing;
      const dist = Math.abs(clientX - cardCenterX);
      if (dist < halfCard + 10 && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    return bestIdx;
  }, [hand.length]);

  /** Called from onPointerMove on each card — event may fire on ANY card due to overlap/z-index. */
  const handleCardPointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingCard) return;
    const idx = resolveHoveredIndex(e.clientX, e.clientY);
    setHoveredIndex(prev => prev === idx ? prev : idx);
  }, [draggingCard, resolveHoveredIndex]);

  const handleCardPointerLeave = useCallback(() => {
    if (!draggingCard) {
      setHoveredIndex(null);
    }
  }, [draggingCard]);

  const updateArrowDuringDrag = useCallback((uniqueId: string, cardType: string) => {
    const el = cardElMap.current.get(uniqueId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = r.left + r.width / 2;
    const sy = r.top;

    if (cardType === 'Attack' && multipleEnemies && effectiveAttackTargetIndexes.length > 1) {
      const nearestIdx = findNearestEnemy(sx, sy, effectiveAttackTargetIndexes);
      dragTargetRef.current = nearestIdx;
      const target = getEnemyCenter(nearestIdx);
      if (target) {
        setDragArrow(prev => prev ? { ...prev, sx, sy, ex: target.x, ey: target.y } : null);
      }
    } else if (cardType === 'Attack') {
      const fallbackTargetIdx = effectiveAttackTargetIndexes[0] ?? 0;
      dragTargetRef.current = fallbackTargetIdx;
      const target = getEnemyCenter(fallbackTargetIdx);
      if (target) {
        setDragArrow(prev => prev ? { ...prev, sx, sy, ex: target.x, ey: target.y } : null);
      } else {
        setDragArrow(prev => prev ? { ...prev, sx, sy } : null);
      }
    } else {
      setDragArrow(prev => prev ? { ...prev, sx, sy } : null);
    }
  }, [multipleEnemies, effectiveAttackTargetIndexes]);

  return (
    <>
      {/* Targeting arrow – portalled to body to escape scaled parents */}
      {dragArrow && createPortal(
        <svg
          className="fixed inset-0 pointer-events-none"
          style={{ width: '100vw', height: '100vh', zIndex: 9999 }}
        >
          <TargetingArrow
            sx={dragArrow.sx}
            sy={dragArrow.sy}
            ex={dragArrow.ex}
            ey={dragArrow.ey}
            color={arrowColor}
          />
        </svg>,
        document.body
      )}

      <div
        ref={containerRef}
        className="flex justify-center items-end h-[22rem] relative w-full max-w-6xl mx-auto pointer-events-none"
      >
        <AnimatePresence>
          {hand.map((card, index) => {
            const uniqueId = `${card.id}-${index}`;
            const total = hand.length;
            const middle = (total - 1) / 2;
            const offset = index - middle;
            const rotation = offset * 6;
            const yOffset = Math.abs(offset) * 10 + Math.pow(offset, 2) * 8;

            const isHovered = hoveredIndex === index && !draggingCard;
            const isDragging = draggingCard === uniqueId;
            const disabled = card.cost > energy;

            return (
              <motion.div
                key={uniqueId}
                ref={(el: HTMLDivElement | null) => { cardElMap.current.set(uniqueId, el); }}
                initial={{ y: 200, opacity: 0, scale: 0.8 }}
                animate={{
                  y: isDragging || isHovered ? yOffset - 40 : yOffset,
                  opacity: 1,
                  rotate: isDragging || isHovered ? 0 : rotation,
                  scale: isDragging ? 1.05 : (isHovered ? 1.15 : 1),
                }}
                exit={{ y: -300, opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                transition={{ type: 'tween', duration: 0.15, ease: 'easeOut' }}
                className={`absolute origin-bottom pointer-events-auto ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
                style={{
                  left: `calc(50% + ${offset * CARD_SPACING}px - ${CARD_HALF_WIDTH}px)`,
                  zIndex: isDragging ? 200 : (isHovered ? 100 : index),
                  willChange: 'transform',
                }}
                onPointerMove={handleCardPointerMove}
                onPointerLeave={handleCardPointerLeave}
                drag={!disabled}
                dragSnapToOrigin
                dragElastic={0.1}
                dragConstraints={{ top: -1000, bottom: 0, left: -1000, right: 1000 }}
                onDragStart={() => {
                  const el = cardElMap.current.get(uniqueId);
                  const targetEnemyIdx = effectiveAttackTargetIndexes[0] ?? targetEnemyIndex ?? 0;
                  const target = getTargetCenter(card.type, targetEnemyIdx);
                  if (el && target) {
                    const r = el.getBoundingClientRect();
                    setDragArrow({
                      sx: r.left + r.width / 2,
                      sy: r.top,
                      ex: target.x,
                      ey: target.y,
                      cardType: card.type,
                    });
                  }
                  dragTargetRef.current = targetEnemyIdx;
                  setDraggingCard(uniqueId);
                  setHoveredIndex(null);
                }}
                onDrag={() => updateArrowDuringDrag(uniqueId, card.type)}
                onDragEnd={(_e, info) => {
                  setDraggingCard(null);
                  setDragArrow(null);
                  if (info.offset.y < -150) {
                    if (card.type === 'Attack' && multipleEnemies && onDragPlayCard) {
                      onDragPlayCard(card, index, dragTargetRef.current);
                    } else {
                      onPlayCard(card, index);
                    }
                  }
                }}
                onClick={() => !disabled && !isDragging && onPlayCard(card, index)}
                whileTap={!disabled && !isDragging ? { scale: 0.95 } : {}}
              >
                <CardComponent card={card} disabled={disabled} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
};
