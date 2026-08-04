import { z } from "zod";

export const capabilitiesSchema = z.object({
  languageCapability: z.enum(["forced", "preferred", "post-filter"]),
  recommendedProfiles: z.array(z.string()),
  vramClass: z.enum(["low", "medium", "high"]),
});

export type Capabilities = z.infer<typeof capabilitiesSchema>;

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
  capabilities: capabilitiesSchema,
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const modelInfoSchema = catalogEntrySchema.extend({
  status: z.enum(["installed", "installing", "available"]),
  installedSizeBytes: z.number().nonnegative(),
  /** Absolute on-disk folder of the installed model; empty when not installed. */
  modelDir: z.string(),
});

export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const modelsListSchema = z.object({
  models: z.array(modelInfoSchema),
  inUse: z.array(z.string()),
  /** v0.4: known-but-not-cataloged models (NCSpeech local exports). */
  known: z.array(modelInfoSchema).default([]),
});

export type ModelsList = z.infer<typeof modelsListSchema>;

export const EMPTY_MODELS_LIST: ModelsList = {
  models: [],
  inUse: [],
  known: [],
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

export const downloadEndpointSchema = z.object({
  endpoint: z.string(),
  mirror: z.boolean(),
  userOverride: z.boolean(),
});

export type DownloadEndpointInfo = z.infer<typeof downloadEndpointSchema>;

export const EMPTY_DOWNLOAD_ENDPOINT: DownloadEndpointInfo = {
  endpoint: "https://huggingface.co",
  mirror: false,
  userOverride: false,
};

export const providerViewSchema = z.object({
  name: z.string(),
  host: z.string(),
  custom: z.boolean(),
});

export type ProviderView = z.infer<typeof providerViewSchema>;

export const providerStatusSchema = z.object({
  region: z.enum(["global", "mainland-cn"]),
  providers: z.array(providerViewSchema),
});

export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const EMPTY_PROVIDER_STATUS: ProviderStatus = {
  region: "global",
  providers: [],
};

export const gpuRuntimeWheelSchema = z.object({
  package: z.string(),
  sizeBytes: z.number().nonnegative(),
});

export type GpuRuntimeWheel = z.infer<typeof gpuRuntimeWheelSchema>;

export const gpuRuntimeStatusSchema = z.object({
  installed: z.boolean(),
  installing: z.boolean(),
  installedSizeBytes: z.number().nonnegative(),
  downloadSizeBytes: z.number().nonnegative(),
  systemAvailable: z.boolean(),
  hasArtifacts: z.boolean(),
  /** Absolute on-disk folder of the CUDA runtime; empty when nothing exists. */
  path: z.string(),
  wheels: z.array(gpuRuntimeWheelSchema),
});

export type GpuRuntimeStatus = z.infer<typeof gpuRuntimeStatusSchema>;

export const EMPTY_GPU_RUNTIME_STATUS: GpuRuntimeStatus = {
  installed: false,
  installing: false,
  installedSizeBytes: 0,
  downloadSizeBytes: 0,
  systemAvailable: false,
  hasArtifacts: false,
  path: "",
  wheels: [],
};

export const gpuRuntimeProgressSchema = z.object({
  done: z.boolean(),
  canceled: z.boolean(),
  error: z.string().nullable(),
  phase: z.enum(["download", "done"]),
  fileIndex: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  fileBytesDone: z.number().nonnegative(),
  fileBytesTotal: z.number().nonnegative(),
  totalBytesDone: z.number().nonnegative(),
  totalBytesTotal: z.number().nonnegative(),
});

export type GpuRuntimeProgress = z.infer<typeof gpuRuntimeProgressSchema>;
