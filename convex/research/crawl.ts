import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import type {
  FirecrawlAdapter,
  FirecrawlRefreshInput,
  FirecrawlRefreshResult,
} from "../../shared/contracts";

type AllowlistedSource = {
  publisher: string;
  url: string;
};

type FirecrawlPayload = {
  success: boolean;
  data?: unknown;
  error?: string;
};

const firecrawlEndpoint = "https://api.firecrawl.dev/v2/scrape";
const extractionSchema = {
  type: "object",
  properties: {
    excerpt: {
      type: "string",
      description: "A concise passage that directly supports the extracted facts.",
    },
    extractedFacts: {
      type: "array",
      description: "Factual claims supported by the source page, without diagnosis.",
      items: { type: "string" },
    },
  },
  required: ["excerpt", "extractedFacts"],
  additionalProperties: false,
};

export const allowlistedSources: readonly AllowlistedSource[] = [
  {
    publisher: "NIA",
    url: "https://www.nia.nih.gov/health/medical-care-and-appointments/what-do-i-need-tell-doctor",
  },
  {
    publisher: "NIA",
    url: "https://www.nia.nih.gov/health/memory-loss-and-forgetfulness/memory-problems-forgetfulness-and-aging",
  },
  {
    publisher: "NHS",
    url: "https://www.nhs.uk/symptoms/memory-loss-amnesia/",
  },
  { publisher: "Mayo Clinic", url: "https://www.mayoclinic.org" },
  {
    publisher: "Alzheimer's Association",
    url: "https://www.alz.org",
  },
  {
    publisher: "PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov",
  },
];

export function findAllowlistedSource(
  input: FirecrawlRefreshInput,
): AllowlistedSource {
  const source = allowlistedSources.find(
    (candidate) =>
      candidate.url === input.url && candidate.publisher === input.publisher,
  );
  if (!source) {
    throw new Error(`Firecrawl source is not allowlisted: ${input.url}`);
  }
  return source;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Firecrawl returned an invalid response object");
  }
  return value as Record<string, unknown>;
}

function asFirecrawlPayload(value: unknown): FirecrawlPayload {
  const response = asRecord(value);
  if (typeof response.success !== "boolean") {
    throw new Error("Firecrawl returned an invalid success flag");
  }
  return {
    success: response.success,
    data: response.data,
    error: typeof response.error === "string" ? response.error : undefined,
  };
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Firecrawl returned an invalid ${field}`);
  }
  return value.trim();
}

function asFacts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Firecrawl returned invalid extracted facts");
  }
  const facts = value.map((fact) => asString(fact, "extracted fact"));
  if (facts.length === 0) {
    throw new Error("Firecrawl returned no extracted facts");
  }
  return facts;
}

export function parseFirecrawlResponse(
  payload: unknown,
  source: AllowlistedSource,
  fetchedAt: number,
): FirecrawlRefreshResult {
  const response = asFirecrawlPayload(payload);
  if (response.success !== true) {
    throw new Error(response.error ?? "Firecrawl request failed");
  }
  const data = asRecord(response.data);
  const extracted = asRecord(data.json);
  return {
    url: source.url,
    publisher: source.publisher,
    excerpt: asString(extracted.excerpt, "excerpt"),
    extractedFacts: asFacts(extracted.extractedFacts),
    fetchedAt,
  };
}

async function refresh(input: FirecrawlRefreshInput): Promise<FirecrawlRefreshResult> {
  const source = findAllowlistedSource(input);
  const apiKey = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is required for research crawling");
  }

  const response = await fetch(firecrawlEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: source.url,
      onlyMainContent: true,
      formats: [
        "markdown",
        { type: "json", schema: extractionSchema },
        { type: "changeTracking", modes: ["git-diff"] },
      ],
      timeout: 120000,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Firecrawl HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return parseFirecrawlResponse(body, source, Date.now());
}

export const firecrawlAdapter: FirecrawlAdapter = { refresh };

type PersistResearchDocument<Return> = (
  document: FirecrawlRefreshResult,
) => Promise<Return>;

async function refreshAndStore<Return>(
  source: AllowlistedSource,
  persist: PersistResearchDocument<Return>,
): Promise<Return> {
  const result = await firecrawlAdapter.refresh(source);
  return persist(result);
}

export const crawl = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<Id<"researchDocs">> => {
    const source = allowlistedSources.find((candidate) => candidate.url === args.url);
    if (!source) {
      throw new Error(`Firecrawl source is not allowlisted: ${args.url}`);
    }
    return refreshAndStore(source, (document) =>
      ctx.runMutation(internal.research.store.save, document),
    );
  },
});

export const refreshAll = action({
  args: {},
  handler: async (ctx): Promise<Id<"researchDocs">[]> => {
    const ids: Id<"researchDocs">[] = [];
    for (const source of allowlistedSources) {
      ids.push(
        await refreshAndStore(source, (document) =>
          ctx.runMutation(internal.research.store.save, document),
        ),
      );
    }
    return ids;
  },
});
