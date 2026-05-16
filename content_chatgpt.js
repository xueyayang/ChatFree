// content_chatgpt.js - ChatGPT (chatgpt.com)
// Site-specific overrides for ChatGPT, if any.
// All shared infrastructure is in modules/content-core.js.
//
// Load order (manifest):
//   1. modules/site-chatgpt.js   → window.__ChatFreeSiteAdapter
//   2. modules/content-core.js     → reads adapter, boots embed mode
//   3. content_chatgpt.js          → this file (site-specific last-mile)
