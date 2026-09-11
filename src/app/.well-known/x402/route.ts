import { GET as manifest } from "@/app/api/survey/manifest/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manifest at a well-known path, so an agent that only knows the host
 * can find the service, its rail and its prices without reading our docs.
 * Same document as /api/survey/manifest.
 */
export function GET() {
  return manifest();
}
