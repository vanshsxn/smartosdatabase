import type { JobPriority } from "./engine.types";

/**
 * Real workload types. The system decides cores, memory and expected run time
 * for each type, so users only choose what to run and how urgent it is.
 */
export interface JobPreset {
  type: string;
  label: string;
  description: string;
  cores: number;
  memoryMb: number;
  estimatedMs: number;
  defaultName: string;
}

export const JOB_PRESETS: JobPreset[] = [
  { type: "IMAGE_PROCESSING", label: "Image processing", description: "Resize, compress and watermark a batch of images.", cores: 2, memoryMb: 512, estimatedMs: 4000, defaultName: "image-batch" },
  { type: "VIDEO_TRANSCODE", label: "Video transcoding", description: "Convert a video to 1080p/720p web formats.", cores: 4, memoryMb: 2048, estimatedMs: 12000, defaultName: "video-transcode" },
  { type: "ML_TRAINING", label: "ML model training", description: "Train a small classification model on a dataset.", cores: 4, memoryMb: 4096, estimatedMs: 20000, defaultName: "model-training" },
  { type: "ML_INFERENCE", label: "ML batch inference", description: "Run predictions over a batch of records.", cores: 2, memoryMb: 1536, estimatedMs: 6000, defaultName: "batch-inference" },
  { type: "DATA_ETL", label: "Data ETL pipeline", description: "Extract, clean and load records into a warehouse.", cores: 2, memoryMb: 1024, estimatedMs: 8000, defaultName: "etl-pipeline" },
  { type: "REPORT", label: "Report generation", description: "Aggregate data and render a PDF report.", cores: 1, memoryMb: 256, estimatedMs: 3000, defaultName: "monthly-report" },
  { type: "LOG_ANALYTICS", label: "Log analytics", description: "Scan and index application logs for errors.", cores: 1, memoryMb: 512, estimatedMs: 5000, defaultName: "log-scan" },
  { type: "BUILD", label: "Web build / deployment", description: "Install dependencies and build a web project.", cores: 2, memoryMb: 1024, estimatedMs: 15000, defaultName: "web-build" },
];

const PRIORITY_BOOST: Record<JobPriority, number> = { LOW: 1, MEDIUM: 1, HIGH: 1, CRITICAL: 2 };

export function resourcesFor(type: string, priority: JobPriority) {
  const p = JOB_PRESETS.find((x) => x.type === type) ?? JOB_PRESETS[0]!;
  return {
    requestedCores: Math.min(8, p.cores * PRIORITY_BOOST[priority]),
    requestedMemoryMb: p.memoryMb,
    estimatedMs: p.estimatedMs,
  };
}

/** Credits formula mirrored from the engine: cores*0.5/s + GB*0.25/s. */
export function estimateCredits(type: string, priority: JobPriority) {
  const r = resourcesFor(type, priority);
  const s = r.estimatedMs / 1000;
  return r.requestedCores * 0.5 * s + (r.requestedMemoryMb / 1024) * 0.25 * s;
}
