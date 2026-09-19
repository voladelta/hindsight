import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  choiceSchema,
  roundDurationSchema,
  roundSchema,
  type Round,
} from "../domain/model";
import {
  replayNetworks,
  replayNetworkSchema,
} from "../domain/replay-selection";
import { publicProvenance, publicRound } from "../domain/dto";
import { inputs, requests, rounds, sessions, type Store } from "./db";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const mutationSchema = z.object({ choice: choiceSchema }).strict();
const creationSchema = z
  .object({
    duration: roundDurationSchema,
    chain: replayNetworkSchema.default("ethereum"),
  })
  .strict();
const emptySchema = z.object({}).strict();

export function createApi(store: Store, origin: string) {
  const { db, sqlite } = store;
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const respond = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    try {
      const path = new URL(request.url).pathname;
      if (path === "/api/health" && request.method === "GET")
        return respond({ ready: true });
      if (request.method !== "GET" && request.headers.get("origin") !== origin)
        throw new HttpError(403, "This request must come from this app.");
      if (request.method !== "GET" && request.method !== "POST")
        throw new HttpError(405, "Method not allowed.");

      const token = request.headers
        .get("cookie")
        ?.match(/(?:^|;\s*)hindsight_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      let owner = token ? digest(token) : "";
      const session = owner
        ? db.select().from(sessions).where(eq(sessions.owner, owner)).get()
        : undefined;
      const now = Date.now();
      if (!session || session.expires <= now) {
        if (path !== "/api/session")
          throw new HttpError(
            401,
            "Your session expired. Return home to start a new round.",
          );
        const newToken = randomBytes(32).toString("hex");
        owner = digest(newToken);
        db.insert(sessions)
          .values({ owner, expires: now + 30 * 86400000 })
          .run();
        headers.set(
          "Set-Cookie",
          `hindsight_session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${origin.startsWith("https:") ? "; Secure" : ""}`,
        );
      }
      if (path === "/api/session" && request.method === "GET") {
        const preparedInputs = db
          .select()
          .from(inputs)
          .all()
          .map((row) => {
            const payload = JSON.parse(row.payload) as {
              identity?: { chain?: string };
              source?: string;
            };
            return payload;
          });
        const wantedSources = new Set(["nansen-v1", "nansen-v2"]);
        const networks = replayNetworks.map((network) => {
          const networkInputs = preparedInputs.filter(
            (input) =>
              wantedSources.has(input.source ?? "") &&
              input.identity?.chain === network.label,
          );
          const preparedCounts = {
            intraday: networkInputs.filter(
              (input) => input.source === "nansen-v2",
            ).length,
            sevenDays: networkInputs.filter(
              (input) => input.source === "nansen-v1",
            ).length,
          };
          const preparedCount =
            preparedCounts.intraday + preparedCounts.sevenDays;
          return {
            ...network,
            available: preparedCount > 0,
            preparedCount,
            preparedCounts,
            unavailableReason:
              preparedCount > 0
                ? null
                : "No historical replays are prepared for this network yet.",
          };
        });

        return respond({
          ready: true,
          replayNetworks: networks,
        });
      }
      const match =
        /^\/api\/rounds\/([0-9a-f-]{36})(?:\/(initial|final|reveal|provenance))?$/.exec(
          path,
        );
      const creating = path === "/api/rounds" && request.method === "POST";
      if (!creating && !match) throw new HttpError(404, "Not found.");
      const id = match?.[1];
      const action = match?.[2];
      const owned = () => {
        const row = db
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, id!), eq(rounds.owner, owner)))
          .get();
        if (!row) throw new HttpError(404, "Round not found.");
        return {
          row,
          round: roundSchema.parse(JSON.parse(row.payload)),
          scenario: store.scenario(row.version),
        };
      };
      if (request.method === "GET") {
        const { round, scenario } = owned();
        if (action === "provenance") {
          if (round.state !== "REVEALED")
            throw new HttpError(
              409,
              "Reveal the round before opening provenance.",
            );
          return respond(publicProvenance(scenario));
        }
        if (action) throw new HttpError(405, "Method not allowed.");
        return respond(publicRound(round, scenario));
      }
      const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
      if (!key.success)
        throw new HttpError(400, "A valid idempotency key is required.");
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new HttpError(400, "Send a JSON request.");
      const bodyText = await request.text();
      if (bodyText.length > 1024)
        throw new HttpError(413, "Request too large.");
      let raw: unknown;
      try {
        raw = JSON.parse(bodyText);
      } catch {
        throw new HttpError(400, "Invalid request.");
      }
      const body = (
        action === "initial" || action === "final"
          ? mutationSchema
          : creating
            ? creationSchema
            : emptySchema
      ).safeParse(raw);
      if (!body.success) throw new HttpError(400, "Invalid round request.");
      const hash = digest(`${path}:${JSON.stringify(body.data)}`);
      const requestId = `${owner}:${key.data}`;

      const result = sqlite
        .transaction(() => {
          // Ownership is checked even when returning a saved idempotent response.
          if (!creating) owned();
          const saved = db
            .select()
            .from(requests)
            .where(eq(requests.id, requestId))
            .get();
          if (saved) {
            if (saved.hash !== hash)
              throw new HttpError(
                409,
                "This request key was already used for a different action.",
              );
            return JSON.parse(saved.response) as unknown;
          }
          let response: unknown;
          if (creating) {
            const selection = creationSchema.parse(body.data);
            if (
              process.env.DEPLOYMENT_MODE !== "local" &&
              process.env.PUBLIC_NANSEN_DISPLAY_APPROVED !== "true"
            )
              throw new HttpError(
                503,
                "Public Nansen-backed playback is disabled pending written display approval.",
              );
            const allInputs = db
              .select()
              .from(inputs)
              .orderBy(inputs.ordinal)
              .all();
            const eligible = allInputs.filter((row) => {
              const parsed = JSON.parse(row.payload) as {
                source?: string;
                identity?: { chain?: string };
              };
              const source = parsed.source;
              const duration = selection.duration;
              const wantedSource =
                duration === "INTRADAY" ? "nansen-v2" : "nansen-v1";
              return (
                source === wantedSource &&
                parsed.identity?.chain ===
                  replayNetworks.find(
                    (network) => network.value === selection.chain,
                  )!.label
              );
            });
            if (!eligible.length)
              throw new HttpError(
                503,
                "No historical replays are prepared for that network and duration. Run a Nansen preparation command or choose another prepared network.",
              );
            const count = db
              .select({ count: sql<number>`count(*)` })
              .from(rounds)
              .where(eq(rounds.owner, owner))
              .get()!.count;
            const input = eligible[count % eligible.length]!;
            const round: Round = { id: randomUUID(), state: "BLIND" };
            db.insert(rounds)
              .values({
                id: round.id,
                owner,
                version: input.version,
                payload: JSON.stringify(round),
              })
              .run();
            response = publicRound(round, store.scenario(input.version));
          } else {
            const { round, scenario } = owned();
            let next: Round;
            const choice =
              "choice" in body.data
                ? choiceSchema.parse(body.data.choice)
                : undefined;
            if (action === "initial" && round.state === "BLIND" && choice)
              next = { id: round.id, state: "EVIDENCE", initial: choice };
            else if (action === "final" && round.state === "EVIDENCE" && choice)
              next = { ...round, state: "LOCKED", final: choice };
            else if (action === "reveal" && round.state === "LOCKED")
              next = { ...round, state: "REVEALED" };
            else
              throw new HttpError(
                409,
                "This action is not available at this stage. Refresh to restore your round.",
              );
            db.update(rounds)
              .set({ payload: JSON.stringify(next) })
              .where(eq(rounds.id, round.id))
              .run();
            response = publicRound(next, scenario);
          }
          db.insert(requests)
            .values({ id: requestId, hash, response: JSON.stringify(response) })
            .run();
          return response;
        })
        .immediate();
      return respond(result);
    } catch (error) {
      return respond(
        {
          error:
            error instanceof HttpError
              ? error.message
              : "Unable to complete this request. Please try again.",
        },
        error instanceof HttpError ? error.status : 500,
      );
    }
  };
}
