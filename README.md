<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/31d22697-2015-4e17-9141-8fb6c04481da

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set model API keys in [.env.local](.env.local):
   - `MISTRAL_API_KEY` for text generation and OCR
   - `GEMINI_API_KEY` for image generation
   - `ELEVENLABS_API_KEY` (optional) for audio/music/TTS
3. Run the app:
   `npm run dev`
