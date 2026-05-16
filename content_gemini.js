// content_gemini.js - Gemini (gemini.google.com)
// Site-specific overrides for Gemini, if any.
// All shared infrastructure is in modules/content-core.js.
//
// Load order (manifest):
//   1. modules/site-gemini.js    → window.__ChatFreeSiteAdapter
//   2. modules/content-core.js     → reads adapter, boots embed mode
//   3. content_gemini.js           → this file (site-specific last-mile)
