'use client';

/**
 * Overview page: corpus-wide operational analytics + insights.
 * Every number on this page is computed deterministically from structured
 * data (public/data/analytics.json) — never from an LLM.
 */

import { Box, Grid, Link, Alert, Paper, Stack, Typography } from '@mui/material';

import { paths } from 'src/routes/paths';

import { KpiCard, BarChart, DonutChart } from './charts';
import { useCases, useAnalytics, useZonesMeta } from './use-data';

const ZONE_LABEL_DE: Record<string, string> = {
  leicht: 'Leicht',
  mittel: 'Mittel',
  schwer: 'Schwer',
  unknown: 'Unbekannt',
  vollkasko: 'Vollkasko',
  teilkasko: 'Teilkasko',
  haftpflicht_gegner: 'Haftpflicht Gegner',
  selbstzahler: 'Selbstzahler',
  gesteuert: 'Gesteuert',
  neu: 'Neu',
  laufend: 'Laufend',
  fertig: 'Fertig',
  abgeschlossen: 'Abgeschlossen',
  storniert: 'Storniert',
  instandsetzen: 'Instandsetzen',
  austauschen: 'Austauschen',
  smart_repair: 'Smart Repair',
  pruefen: 'Prüfen',
  keine_angabe: 'Keine Angabe',
};

function de(k: string): string {
  return ZONE_LABEL_DE[k] ?? k;
}

export function OverviewView() {
  const { analytics, error } = useAnalytics();
  const { cases } = useCases();
  const { zonesMeta } = useZonesMeta();

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!analytics) return <Typography color="text.secondary">Loading data…</Typography>;

  const zoneLabel = new Map((zonesMeta ?? []).map((z) => [z.id, z.germanLabel]));
  const t = analytics.totals;
  const sorted = (rec: Record<string, number>) =>
    Object.entries(rec)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);

  const featuredCase = cases?.find((c) => c.caseType === 'damage' && c.damages.length >= 2);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4">Corpus Analytics</Typography>
          <Typography variant="body2" color="text.secondary">
            Deterministic aggregation over {t.cases} structured workshop cases · As of {analytics.generatedAt.slice(0, 16).replace('T', ' ')}
          </Typography>
        </Box>
        {featuredCase && (
          <Link href={paths.dashboard.caseDetail(featuredCase.id)} variant="button">
            Demo: Multi-Zone Damage #{featuredCase.id} →
          </Link>
        )}
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <KpiCard label="Total Cases" value={t.cases} sub={`${t.openCases} open · ${t.canceledCases} cancelled`} />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <KpiCard label="Damage Cases" value={t.damageCases} sub={`${Math.round((t.damageCases / t.cases) * 1000) / 10}% of total`} />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <KpiCard label="Service Cases" value={t.serviceCases} sub={`${Math.round((t.serviceCases / t.cases) * 1000) / 10}% of total`} />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <KpiCard label="Multi-Zone Damage" value={t.multiZoneDamageCases} sub={`of ${t.damageCases} damage cases`} />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <KpiCard label="Workshop Efforts" value={t.workshopTaskCount} sub={`${t.workLoadTotal} workload units · ${t.orderCount} orders`} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <BarChart title="Order Types" data={sorted(analytics.kindDist)} total={t.cases} maxBars={12} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <BarChart title="Damage Zones (Most Frequent)" data={sorted(analytics.zoneDist).map((d) => ({ ...d, key: zoneLabel.get(d.key) ?? d.key }))} total={t.damageCases} maxBars={12} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <DonutChart title="Severity" data={sorted(analytics.severityDist).map((d) => ({ ...d, key: de(d.key) }))} total={t.damageCases} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <DonutChart title="Insurance (Damage Cases)" data={sorted(analytics.insuranceDist).map((d) => ({ ...d, key: de(d.key) }))} total={t.damageCases} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <DonutChart title="Lifecycle" data={sorted(analytics.lifecycleDist).map((d) => ({ ...d, key: de(d.key) }))} total={t.cases} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <BarChart title="Top Makes" data={sorted(analytics.makeDist)} maxBars={10} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <BarChart title="Open Cases by Status (Top 10)" data={sorted(analytics.stateDistTop)} total={t.openCases} maxBars={10} />
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mt: 4, mb: 1.5 }}>
        Operational Insights
      </Typography>
      <Grid container spacing={2}>
        {analytics.insights.map((ins) => (
          <Grid size={{ xs: 12, md: 6 }} key={ins.title}>
            <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {ins.title}
              </Typography>
              <Typography variant="body2">{ins.text}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Evidence: {ins.evidence}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
