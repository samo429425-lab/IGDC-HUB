/**
 * Compatibility overwrite for the earlier helper file.
 * The active search metadata configuration now lives inside search-meta-injector.js.
 * This file intentionally has no route config; the default handler makes it a valid
 * Netlify Edge module if the build scanner sees it.
 */
export default async function searchMetaConfigCompatibility(_request, context) {
  return context.next();
}
