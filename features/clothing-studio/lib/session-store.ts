import { z } from "zod";
import {
  ClothingAnalysisSchema,
  ClothingGenerationSettingsSchema,
  ClothingGenerationTaskSchema,
  type ClothingAnalysis,
  type ClothingGenerationSettings,
  type ClothingGenerationTask,
} from "../model";
import { ClothingGenerationPlanSchema } from "./plan-rules";

const SESSION_KEY = "clothing-studio-active-run-v1";

export type ClothingSession = {
  settings: ClothingGenerationSettings;
  analysis: ClothingAnalysis;
  tasks: ClothingGenerationTask[];
};

const StoredSessionSchema = z.object({
  settings: ClothingGenerationSettingsSchema,
  analysis: ClothingAnalysisSchema,
  tasks: ClothingGenerationTaskSchema.array(),
}).strict();

function browserStorage(storage?: Storage) {
  return storage ?? window.sessionStorage;
}

export function saveClothingSession(session: ClothingSession, storage?: Storage) {
  browserStorage(storage).setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadClothingSession(storage?: Storage) {
  try {
    const raw = browserStorage(storage).getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = StoredSessionSchema.parse(JSON.parse(raw));
    ClothingGenerationPlanSchema(parsed.settings).parse(parsed.analysis.plan);
    return { ...parsed, recovered: true as const };
  } catch {
    return null;
  }
}

export function clearClothingSession(storage?: Storage) {
  browserStorage(storage).removeItem(SESSION_KEY);
}

