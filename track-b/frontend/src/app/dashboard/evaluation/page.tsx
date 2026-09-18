import { CONFIG } from 'src/global-config';

import { EvaluationView } from 'src/sections/car-damage/evaluation-view';

// ----------------------------------------------------------------------

export const metadata = { title: `Evaluation - ${CONFIG.appName}` };

export default function Page() {
  return <EvaluationView />;
}
