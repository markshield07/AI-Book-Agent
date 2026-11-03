import { z } from "zod";

export type EditingMode = "PROOFREAD" | "COPYEDIT" | "LINE_EDIT" | "DEVELOPMENTAL";
export type Intensity = "LIGHT" | "STANDARD" | "INTENSIVE";

export interface StyleSheet {
  preserveVoice?: boolean;
  preserveDialect?: boolean;
  englishVariant?: "american" | "british";
  serialComma?: "always" | "never" | "author";
  dialogueStyle?: string;
  pov?: string;
  tense?: string;
  flashbackFormatting?: string;
  sceneBreakStyle?: string;
  chapterHeadingStyle?: string;
  emphasisPreference?: string;
  protectedTerms?: string[];
  notes?: string;
  // Filled in by manuscript analysis; shown to the author and editable.
  derived?: {
    voice?: string;
    pov?: string;
    tense?: string;
    conventions?: string[];
  };
}

export interface ProjectContext {
  title: string;
  authorName: string;
  genre: string;
  isFiction: boolean;
  language: string;
  manuscriptState: string;
}

export interface ChunkParagraph {
  ref: string; // short ref sent to the model, e.g. "P12"
  style: string;
  text: string;
}

export interface EditChunkRequest {
  project: ProjectContext;
  mode: EditingMode;
  intensity: Intensity;
  styleSheet: StyleSheet;
  continuity: string; // condensed continuity reference
  chapterTitle: string;
  chapterIndex: number;
  chunkIndex: number;
  chunkCount: number;
  paragraphs: ChunkParagraph[];
  // Changes the author already rejected in this chapter, so they are not re-proposed.
  rejected: { original: string; replacement: string }[];
}

export const RawSuggestionSchema = z.object({
  paragraph: z.string(),
  original: z.string(),
  replacement: z.string(),
  category: z.string(),
  explanation: z.string(),
  severity: z.enum(["minor", "moderate", "major"]),
  confidence: z.number().min(0).max(1),
  adds_new_material: z.boolean(),
});
export type RawSuggestion = z.infer<typeof RawSuggestionSchema>;

export const RawNoteSchema = z.object({
  paragraph: z.string(), // "" for chapter-level
  category: z.string(),
  explanation: z.string(),
  severity: z.enum(["minor", "moderate", "major"]),
  confidence: z.number().min(0).max(1),
});
export type RawNote = z.infer<typeof RawNoteSchema>;

export const EditChunkResponseSchema = z.object({
  suggestions: z.array(RawSuggestionSchema),
  notes: z.array(RawNoteSchema),
});
export type EditChunkResponse = z.infer<typeof EditChunkResponseSchema>;

export const AnalysisResponseSchema = z.object({
  summary: z.string(),
  voice: z.string(),
  pov: z.string(),
  tense: z.string(),
  conventions: z.array(z.string()),
  characters: z.array(
    z.object({ name: z.string(), description: z.string(), spellings_seen: z.array(z.string()), chapters: z.array(z.string()) })
  ),
  locations: z.array(z.object({ name: z.string(), description: z.string(), chapters: z.array(z.string()) })),
  terms: z.array(z.object({ name: z.string(), description: z.string() })),
  events: z.array(z.object({ name: z.string(), description: z.string(), chapters: z.array(z.string()) })),
  continuity_concerns: z.array(
    z.object({ chapter: z.string(), description: z.string(), certainty: z.enum(["possible", "likely", "confirmed"]) })
  ),
});
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export interface AnalysisRequest {
  project: ProjectContext;
  styleSheet: StyleSheet;
  chapters: { title: string; text: string }[];
  truncated: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface EditorProvider {
  readonly name: string;
  readonly model: string;
  /** true when manuscript text leaves this server (shown to authors before processing) */
  readonly external: boolean;
  analyze(req: AnalysisRequest): Promise<{ result: AnalysisResponse; usage: Usage }>;
  editChunk(req: EditChunkRequest): Promise<{ result: EditChunkResponse; usage: Usage }>;
}

export class ProviderError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}
