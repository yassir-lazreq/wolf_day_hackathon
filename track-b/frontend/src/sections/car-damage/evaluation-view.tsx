'use client';

/**
 * Evaluation page: extraction quality vs ground truth.
 * Ground truth is used ONLY here (evaluation) — never in the pipeline.
 */

import { Box, Chip, Grid, Link, Alert, Paper, Stack, Table, TableRow, TableBody, TableCell, TableHead, Typography } from '@mui/material';

import { paths } from 'src/routes/paths';

import { useEvalSummary } from 'src/sections/car-damage/use-data';

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}

export function EvaluationView() {
  const { evalSummary, error } = useEvalSummary();

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!evalSummary) return <Typography color="text.secondary">Loading data…</Typography>;

  const m = evalSummary.metrics;
  const metricRows: Array<[string, string, string]> = [
    ['Case Type Accuracy', pct(m.caseTypeAccuracy), 'service vs damage'],
    ['Order Type Accuracy', pct(m.caseKindAccuracy), '12 types'],
    ['Zone Precision', pct(m.zonePrecision), 'share of correct zones among all extracted'],
    ['Zone Recall', pct(m.zoneRecall), 'share of found zones among all true zones'],
    ['Zone F1', pct(m.zoneF1), 'harmonic mean'],
    ['Exact Multi-Zone Matches', pct(m.exactMultiZoneMatchRate), 'entire zone set exactly right'],
    ['Severity Accuracy', pct(m.severityAccuracy), `n=${m.severityAccuracyKnown} damage cases`],
    ['Insurance Accuracy', pct(m.insuranceAccuracy), '5 types'],
    ['Lifecycle Accuracy', pct(m.lifecycleAccuracy), 'deterministic from status'],
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        Evaluation
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {m.nCases} cases evaluated ({m.nDamageCases} damage cases) · As of {evalSummary.generatedAt.slice(0, 16).replace('T', ' ')} · Ground truth is used for evaluation only
      </Typography>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Metrics (computed deterministically)
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Metric</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Meaning</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {metricRows.map(([name, value, meaning]) => (
                  <TableRow key={name}>
                    <TableCell sx={{ fontWeight: 600 }}>{name}</TableCell>
                    <TableCell>{value}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{meaning}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Error Balance
            </Typography>
            <Stack spacing={1.5}>
              <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">False-Positive Zones</Typography>
                <Typography variant="body2" fontWeight={700}>{m.falsePositiveZones}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">Missed Zones</Typography>
                <Typography variant="body2" fontWeight={700}>{m.missedZones}</Typography>
              </Paper>
              <Typography variant="caption" color="text.secondary">
                Note: severity is sometimes not unambiguously derivable from the text in this corpus (identical wording with different labels) — the number above is therefore the most conservative metric.
              </Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Representative Failure Cases ({evalSummary.failures.length})
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {evalSummary.failures.slice(0, 40).map((f) => (
                <Link key={f.caseId} href={paths.dashboard.caseDetail(f.caseId)} underline="none">
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`#${f.caseId}`}
                    title={`FP: ${f.fp.join(', ') || '—'} · FN: ${f.fn.join(', ') || '—'} · Type: ${f.caseTypeOk ? 'ok' : 'wrong'} · Kind: ${f.caseKindOk ? 'ok' : 'wrong'} · Severity: ${f.severityOk === null ? 'n/a' : f.severityOk ? 'ok' : 'wrong'}`}
                    sx={{ borderColor: f.severityOk === false ? 'warning.main' : 'text.disabled' }}
                  />
                </Link>
              ))}
              {evalSummary.failures.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No failure cases.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
