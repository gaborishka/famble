import React, { useState, useEffect } from 'react';
import { generateGameImage } from '../services/geminiService';
import { Loader2 } from 'lucide-react';

interface GameImageProps {
  prompt?: string;
  className?: string;
  alt?: string;
  type?: 'asset' | 'background' | 'character';
}

export const GameImage: React.FC<GameImageProps> = ({ prompt, className = '', alt = 'Game Asset', type = 'asset' }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!prompt) return;

    let isMounted = true;
    setLoading(true);
    setError(false);

    generateGameImage(prompt, type)
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
  }, [prompt, type]);

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
    />
  );
};
