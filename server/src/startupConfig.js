import { validateProductionConfig } from './config.js';

// Imported first by the server entry point, before modules that open the database.
validateProductionConfig();
