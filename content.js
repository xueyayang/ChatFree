// content.js - DeepSeek (chat.deepseek.com)
// Site-specific overrides for DeepSeek, if any.
// All shared infrastructure is in modules/content-core.js.
//
// Load order (manifest):
//   1. modules/site-deepseek.js   → window.__ChatFreeSiteAdapter
//   2. modules/content-core.js     → reads adapter, boots embed mode
//   3. content.js                  → this file (site-specific last-mile)
