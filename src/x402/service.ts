import {
  FacilitatorResponseError,
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPTransportContext,
  type RoutesConfig,
} from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { parseSources } from "@/registry/deployments";
import { resolveSources } from "@/survey/run";
import { operatorFromEnv, sha256Hex, submitReceipt, type Receipt } from "@/hedera/receipts";
import { quoteFor, scheduleFromEnv, type Quote } from "./pricing";

/**
 * The survey as a thing an agent can pay for.
 *
 * `/api/survey` is the same reading the map draws, gated by x402: a request
 * without payment gets a 402 naming the exact price for what it asked, the
 * client signs a Hedera transfer for that amount, retries with it in the
 * payment header, the facilitator verifies it, the survey runs, and the
 * facilitator settles the transfer on Hedera. The settlement transaction id
 * comes back in the response headers, and a receipt with a digest of the body
 * goes to the Consensus Service. Nothing is charged if the survey fails.
 *
 * The price is metered: a base charge plus a charge per deployment the survey
 * is asked to read, quoted in the 402 before any signature is made.
 */
export interface ServiceConfig {
  network: Network;
  facilitatorUrl: string;
  payTo: string;
  publicUrl: string;
  receiptsTopic: string | null;
}

export function facilitatorUrlFor(network: string, env: Record<string, string | undefined> = process.env): string {
  if (env.X402_FACILITATOR_URL) return env.X402_FACILITATOR_URL;
  // Pinned on purpose. The reference implementation defaults testnet to a
  // generic facilitator; this service settles through Blocky402 on both.
  return network.endsWith("mainnet") ? "https://api.blocky402.com" : "https://api.testnet.blocky402.com";
}

export function serviceConfig(env: Record<string, string | undefined> = process.env): ServiceConfig | null {
  const payTo = env.HEDERA_ACCOUNT_ID;
  if (!payTo) return null;
  const network = (env.HEDERA_NETWORK ?? "hedera:testnet") as Network;
  return {
    network,
    facilitatorUrl: facilitatorUrlFor(network, env),
    payTo,
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    receiptsTopic: env.HCS_RECEIPTS_TOPIC ?? null,
  };
}

/** The price for a request, from what it asks for. */
export function quoteForRequest(sourcesParam: string | null): Quote {
  const { deployments } = resolveSources(parseSources(sourcesParam));
  return quoteFor(deployments.length, scheduleFromEnv());
}

/* ── the request seen through x402's adapter ──────────────────────── */

class RequestAdapter implements HTTPAdapter {
  private readonly url: URL;
  constructor(private readonly req: Request) {
    this.url = new URL(req.url);
  }
  getHeader(name: string): string | undefined {
    return this.req.headers.get(name) ?? undefined;
  }
  getMethod(): string {
    return this.req.method;
  }
  getPath(): string {
    return this.url.pathname;
  }
  getUrl(): string {
    return this.req.url;
  }
  getAcceptHeader(): string {
    return this.req.headers.get("accept") ?? "";
  }
  getUserAgent(): string {
    return this.req.headers.get("user-agent") ?? "";
  }
  getQueryParams(): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of this.url.searchParams) {
      const prev = out[k];
      out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
    }
    return out;
  }
  getQueryParam(name: string): string | string[] | undefined {
    const all = this.url.searchParams.getAll(name);
    return all.length === 0 ? undefined : all.length === 1 ? all[0] : all;
  }
  async getBody(): Promise<unknown> {
    try {
      return await this.req.clone().json();
    } catch {
      return undefined;
    }
  }
}

function requestContext(req: Request): HTTPRequestContext {
  const adapter = new RequestAdapter(req);
  const paymentHeader = adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment");
  return {
    adapter,
    path: adapter.getPath(),
    method: req.method,
    ...(paymentHeader ? { paymentHeader } : {}),
  };
}

/* ── the resource server ──────────────────────────────────────────── */

interface Built {
  http: x402HTTPResourceServer;
  init: () => Promise<void>;
}

let built: Built | null = null;

function routes(cfg: ServiceConfig): RoutesConfig {
  return {
    "GET /api/survey": {
      accepts: [
        {
          scheme: "exact",
          network: cfg.network,
          payTo: cfg.payTo,
          maxTimeoutSeconds: 300,
          price: async (ctx) => {
            const q = quoteForRequest(single(ctx.adapter.getQueryParam?.("sources")));
            return { asset: q.asset, amount: String(q.tinybar) };
          },
        },
      ],
      resource: `${cfg.publicUrl}/api/survey`,
      // The requirements travel in the PAYMENT-REQUIRED header; the body is
      // for whoever reads it by hand, or an agent that has not seen the manifest.
      unpaidResponseBody: (ctx) => {
        const q = quoteForRequest(single(ctx.adapter.getQueryParam?.("sources")));
        return {
          contentType: "application/json",
          body: {
            error: "payment required",
            price: { tinybar: q.tinybar, hbar: q.hbar, asset: q.asset, network: cfg.network, sourcesAsked: q.sources },
            how: "sign an x402 exact-scheme HBAR transfer for this amount to payTo and retry with it in the PAYMENT-SIGNATURE header; the requirements are in the PAYMENT-REQUIRED header",
            manifest: `${cfg.publicUrl}/api/survey/manifest`,
            free: `${cfg.publicUrl}/api/terrain`,
          },
        };
      },
      description:
        "Liquidation survey of one address across standardized lending deployments: baskets, spot, shape, per-source block heights. Priced per deployment asked.",
      mimeType: "application/json",
      serviceName: "Scree survey",
      tags: ["defi", "lending", "liquidation", "risk", "the-graph", "messari"],
    },
  };
}

