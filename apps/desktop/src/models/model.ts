import { z } from "zod";

export const catalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["asr", "translation"]),
  runtime: z.string(),
  recommended: z.boolean(),
  description: z.string(),
  licenseSpdx: z.string(),
  licenseNotice: z.string(),
  downloadSizeBytes: z.number().nonnegative(),
  source: z.string(),
  revision: z.string(),
  fileCount: z.number().int().nonnegative(),
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const modelInfoSchema = catalogEntrySchema.extend({
  status: z.enum(["installed", "installing", "available"]),
  installedSizeBytes: z.number().nonnegative(),
});

export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const modelsListSchema = z.object({
  models: z.array(modelInfoSchema),
  inUse: z.array(z.string()),
});

export type ModelsList = z.infer<typeof modelsListSchema>;

export const EMPTY_MODELS_LIST: ModelsList = {
  models: [],
  inUse: [],
};

export const modelProgressSchema = z.object({
  modelId: z.string(),
  done: z.boolean(),
  canceled: z.boolean(),
  error: z.string().nullable(),
  phase: z.enum(["download", "extract", "install", "done"]),
  fileIndex: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  fileBytesDone: z.number().nonnegative(),
  fileBytesTotal: z.number().nonnegative(),
  totalBytesDone: z.number().nonnegative(),
  totalBytesTotal: z.number().nonnegative(),
});

export type ModelProgress = z.infer<typeof modelProgressSchema>;
