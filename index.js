// -----------------------------------------------------------------------------
// Entry point: the SDK client, the handlers (src/app.js), the connection.
// The supervisor gives GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR: `new GladysIntegration()` reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
// /data: the one writable volume (the ids of long media kept for the scenes).
const app = registerHandlers(gladys, { dataDir: '/data' });

gladys.handleShutdown(async () => {
  app.stop();
});

logger.info('Starting the Home Assistant bridge');
await gladys.connect();
