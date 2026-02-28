// Mistral Document AI service — OCR preprocessing + structured extraction
// Calls server-side proxy at /api/mistral-ocr to avoid CORS issues

const MAX_MARKDOWN_LENGTH = 15000;
const MAX_EXTRACTED_IMAGES = 5;

// --- Types ---

export interface DocumentExtraction {
  markdown: string;
  pageCount: number;
  annotations: ThemeAnnotations | null;
  extractedImages: string[];
}

export interface ThemeAnnotations {
  primaryTopic: string;
  characters: string[];
  conflicts: string[];
  settings: string[];
  mood: string;
  keyTerms: string[];
}

export type MistralDocumentInput =
  | { type: 'file'; mimeType: string; base64Data: string }
  | { type: 'url'; url: string };

// --- Annotation schema for structured extraction ---

const ANNOTATION_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'theme_extraction',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        primaryTopic: {
          type: 'string',
          description: 'The primary subject or theme of the document in 3-10 words'
        },
        characters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key characters, figures, entities, or important nouns (up to 8)'
        },
        conflicts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Central conflicts, tensions, or challenges described (up to 5)'
        },
        settings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Settings, locations, or environments described (up to 5)'
        },
        mood: {
          type: 'string',
          description: 'Overall mood or tone in 1-4 words (e.g. dark, whimsical, tense)'
        },
        keyTerms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key vocabulary or domain-specific terms for game theming (up to 10)'
        }
      },
      required: ['primaryTopic', 'characters', 'conflicts', 'settings', 'mood', 'keyTerms'],
      additionalProperties: false
    }
  }
};

// --- Core OCR function ---

export async function processDocumentOCR(
  input: MistralDocumentInput
): Promise<DocumentExtraction | null> {
  try {
    const document = buildDocumentParam(input);

    // REST API uses snake_case — proxy forwards raw JSON to Mistral
    const requestBody = {
      model: 'mistral-ocr-latest',
      document,
      include_image_base64: true,
      document_annotation_format: ANNOTATION_SCHEMA,
      document_annotation_prompt: 'Extract the main theme, key characters/entities, conflicts, settings, mood, and domain-specific terms from this document. These will be used to generate a themed roguelike deckbuilder game.',
    };

    const res = await fetch('/api/mistral-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error(`Mistral OCR proxy returned ${res.status}:`, errText);
      return null;
    }

    const data = await res.json();

    // Concatenate all page markdown
    const pages: any[] = data.pages || [];
    const allMarkdown = pages
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
      .map((page: any) => page.markdown || '')
      .join('\n\n---\n\n');

    // Collect extracted images (base64)
    const extractedImages: string[] = [];
    for (const page of pages) {
      for (const img of page.images || []) {
        if (img.image_base64 && extractedImages.length < MAX_EXTRACTED_IMAGES) {
          extractedImages.push(img.image_base64);
        }
      }
    }

    // Parse document annotations
    let annotations: ThemeAnnotations | null = null;
    if (data.document_annotation) {
      try {
        const parsed = typeof data.document_annotation === 'string'
          ? JSON.parse(data.document_annotation)
          : data.document_annotation;
        annotations = parsed as ThemeAnnotations;
      } catch (e) {
        console.warn('Failed to parse Mistral document annotations:', e);
      }
    }

    // Truncate if too long
    const markdown = allMarkdown.length > MAX_MARKDOWN_LENGTH
      ? allMarkdown.substring(0, MAX_MARKDOWN_LENGTH) + '\n\n[...document truncated...]'
      : allMarkdown;

    return {
      markdown,
      pageCount: pages.length,
      annotations,
      extractedImages,
    };
  } catch (err) {
    console.error('Mistral OCR processing failed:', err);
    return null;
  }
}

// --- Helpers ---

function buildDocumentParam(input: MistralDocumentInput): Record<string, string> {
  if (input.type === 'url') {
    return {
      type: 'document_url',
      document_url: input.url,
    };
  }

  const dataUri = `data:${input.mimeType};base64,${input.base64Data}`;

  if (input.mimeType.startsWith('image/')) {
    return {
      type: 'image_url',
      image_url: dataUri,
    };
  }

  return {
    type: 'document_url',
    document_url: dataUri,
  };
}

export function buildEnhancedPrompt(
  originalPrompt: string,
  extraction: DocumentExtraction
): string {
  const parts: string[] = [];

  parts.push('Generate a run based on the following document content.\n');

  if (extraction.annotations) {
    const a = extraction.annotations;
    parts.push('=== DOCUMENT ANALYSIS (extracted by Mistral Document AI) ===');
    parts.push(`Primary Topic: ${a.primaryTopic}`);
    if (a.characters.length > 0) {
      parts.push(`Key Figures/Entities: ${a.characters.join(', ')}`);
    }
    if (a.conflicts.length > 0) {
      parts.push(`Conflicts/Challenges: ${a.conflicts.join(', ')}`);
    }
    if (a.settings.length > 0) {
      parts.push(`Settings/Environments: ${a.settings.join(', ')}`);
    }
    parts.push(`Mood/Tone: ${a.mood}`);
    if (a.keyTerms.length > 0) {
      parts.push(`Key Terms: ${a.keyTerms.join(', ')}`);
    }
    parts.push('');
  }

  parts.push('=== DOCUMENT CONTENT ===');
  parts.push(extraction.markdown);
  parts.push('');

  if (originalPrompt && originalPrompt !== 'Generate a run based on this document.') {
    parts.push('=== USER INSTRUCTIONS ===');
    parts.push(originalPrompt);
  }

  return parts.join('\n');
}

export function isUrlInput(text: string): boolean {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
