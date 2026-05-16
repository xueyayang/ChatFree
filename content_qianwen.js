// content_qianwen.js - 千问 (qianwen.com / tongyi.aliyun.com)
// Site-specific overrides for Qianwen, if any.
// All shared infrastructure is in modules/content-core.js.
//
// Load order (manifest):
//   1. modules/site-qianwen.js   → window.__ChatFreeSiteAdapter
//   2. modules/content-core.js     → reads adapter, boots embed mode
//   3. content_qianwen.js          → this file (site-specific last-mile)
