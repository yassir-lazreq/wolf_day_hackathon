import { CONFIG } from 'src/global-config';

import { OverviewView } from 'src/sections/car-damage/overview-view';

// ----------------------------------------------------------------------

export const metadata = { title: `Overview - ${CONFIG.appName}` };

export default function Page() {
  return <OverviewView />;
}
