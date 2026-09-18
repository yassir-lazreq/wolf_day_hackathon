import { CONFIG } from 'src/global-config';

import { CasesView } from 'src/sections/car-damage/cases-view';

// ----------------------------------------------------------------------

export const metadata = { title: `Cases - ${CONFIG.appName}` };

export default function Page() {
  return <CasesView />;
}
