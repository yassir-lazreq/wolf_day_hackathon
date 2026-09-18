/**
 * Environment loading + validation at startup.
 * Server-only. The DeepSeek key must never reach client code.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface AppConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  dataDir: string;
  datasetDir: string;
  batchLimit: number | null;
  batchResume: boolean;
}

export function loadEnv(): AppConfig {
  const envFile = join(process.cwd(), '.env');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // Node < 20.12 fallback: minimal parser
      const content = require('node:fs').readFileSync(envFile, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
      }
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required. Copy .env.example to .env and set it.');
  }

  return {
    apiKey,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 60_000),
    maxRetries: Number(process.env.DEEPSEEK_MAX_RETRIES || 4),
    maxConcurrency: Number(process.env.DEEPSEEK_MAX_CONCURRENCY || 8),
    dataDir: process.env.DATA_DIR || 'data',
    datasetDir: process.env.DATASET_DIR || '../track-b-dataset/kit/dataset',
    batchLimit: process.env.BATCH_LIMIT ? Number(process.env.BATCH_LIMIT) : null,
    batchResume: process.env.BATCH_RESUME !== '0',
  };
}
