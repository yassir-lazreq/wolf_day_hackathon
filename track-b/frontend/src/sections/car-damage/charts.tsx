'use client';

/**
 * Dependency-free charts built on MUI primitives.
 * Kept simple and deterministic: the numbers come from the analytics
 * artifacts, never from an LLM.
 */

import { Box, Paper, Stack, alpha, Typography } from '@mui/material';

const PALETTE = ['#2563eb', '#7c3aed', '#dc2626', '#059669', '#d97706', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#9333ea', '#0d9488', '#b45309'];

function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

interface DistItem {
  key: string;
  value: number;
}

export interface BarChartProps {
  title: string;
  data: Array<DistItem>;
  unit?: string;
  maxBars?: number;
  total?: number;
}

export function BarChart({ title, data, maxBars = 10, total }: BarChartProps) {
  const items = data.slice(0, maxBars);
  const max = Math.max(...items.map((d) => d.value), 1);
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        {title}
        {typeof total === 'number' ? ` (n=${total})` : ''}
      </Typography>
      <Stack spacing={1}>
        {items.map((d, i) => (
          <Box key={d.key}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
              <Typography variant="caption" color="text.secondary" sx={{ maxWidth: '70%' }} noWrap>
                {d.key}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {d.value}
              </Typography>
            </Stack>
            <Box sx={{ bgcolor: (t) => alpha(t.palette.divider, 0.4), borderRadius: 0.75, height: 8, overflow: 'hidden' }}>
              <Box sx={{ width: `${(d.value / max) * 100}%`, height: '100%', bgcolor: colorFor(i), borderRadius: 0.75 }} />
            </Box>
          </Box>
        ))}
        {items.length === 0 && <Typography variant="caption" color="text.secondary">No data</Typography>}
      </Stack>
    </Paper>
  );
}

export interface DonutChartProps {
  title: string;
  data: Array<DistItem>;
  total?: number;
}

export function DonutChart({ title, data, total }: DonutChartProps) {
  const sum = data.reduce((s, d) => s + d.value, 0);
  const cx = 60;
  const cy = 60;
  const r = 46;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const segs = data.map((d, i) => {
    const frac = sum > 0 ? d.value / sum : 0;
    const seg = { ...d, color: colorFor(i), frac, dash: frac * circ, offset: -acc * circ };
    acc += frac;
    return seg;
  });
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
        {typeof total === 'number' ? ` (n=${total})` : ''}
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center">
        <svg width={130} height={130} viewBox="0 0 130 130">
          {segs.map((s) => (
            <circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={18}
              strokeDasharray={`${s.dash} ${circ - s.dash}`}
              strokeDashoffset={s.offset}
              transform="rotate(-90 60 60)"
            />
          ))}
          <text x={cx} y={cy + 5} textAnchor="middle" fontSize={16} fontWeight={700} fill="currentColor">
            {sum}
          </text>
        </svg>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          {segs.map((s) => (
            <Stack key={s.key} direction="row" alignItems="center" spacing={1} sx={{ fontSize: 12 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
              <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {s.key}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {s.value}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" sx={{ mt: 0.5 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}
