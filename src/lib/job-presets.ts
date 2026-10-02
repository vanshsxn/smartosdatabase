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
  /** AI jobs run a real model call on the uploaded/pasted input. */
  ai?: { instructions: string; inputLabel: string; image?: boolean };
}

export const JOB_PRESETS: JobPreset[] = [
  { type: "AI_SUMMARIZE", label: "AI · Summarize document", description: "A real AI model reads your uploaded text/file and writes a summary.", cores: 1, memoryMb: 512, estimatedMs: 4000, defaultName: "ai-summary", ai: { inputLabel: "Text or file to summarize", instructions: "Summarize the user's document in concise Markdown: a 2-sentence overview, then key bullet points." } },
  { type: "AI_CODE_REVIEW", label: "AI · Code review", description: "A real AI model reviews uploaded code for bugs, security and style.", cores: 2, memoryMb: 1024, estimatedMs: 6000, defaultName: "ai-code-review", ai: { inputLabel: "Code to review", instructions: "Review the code. Reply in Markdown with sections: Bugs, Security, Improvements. Be specific and brief." } },
  { type: "AI_TRANSLATE", label: "AI · Translate text", description: "A real AI model translates your text (write the target language on the first line).", cores: 1, memoryMb: 512, estimatedMs: 3000, defaultName: "ai-translate", ai: { inputLabel: "First line: target language. Then the text.", instructions: "The first line names the target language. Translate the remaining text into that language. Output only the translation." } },
  { type: "AI_DATA_INSIGHTS", label: "AI · CSV data insights", description: "Upload a CSV; a real AI model finds trends, outliers and stats.", cores: 2, memoryMb: 1536, estimatedMs: 8000, defaultName: "csv-insights", ai: { inputLabel: "CSV data", instructions: "Analyze this CSV. Reply in Markdown: dataset overview (rows/columns), key statistics, trends, outliers, and 3 recommendations. Only use numbers present in the data." } },
  { type: "IMAGE_PROCESSING", label: "Image processing", description: "Resize, compress and watermark a batch of images.", cores: 2, memoryMb: 512, estimatedMs: 4000, defaultName: "image-batch", ai: { image: true, inputLabel: "Describe the image to create (prompt)", instructions: "Generate an image matching the prompt." } },
  { type: "VIDEO_TRANSCODE", label: "Video transcoding", description: "Convert a video to 1080p/720p web formats.", cores: 4, memoryMb: 2048, estimatedMs: 12000, defaultName: "video-transcode", ai: { inputLabel: "Describe the source video (format, resolution, length, codec) and target devices", instructions: "Act as a video transcoding engine. Produce a concrete transcoding plan: output renditions table (resolution, bitrate, codec, container), exact ffmpeg commands for each, estimated output sizes, and HLS/DASH packaging notes." } },
  { type: "ML_TRAINING", label: "ML model training", description: "Train a small classification model on a dataset.", cores: 4, memoryMb: 4096, estimatedMs: 20000, defaultName: "model-training", ai: { inputLabel: "Paste a CSV dataset and name the target column on the first line", instructions: "Act as an ML training job. The first line names the target column. Analyze the dataset, choose a model, describe feature engineering, give a train/test split, and report realistic expected metrics derived only from the data. Output Markdown with a training report and Python scikit-learn code." } },
  { type: "ML_INFERENCE", label: "ML batch inference", description: "Run predictions over a batch of records.", cores: 2, memoryMb: 1536, estimatedMs: 6000, defaultName: "batch-inference", ai: { inputLabel: "Records to classify (one per line, optionally first line: labels)", instructions: "Act as a batch inference job. Classify each input record (use labels from the first line if given, otherwise infer sensible labels such as sentiment). Output a Markdown table: record, prediction, confidence (0-1)." } },
  { type: "DATA_ETL", label: "Data ETL pipeline", description: "Extract, clean and load records into a warehouse.", cores: 2, memoryMb: 1024, estimatedMs: 8000, defaultName: "etl-pipeline", ai: { inputLabel: "Raw data (CSV/JSON) to clean and transform", instructions: "Act as an ETL pipeline. Extract the records, clean them (trim, dedupe, normalize dates/numbers, fix casing), and output: 1) a short list of transformations applied with counts, 2) the cleaned data as CSV in a code block, 3) a SQL CREATE TABLE for loading it." } },
  { type: "REPORT", label: "Report generation", description: "Aggregate data and render a PDF report.", cores: 1, memoryMb: 256, estimatedMs: 3000, defaultName: "monthly-report", ai: { inputLabel: "Data or notes to turn into a report", instructions: "Generate a professional business report in Markdown from the input: title, executive summary, key metrics table, analysis, and recommendations. Use only numbers present in the input." } },
  { type: "LOG_ANALYTICS", label: "Log analytics", description: "Scan and index application logs for errors.", cores: 1, memoryMb: 512, estimatedMs: 5000, defaultName: "log-scan", ai: { inputLabel: "Paste or upload application logs", instructions: "Act as a log analytics job. Count lines by level, list the top error messages with counts, detect anomalies/spikes and likely root causes, and suggest fixes. Output Markdown tables. Use only what is in the logs." } },
  { type: "BUILD", label: "Web build / deployment", description: "Install dependencies and build a web project.", cores: 2, memoryMb: 1024, estimatedMs: 15000, defaultName: "web-build", ai: { inputLabel: "package.json, build config or build logs (optional for repo builds)", instructions: "Act as a CI build runner. From the provided project config or logs, list the build steps that run (install, lint, test, build), detect problems or missing scripts, and output a build report with status (SUCCESS/FAILED), warnings, and a recommended GitHub Actions workflow YAML." } },
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

/** Jobs at or below this cost (and ≤2 cores) run immediately without admin approval. */
export const AUTO_APPROVE_MAX_CREDITS = 5;
export function isAutoApproved(type: string, priority: JobPriority) {
  return estimateCredits(type, priority) <= AUTO_APPROVE_MAX_CREDITS && resourcesFor(type, priority).requestedCores <= 2;
}
