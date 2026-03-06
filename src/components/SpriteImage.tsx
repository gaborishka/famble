import React, { useMemo } from 'react';
import { GameImage } from './GameImage';
import type { SpriteSheet, SpritePose } from '../../shared/types/game';

interface SpriteImageProps {
  /** Sprite sheet with per-pose URLs (takes priority if available). */
  spriteSheet?: SpriteSheet | null;
  /** Fallback single-image URL when no sprite sheet is available. */
  fallbackSrc?: string;
  /** Fallback generation prompt when no sprite sheet or src is available. */
  fallbackPrompt?: string;
  /** Current animation state name from CombatArena. */
  currentPose: string;
  fileKey?: string;
  className?: string;
  alt?: string;
}

/**
 * Maps CombatArena animation state names to SpritePose keys.
 * States without a distinct pose (buff, debuff, unknown) stay on idle —
 * the motion.div animation handles the visual effect for those.
 */
const ANIM_TO_POSE: Record<string, SpritePose> = {
  idle: 'idle',
  attack: 'attack',
  hit: 'hurt',
  hurt: 'hurt',
  buff: 'idle',
  defend: 'block',
  block: 'block',
  debuff: 'idle',
  unknown: 'idle',
  death: 'death',
};

export const SpriteImage: React.FC<SpriteImageProps> = ({
  spriteSheet,
  fallbackSrc,
  fallbackPrompt,
  currentPose,
  fileKey,
  className,
  alt = 'Sprite',
}) => {
  const resolvedSrc = useMemo(() => {
    if (!spriteSheet?.poses) return fallbackSrc;
    const pose = ANIM_TO_POSE[currentPose] || 'idle';
    return spriteSheet.poses[pose] || spriteSheet.poses.idle || fallbackSrc;
  }, [spriteSheet, currentPose, fallbackSrc]);

  return (
    <GameImage
      src={resolvedSrc}
      prompt={resolvedSrc ? undefined : fallbackPrompt}
      fileKey={fileKey}
      className={className}
      alt={alt}
      type="character"
    />
  );
};
