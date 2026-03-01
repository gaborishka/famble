import React, { useState, useEffect } from 'react';
import { generateGameImage, getCachedImageUrl } from '../services/geminiService';
import { Loader2 } from 'lucide-react';

interface GameImageProps {
  src?: string;
  prompt?: string;
  fileKey?: string;
  className?: string;
  alt?: string;
  type?: 'asset' | 'background' | 'character';
}

export const GameImage: React.FC<GameImageProps> = ({ src, prompt, fileKey, className = '', alt = 'Game Asset', type = 'asset' }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(() => src || getCachedImageUrl(prompt, type as 'asset' | 'background' | 'character', fileKey));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (src) {
      setImageUrl(src);
      setLoading(false);
      setError(false);
      return;
    }

    if (!prompt) {
      setImageUrl(null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(false);

    generateGameImage(prompt, type as 'asset' | 'background' | 'character', fileKey)
      .then(url => {
        if (isMounted) {
          setImageUrl(url);
        }
      })
      .catch(err => {
        console.error("Failed to generate image", err);
        if (isMounted) {
          setError(true);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src, prompt, type, fileKey]);

  if (loading || !imageUrl) {
    return (
      <div className={`bg-slate-800 flex items-center justify-center ${className}`}>
        {error ? (
          <span className="text-red-400 text-xs text-center px-2">Failed to load</span>
        ) : (
          <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
        )}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={`object-cover ${className}`}
      referrerPolicy="no-referrer"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    />
  );
};
