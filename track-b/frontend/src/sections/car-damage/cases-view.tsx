'use client';

/**
 * Cases list: MUI DataGrid over the extracted results with filtering.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import { Box, Chip, Alert, Stack, Select, MenuItem, TextField, InputLabel, Typography, FormControl } from '@mui/material';

import { paths } from 'src/routes/paths';

import { useCases } from 'src/sections/car-damage/use-data';

const SEV_COLOR: Record<string, 'error' | 'warning' | 'success' | 'default'> = {
  schwer: 'error',
  mittel: 'warning',
  leicht: 'success',
};

const SEV_DE: Record<string, string> = { schwer: 'Schwer', mittel: 'Mittel', leicht: 'Leicht' };

export function CasesView() {
  const { cases, error } = useCases();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'damage' | 'service'>('all');
  const [kindFilter, setKindFilter] = useState('all');

  const kinds = useMemo(() => [...new Set((cases ?? []).map((c) => c.caseKind))].sort(), [cases]);

  const rows = useMemo(() => {
    if (!cases) return [];
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      if (typeFilter !== 'all' && c.caseType !== typeFilter) return false;
      if (kindFilter !== 'all' && c.caseKind !== kindFilter) return false;
      if (!q) return true;
      return (
        c.freitext.toLowerCase().includes(q) ||
        `${c.manufacturer} ${c.model}`.toLowerCase().includes(q) ||
        c.licensePlate.toLowerCase().includes(q) ||
        String(c.id).includes(q)
      );
    });
  }, [cases, search, typeFilter, kindFilter]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!cases) return <Typography color="text.secondary">Loading data…</Typography>;

  const columns: GridColDef[] = [
    { field: 'id', headerName: 'Case', width: 100 },
    {
      field: 'vehicle',
      headerName: 'Vehicle',
      width: 220,
      valueGetter: (_v, row) => `${row.manufacturer} ${row.model} · ${row.licensePlate}`,
    },
    { field: 'caseKind', headerName: 'Order Type', width: 150 },
    {
      field: 'caseType',
      headerName: 'Type',
      width: 100,
      renderCell: (p) => (
        <Chip size="small" color={p.value === 'damage' ? 'error' : 'primary'} variant="outlined" label={p.value === 'damage' ? 'Damage' : 'Service'} />
      ),
    },
    {
      field: 'zones',
      headerName: 'Zones',
      width: 260,
      valueGetter: (_v, row) => (row.damages ?? []).length === 0 ? '—' : row.damages.map((d: { zoneId: string }) => d.zoneId).join(', '),
    },
    {
      field: 'maxSeverity',
      headerName: 'Severity',
      width: 110,
      renderCell: (p) =>
        p.value ? <Chip size="small" color={SEV_COLOR[p.value] ?? 'default'} label={SEV_DE[p.value] ?? p.value} /> : <span>—</span>,
    },
    {
      field: 'lifecycleStage',
      headerName: 'Stage',
      width: 130,
    },
    {
      field: 'overallConfidence',
      headerName: 'Confidence',
      width: 110,
      valueGetter: (_v, row) => `${Math.round((row.overallConfidence ?? 0) * 100)}%`,
    },
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 2 }}>
        Cases
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search (text, vehicle, plate, ID)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 300, flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Type</InputLabel>
          <Select value={typeFilter} label="Type" onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="damage">Damage</MenuItem>
            <MenuItem value="service">Service</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Order Type</InputLabel>
          <Select value={kindFilter} label="Order Type" onChange={(e) => setKindFilter(e.target.value)}>
            <MenuItem value="all">All</MenuItem>
            {kinds.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <DataGrid
        rows={rows}
        columns={columns}
        autoHeight
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        pageSizeOptions={[25, 50, 100]}
        onRowClick={(params: GridRowParams) => router.push(paths.dashboard.caseDetail(String(params.id)))}
        sx={{ cursor: 'pointer', bgcolor: 'background.paper', '& .MuiDataGrid-row:hover': { bgcolor: 'action.hover' } }}
        disableRowSelectionOnClick
      />
    </Box>
  );
}
