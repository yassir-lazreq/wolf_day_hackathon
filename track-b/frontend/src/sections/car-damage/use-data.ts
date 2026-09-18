'use client';

/**
 * Client-side loaders for the generated data artifacts.
 * Module-level promise cache: each artifact is fetched exactly once.
 */

import type { ZoneMeta, EvalSummary, AnalyticsData, CaseExtracted } from './types';

import { useState, useEffect } from 'react';

const cache = new Map<string, Promise<unknown>>();

function fetchJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
        return r.json() as Promise<T>;
      }),
    );
  }
  return cache.get(url) as Promise<T>;
}

export function useCases(): { cases: CaseExtracted[] | null; error: string | null } {
  const [cases, setCases] = useState<CaseExtracted[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<CaseExtracted[]>('/data/cases-extracted.json')
      .then((d) => alive && setCases(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { cases, error };
}

export function useAnalytics(): { analytics: AnalyticsData | null; error: string | null } {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<AnalyticsData>('/data/analytics.json')
      .then((d) => alive && setAnalytics(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { analytics, error };
}

export function useEvalSummary(): { evalSummary: EvalSummary | null; error: string | null } {
  const [evalSummary, setEvalSummary] = useState<EvalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<EvalSummary>('/data/eval-summary.json')
      .then((d) => alive && setEvalSummary(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { evalSummary, error };
}

export function useZonesMeta(): { zonesMeta: ZoneMeta[] | null } {
  const [zonesMeta, setZonesMeta] = useState<ZoneMeta[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<ZoneMeta[]>('/data/zones.json').then((d) => alive && setZonesMeta(d));
    return () => {
      alive = false;
    };
  }, []);
  return { zonesMeta };
}

export { fetchJson };
