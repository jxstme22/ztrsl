import { z } from "zod";

export const endpointKindSchema = z.enum(["capture", "render"]);
export const endpointStateSchema = z.enum([
  "active",
  "disabled",
  "notPresent",
  "unplugged",
]);

export const audioEndpointSchema = z.object({
  id: z.string().min(1),
  friendlyName: z.string().min(1),
  kind: endpointKindSchema,
  state: endpointStateSchema,
  defaultRoles: z.object({
    console: z.boolean(),
    multimedia: z.boolean(),
    communications: z.boolean(),
  }),
  nativeFormat: z
    .object({
      sampleRate: z.number().int().positive(),
      channels: z.number().int().positive(),
    })
    .nullable(),
  isSynthetic: z.boolean(),
});

export const endpointCatalogSchema = z.object({
  platform: z.enum(["windows", "macos", "development"]),
  endpoints: z.array(audioEndpointSchema),
  deviceChangeDetected: z.boolean(),
  processCaptureSupported: z.boolean(),
});

export const levelSnapshotSchema = z.object({
  sequence: z.number().int().nonnegative(),
  peak: z.number().min(0).max(1.2),
  rms: z.number().min(0).max(1.2),
  clipped: z.boolean(),
  droppedFrames: z.number().int().nonnegative(),
});

export type AudioEndpoint = z.infer<typeof audioEndpointSchema>;
export type EndpointCatalog = z.infer<typeof endpointCatalogSchema>;
export type LevelSnapshot = z.infer<typeof levelSnapshotSchema>;

export const EMPTY_LEVEL: LevelSnapshot = {
  sequence: 0,
  peak: 0,
  rms: 0,
  clipped: false,
  droppedFrames: 0,
};