function single(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function build(cfg: ServiceConfig): Built {
  const facilitator = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(cfg.network, new ExactHederaScheme({}));

  server.onAfterSettle(async (ctx) => {
    if (!ctx.result.success) return;
    const op = operatorFromEnv();
    if (!op || !cfg.receiptsTopic) return;
    const transport = ctx.transportContext as HTTPTransportContext | undefined;
    const body = transport?.responseBody;
    let parsed: { address?: string; askedOf?: string[]; healthy?: string[]; spot?: number | null; shape?: string } = {};
    try {
      parsed = body ? (JSON.parse(body.toString("utf8")) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    const receipt: Receipt = {
      v: 1,
      kind: "survey",
      at: new Date().toISOString(),
      address: parsed.address ?? single(transport?.request.adapter.getQueryParam?.("address")) ?? "",
      asked: parsed.askedOf ?? [],
      healthy: parsed.healthy ?? [],
      spot: parsed.spot ?? null,
      shape: parsed.shape ?? null,
      payer: ctx.result.payer ?? null,
      payTo: ctx.requirements.payTo,
      network: ctx.requirements.network,
      asset: ctx.requirements.asset,
      amount: ctx.requirements.amount,
      transaction: ctx.result.transaction,
      bodySha256: body ? sha256Hex(body) : "",
    };
    // The buyer should not wait on consensus for the survey they already paid for.
    void submitReceipt(op, cfg.receiptsTopic, receipt).catch((err) => {
      console.error("[scree] receipt not recorded:", err instanceof Error ? err.message : err);
    });
  });

  const http = new x402HTTPResourceServer(server, routes(cfg));
  let initPromise: Promise<void> | null = null;
  let ready = false;
  const init = async () => {
    if (ready) return;
    initPromise ??= http.initialize();
    try {
      await initPromise;
      ready = true;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  };
  return { http, init };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Gate a route handler behind payment.
 *
 * Mirrors the flow of x402's framework bindings: verify the payment header
 * against the facilitator, run the handler, settle after it succeeds, and
 * cancel instead of settling if the handler fails, so a survey that could not
 * be produced is never charged for.
 */
export function paid(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const cfg = serviceConfig();
    if (!cfg) {
      return json({ error: "the paid survey is not configured on this deployment (HEDERA_ACCOUNT_ID)" }, 503);
    }
    built ??= build(cfg);
    const { http, init } = built;

    try {
      await init();
    } catch (err) {
      return facilitatorFailure(err);
    }

    const context = requestContext(req);
    let result: Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
    try {
      result = await http.processHTTPRequest(context);
    } catch (err) {
      return facilitatorFailure(err);
    }

    switch (result.type) {
      case "no-payment-required":
        return handler(req);
      case "payment-error": {
        const r = result.response;
        const headers = new Headers(r.headers);
        headers.set("content-type", r.isHtml ? "text/html" : "application/json");
        return new Response(r.isHtml ? String(r.body) : JSON.stringify(r.body ?? {}), { status: r.status, headers });
      }
      case "payment-verified": {
        let response: Response;
        try {
          response = await handler(req);
        } catch (err) {
          const cancel = await result.cancellationDispatcher.cancel({ reason: "handler_threw", error: err });
          const failure = json({ error: "the survey failed; nothing was charged" }, 500);
          const failureHeaders = http.createFailurePathSettlementHeaders(cancel, result.beforeHandlerSettlement, result.paymentPayload);
          if (failureHeaders) for (const [k, v] of Object.entries(failureHeaders)) failure.headers.set(k, v);
          return failure;
        }
        if (response.status >= 400) {
          const cancel = await result.cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: response.status });
          const failureHeaders = http.createFailurePathSettlementHeaders(cancel, result.beforeHandlerSettlement, result.paymentPayload, response.headers.get("cache-control"));
          if (failureHeaders) for (const [k, v] of Object.entries(failureHeaders)) response.headers.set(k, v);
          return response;
        }
        try {
          const responseBody = Buffer.from(await response.clone().arrayBuffer());
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((v, k) => {
            responseHeaders[k] = v;
          });
          const settled = await http.processSettlement(
            result.paymentPayload,
            result.paymentRequirements,
            result.declaredExtensions,
            { request: context, responseBody, responseHeaders },
            undefined,
            result.beforeHandlerSettlement,
          );
          if (!settled.success) {
            const r = settled.response;
            return new Response(r.isHtml ? String(r.body) : JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
          }
          for (const [k, v] of Object.entries(settled.headers)) response.headers.set(k, v);
          response.headers.set("cache-control", "private, no-store");
          return response;
        } catch (err) {
          if (err instanceof FacilitatorResponseError) return facilitatorFailure(err);
          console.error("[scree] settlement failed:", err);
          return json({ error: "settlement failed" }, 402);
        }
      }
    }
  };
}

function facilitatorFailure(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[scree] facilitator:", message);
  return json({ error: `facilitator unavailable: ${message}` }, 502);
}
