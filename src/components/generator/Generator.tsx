import React, { useState, useRef } from 'react';
import { RunData } from '../../../shared/types/game';
import { generateRunData } from '../../services/geminiService';
import { motion } from 'motion/react';
import { Upload, Sparkles, Loader2, Image as ImageIcon, FileText } from 'lucide-react';

interface GeneratorProps {
  onGenerated: (data: RunData) => void;
}

export const Generator: React.FC<GeneratorProps> = ({ onGenerated }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleGenerate = async () => {
    if (!prompt && !file) {
      setError('Please provide a prompt or upload an image.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      let fileData;
      if (file && previewUrl) {
        // Extract base64 part
        const base64Data = previewUrl.split(',')[1];
        fileData = {
          mimeType: file.type,
          data: base64Data
        };
      }

      const runData = await generateRunData(prompt || 'Generate a random theme based on this file.', fileData);
      onGenerated(runData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate game data. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full bg-slate-900 rounded-3xl p-8 shadow-2xl border border-slate-800"
      >
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent mb-4">
            Famble
          </h1>
          <p className="text-slate-400 text-lg">
            Upload an image or PDF, or type a theme to generate your unique roguelike deckbuilder run.
          </p>
        </div>

        <div className="space-y-6">
          {/* Image/PDF Upload Area */}
          <div 
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${
              previewUrl || (file && file.type === 'application/pdf') ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const droppedFile = e.dataTransfer.files[0];
                setFile(droppedFile);
                if (droppedFile.type.startsWith('image/')) {
                  const reader = new FileReader();
                  reader.onloadend = () => setPreviewUrl(reader.result as string);
                  reader.readAsDataURL(droppedFile);
                } else if (droppedFile.type === 'application/pdf') {
                  const reader = new FileReader();
                  reader.onloadend = () => setPreviewUrl(reader.result as string);
                  reader.readAsDataURL(droppedFile);
                } else {
                  setPreviewUrl(null);
                }
              }
            }}
          >
            {previewUrl && file?.type.startsWith('image/') ? (
              <div className="relative w-full max-w-xs mx-auto h-48 rounded-xl overflow-hidden shadow-lg">
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <button 
                  onClick={() => { setFile(null); setPreviewUrl(null); }}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1"
                >
                  ✕
                </button>
              </div>
            ) : file && file.type === 'application/pdf' ? (
              <div className="relative w-full max-w-xs mx-auto h-48 rounded-xl bg-slate-800 flex flex-col items-center justify-center shadow-lg border border-slate-700">
                <FileText className="w-16 h-16 text-red-400 mb-4" />
                <p className="text-slate-300 font-medium truncate w-full px-4 text-center">{file.name}</p>
                <button 
                  onClick={() => { setFile(null); setPreviewUrl(null); }}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                  <Upload className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-slate-300 font-medium mb-1">Click to upload or drag and drop</p>
                <p className="text-slate-500 text-sm">Image or PDF</p>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*,application/pdf" 
              className="hidden" 
            />
          </div>

          {/* Text Prompt */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Or describe your theme</label>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Cyberpunk Hackers, Kitchen Nightmares, Ancient Egypt..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGenerate();
              }}
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || (!prompt && !file)}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Run...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate Run
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
