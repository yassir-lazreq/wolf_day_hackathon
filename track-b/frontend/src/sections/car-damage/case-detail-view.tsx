'use client';

/**
 * Case detail: the demo centerpiece.
 * Original German note -> extracted structure (evidence, confidence)
 * -> deterministic replacement inference -> 3D visualization with three
 * distinct visual states (damaged / replacement / linked-intact).
 */

import type { ZoneMeta, CaseExtracted } from 'src/sections/car-damage/types';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';

import { Box, Chip, Grid, Link, Alert, Paper, Stack, Table, Divider, TableRow, TableBody, TableCell, TableHead, Typography } from '@mui/material';

import { paths } from 'src/routes/paths';

import { useCases, useZonesMeta } from 'src/sections/car-damage/use-data';

const CarViewer = dynamic(() => import('src/sections/car-viewer/car-viewer').then((m) => m.CarViewer), {
  ssr: false,
  loading: () => <Box sx={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading 3D viewer…</Box>,
});

const SEV_DE: Record<string, string> = { schwer: 'Schwer', mittel: 'Mittel', leicht: 'Leicht', unknown: 'Unbekannt' };
const SEV_COLOR: Record<string, 'error' | 'warning' | 'success' | 'default'> = { schwer: 'error', mittel: 'warning', leicht: 'success', unknown: 'default' };
const ACTION_DE: Record<string, string> = {
  instandsetzen: 'Instandsetzen',
  austauschen: 'Austauschen',
  smart_repair: 'Smart Repair',
  pruefen: 'Prüfen',
  keine_angabe: 'Keine Angabe',
};

function zoneLabel(id: string, zonesMeta: ZoneMeta[]): string {
  return zonesMeta.find((z) => z.id === id)?.germanLabel ?? id;
}

export function CaseDetailView({ id }: { id: string }) {
  const { cases, error } = useCases();
  const { zonesMeta } = useZonesMeta();
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [tone] = useState<'dark' | 'light'>('dark');

  const caseData = useMemo(() => cases?.find((c) => String(c.id) === id) ?? null, [cases, id]);

  const { linkedZones } = useMemo(() => {
    const damaged = new Set<string>();
    const replacement = new Set<string>();
    const linked = new Set<string>();
    if (caseData && zonesMeta) {
      const meta = new Map(zonesMeta.map((z) => [z.id, z]));
      for (const d of caseData.damages) {
        damaged.add(d.zoneId);
        if (d.replacementPart && d.action === 'austauschen') replacement.add(d.replacementPart);
      }
      for (const z of damaged) {
        for (const lz of meta.get(z)?.linkedZones ?? []) {
          if (!damaged.has(lz) && !replacement.has(lz)) linked.add(lz);
        }
      }
    }
    return { linkedZones: linked };
  }, [caseData, zonesMeta]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!cases) return <Typography color="text.secondary">Loading data…</Typography>;
  if (!caseData) return <Alert severity="warning">Case #{id} not found.</Alert>;
  if (!zonesMeta) return <Typography color="text.secondary">Loading zones…</Typography>;

  const c = caseData as CaseExtracted;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h4">Case #{c.id}</Typography>
        <Chip color={c.caseType === 'damage' ? 'error' : 'primary'} label={c.caseType === 'damage' ? 'Damage Case' : 'Service Case'} />
        <Chip variant="outlined" label={c.caseKind} />
        <Box sx={{ flex: 1 }} />
        <Link href={paths.dashboard.cases}>Back to list</Link>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Vehicle
            </Typography>
            <Stack spacing={0.5}>
              <Typography variant="body2">
                <b>{c.manufacturer} {c.model}</b> ({c.modelType}) · {c.licensePlate}
              </Typography>
              <Typography variant="body2">First registration: {c.firstRegistration} · mileage: {c.mileage.toLocaleString('de-DE')} km</Typography>
              <Typography variant="body2">Lifecycle: {c.lifecycleStage} · Confidence: {Math.round(c.overallConfidence * 100)}% · Method: {c.method}</Typography>
              <Typography variant="caption" color="text.secondary">
                Orders: {c.orderCount} · Workshop tasks: {c.workshopTaskCount} · open list: {c.inOpenList ? 'yes' : 'no'}
              </Typography>
            </Stack>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Original Note (German, unchanged)
            </Typography>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover', maxHeight: 340, overflow: 'auto' }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12.5 }}>
                {c.freitext}
              </Typography>
            </Paper>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
            <Box sx={{ px: 2, pt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">3D Damage Visualization</Typography>
              <Chip size="small" sx={{ bgcolor: '#e11d48', color: '#fff' }} label="Damaged" />
              <Chip size="small" sx={{ bgcolor: '#f97316', color: '#fff' }} label="Replacement Part (inferred)" />
              <Chip size="small" sx={{ bgcolor: '#eab308', color: '#1c1917' }} label="Linked Intact Parts" />
              <Typography variant="caption" color="text.secondary">Click = select zone</Typography>
            </Box>
            <CarViewer
              caseData={c}
              zonesMeta={zonesMeta}
              height={420}
              onZoneSelect={setSelectedZone}
            />
            {selectedZone && (
              <Box sx={{ px: 2, pb: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Selected zone: <b>{zoneLabel(selectedZone, zonesMeta)}</b> ({selectedZone})
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Extracted Damages (with Evidence)
            </Typography>
            {c.damages.length === 0 && <Typography variant="body2" color="text.secondary">No damages extracted (service case).</Typography>}
            {c.damages.map((d, i) => (
              <Box key={`${d.zoneId}-${i}`} sx={{ mb: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: tone === 'dark' ? 'transparent' : 'background.paper' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="body2" fontWeight={700}>{zoneLabel(d.zoneId, zonesMeta)}</Typography>
                  <Chip size="small" color={SEV_COLOR[d.severity] ?? 'default'} label={SEV_DE[d.severity] ?? d.severity} />
                  <Chip size="small" variant="outlined" label={ACTION_DE[d.action] ?? d.action} />
                  <Typography variant="caption" color="text.secondary">Confidence {Math.round(d.confidence * 100)}%</Typography>
                </Stack>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  Type: {d.damageType} · Status: {d.status}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                  Evidence: „{d.evidence}“
                </Typography>
              </Box>
            ))}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Replacement Inference & Linked Intact Parts
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Observed damage → deterministic replacement rules (e.g. bumper side → complete bumper). Linked intact parts come from the static <code>linkedZones</code> table.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Zone (damaged)</TableCell>
                  <TableCell>Recommendation</TableCell>
                  <TableCell>Replacement</TableCell>
                  <TableCell>Linked Intact Parts</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {c.damages.map((d, i) => (
                  <TableRow key={`${d.zoneId}-${i}`}>
                    <TableCell>{zoneLabel(d.zoneId, zonesMeta)}</TableCell>
                    <TableCell>{ACTION_DE[d.action] ?? d.action}</TableCell>
                    <TableCell>
                      {d.replacementPart && d.action === 'austauschen' ? (
                        <Chip size="small" sx={{ bgcolor: '#f97316', color: '#fff' }} label={zoneLabel(d.replacementPart, zonesMeta)} />
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {[...linkedZones].filter((lz) => zonesMeta.find((z) => z.id === d.zoneId)?.linkedZones.includes(lz)).map((lz) => (
                          <Chip key={lz} size="small" sx={{ bgcolor: '#fef9c3', color: '#713f12' }} label={zoneLabel(lz, zonesMeta)} />
                        ))}
                        {zonesMeta.find((z) => z.id === d.zoneId)?.linkedZones.length === 0 && '—'}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {c.damages.length === 0 && <Typography variant="body2" color="text.secondary">No damages — no inference needed.</Typography>}
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Processing
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              Method: {c.method} · {c.warnings.length} warnings
              {c.warnings.map((w) => (
                <div key={w}>⚠ {w}</div>
              ))}
              {c.llmError && (
                <div style={{ color: '#dc2626' }}>LLM error (baseline fallback): {c.llmError}</div>
              )}
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
