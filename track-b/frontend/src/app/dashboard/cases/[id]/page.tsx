import { CONFIG } from 'src/global-config';

import { CaseDetailView } from 'src/sections/car-damage/case-detail-view';

// ----------------------------------------------------------------------

export const metadata = { title: `Case - ${CONFIG.appName}` };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetailView id={id} />;
}
