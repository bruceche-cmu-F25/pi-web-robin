import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fetchSubscriptionUsage } from "@/extension/robin/provider-usage";

export const dynamic = "force-dynamic";

/**
 * Account-level subscription quota for OAuth/API-key providers (OpenAI Codex,
 * Anthropic Claude, OpenCode). Resolves auth through ModelRuntime so expiring
 * OAuth tokens refresh transparently, and returns only percentages, reset
 * times and labels — never credentials.
 */
export async function GET() {
  let modelRuntime: ModelRuntime;
  try {
    modelRuntime = await ModelRuntime.create();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  const providers = await fetchSubscriptionUsage(async (provider) => {
    const resolved = await modelRuntime.getAuth(provider);
    return { token: resolved?.auth.apiKey, source: resolved?.source };
  });

  return Response.json({ providers, fetchedAt: Date.now() });
}
