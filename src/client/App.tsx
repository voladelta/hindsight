import { useEffect, useState, useCallback } from "react";
import {
  ArrowRight,
  Check,
  Compass,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { Choice, Evidence, RoundDuration } from "../domain/model";
import type { ReplayNetwork } from "../domain/replay-selection";
import type { RoundDTO } from "../domain/dto";
import homeHeroIllustration from "./assets/home-hero.png";
import { PriceChart } from "./components/PriceChart";
import { EvidenceCards } from "./components/EvidenceCards";
import { Provenance } from "./components/Provenance";
import { ResultsComparison } from "./components/ResultsComparison";
import { Button } from "./components/ui/button";
import { choiceLabel } from "./choice-label";

type ReplayNetworkOption = {
  value: ReplayNetwork | "robinhood";
  label: string;
  detail: string;
  available: boolean;
  preparedCount: number;
  preparedCounts: { intraday: number; sevenDays: number };
  unavailableReason: string | null;
};

function getUuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          +c ^
          (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))
        ).toString(16),
      );
}

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [sessionReady, setSessionReady] = useState(false);
  const [replayNetworks, setReplayNetworks] = useState<ReplayNetworkOption[]>(
    [],
  );
  const [sessionError, setSessionError] = useState("");

  const [currentRound, setCurrentRound] = useState<RoundDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pendingChoice, setPendingChoice] = useState<Choice | null>(null);
  const [roundDuration, setRoundDuration] = useState<RoundDuration>("INTRADAY");
  const [replayNetwork, setReplayNetwork] = useState<ReplayNetwork>("solana");
  const selectedNetwork = replayNetworks.find(
    (option) => option.value === replayNetwork,
  );
  const selectedDurationCount = selectedNetwork
    ? roundDuration === "INTRADAY"
      ? selectedNetwork.preparedCounts.intraday
      : selectedNetwork.preparedCounts.sevenDays
    : 0;

  const selectRoundDuration = (duration: RoundDuration) => {
    setRoundDuration(duration);
    const countKey = duration === "INTRADAY" ? "intraday" : "sevenDays";

    if ((selectedNetwork?.preparedCounts[countKey] ?? 0) > 0) return;

    const firstAvailable = replayNetworks.find(
      (option) =>
        option.value !== "robinhood" && option.preparedCounts[countKey] > 0,
    );
    if (firstAvailable && firstAvailable.value !== "robinhood") {
      setReplayNetwork(firstAvailable.value);
    }
  };

  // Sync with browser URL changes
  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
      setPathname(path);
    }
  }, []);

  // Initialize session on mount
  useEffect(() => {
    async function initSession() {
      try {
        const res = await fetch("/api/session", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not initialize session.");
        const data = await res.json();
        setReplayNetworks(data.replayNetworks ?? []);
        const firstIntraday = (
          data.replayNetworks as ReplayNetworkOption[]
        )?.find(
          (option) =>
            option.preparedCounts.intraday > 0 && option.value !== "robinhood",
        );
        if (firstIntraday && firstIntraday.value !== "robinhood") {
          setReplayNetwork(firstIntraday.value);
        }
        setSessionReady(true);
      } catch {
        setSessionError(
          "Could not start your session. Check your connection and reload the page.",
        );
      }
    }
    void initSession();
  }, []);

  // Extract round ID from pathname: /play/:id
  const playMatch = /^\/play\/([0-9a-f-]{36})$/.exec(pathname);
  const activeRoundId = playMatch?.[1];

  // Load round when activeRoundId changes
  useEffect(() => {
    if (!activeRoundId || !sessionReady) return;
    let cancelled = false;
    async function fetchRound() {
      setLoading(true);
      setActionError("");
      try {
        const res = await fetch(`/api/rounds/${activeRoundId}`, {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (!res.ok) {
          setActionError(
            res.status === 404
              ? "This round is unavailable. Select Hindsight to return home and start a new round."
              : "Could not load this round. Reload the page to try again.",
          );
          return;
        }
        const data: RoundDTO = await res.json();
        if (cancelled) return;
        setCurrentRound(data);
        setRoundDuration(
          data.chart.unit === "hour" ? "INTRADAY" : "SEVEN_DAYS",
        );
        if (data.state === "EVIDENCE") {
          setPendingChoice(data.initial);
        }
      } catch {
        if (!cancelled)
          setActionError(
            "Could not load this round. Check your connection and reload the page.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchRound();
    return () => {
      cancelled = true;
    };
  }, [activeRoundId, sessionReady]);

  // Start new round
  const startNewRound = async () => {
    setSubmitting(true);
    setActionError("");
    try {
      const res = await fetch("/api/rounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getUuid(),
        },
        body: JSON.stringify({
          duration: roundDuration,
          chain: replayNetwork,
        }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Round creation was not confirmed.");
      }
      const data: RoundDTO = await res.json();
      setCurrentRound(data);
      setPendingChoice(null);
      navigate(`/play/${data.id}`);
    } catch {
      setActionError(
        "Could not open a new round. Check your connection and try starting a new round again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const returnToPicker = () => {
    setCurrentRound(null);
    setPendingChoice(null);
    setActionError("");
    navigate("/");
  };

  // Submit initial choice (BLIND -> EVIDENCE)
  const submitInitial = async (choice: Choice) => {
    if (!currentRound) return;
    setSubmitting(true);
    setActionError("");
    try {
      const res = await fetch(`/api/rounds/${currentRound.id}/initial`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getUuid(),
        },
        body: JSON.stringify({ choice }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Initial choice was not confirmed.");
      }
      const next: RoundDTO = await res.json();
      setCurrentRound(next);
      setPendingChoice(choice);
    } catch {
      setActionError(
        "Could not confirm your first choice was saved. Reload the round to check its status.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Submit final choice (EVIDENCE -> LOCKED)
  const submitFinal = async () => {
    if (!currentRound || !pendingChoice) return;
    setSubmitting(true);
    setActionError("");
    try {
      const res = await fetch(`/api/rounds/${currentRound.id}/final`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getUuid(),
        },
        body: JSON.stringify({ choice: pendingChoice }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Final choice was not confirmed.");
      }
      const next: RoundDTO = await res.json();
      setCurrentRound(next);
    } catch {
      setActionError(
        "Could not confirm your final choice was locked. Reload the round to check its status.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Submit reveal (LOCKED -> REVEALED)
  const submitReveal = async () => {
    if (!currentRound) return;
    setSubmitting(true);
    setActionError("");
    try {
      const res = await fetch(`/api/rounds/${currentRound.id}/reveal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getUuid(),
        },
        body: JSON.stringify({}),
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Outcome reveal was not confirmed.");
      }
      const next: RoundDTO = await res.json();
      setCurrentRound(next);
    } catch {
      setActionError(
        "Could not display the outcome. Reload the round to check its status.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Global header */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="text-base font-bold tracking-tight text-foreground hover:text-primary transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Compass className="size-5 text-primary" />
              <span>Hindsight</span>
            </button>
            <span className="hidden sm:inline-block text-xs font-mono px-2 py-0.5 rounded bg-secondary text-secondary-foreground border border-border">
              Nansen Replay
            </span>
          </div>

          <div className="flex items-center gap-3">
            {currentRound && activeRoundId && (
              <>
                {currentRound.state === "REVEALED" && (
                  <Provenance id={currentRound.id} />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={returnToPicker}
                  disabled={submitting}
                  aria-label="Start new round"
                >
                  <RotateCcw className="size-3.5" />
                  <span className="hidden sm:inline">Start new round</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {sessionError && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-center gap-3"
          >
            <ShieldAlert className="size-5 shrink-0" />
            <span>{sessionError}</span>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <ShieldAlert className="size-5 shrink-0" />
              <span>{actionError}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionError("")}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Route: Landing View */}
        {!activeRoundId && (
          <div className="py-8 sm:py-16 space-y-12">
            <div className="landing-hero">
              <div className="max-w-2xl space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                  <Sparkles className="size-3.5" />
                  <span>Historical Decision Replay</span>
                </div>
                <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-tight">
                  Make the call. Read the evidence. Replay the outcome.
                </h1>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                  A blind historical decision game. Pick an intraday or
                  seven-day replay, make an initial BUY or SELL call, inspect
                  onchain evidence, keep or change your choice, and discover
                  whether the evidence changed your simulated outcome.
                </p>
              </div>

              <img
                className="home-illustration"
                src={homeHeroIllustration}
                alt=""
                aria-hidden="true"
              />
            </div>

            {/* How it works */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="p-5 rounded-xl border border-border bg-card space-y-2">
                <div className="font-mono text-xs text-primary font-bold">
                  01 · BLIND CALL
                </div>
                <h2 className="font-semibold text-foreground">
                  Blind Price Chart
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Review 30 days of hourly or daily closing prices. Price is
                  normalized to 100; token identity, dates, and future returns
                  stay hidden.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-border bg-card space-y-2">
                <div className="font-mono text-xs text-primary font-bold">
                  02 · ONCHAIN EVIDENCE
                </div>
                <h2 className="font-semibold text-foreground">
                  Historical DEX Evidence
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Unlock Smart Money token pressure, buyer and seller breadth,
                  DEX turnover, and top 10 supply concentration. Keep your call
                  or change your mind, then lock your final decision.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-border bg-card space-y-2">
                <div className="font-mono text-xs text-primary font-bold">
                  03 · YOUR TIMEFRAME
                </div>
                <h2 className="font-semibold text-foreground">
                  Full Strategy Comparison
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Reveal the 24-hour or 7-day outcome and compare your first
                  choice, final choice, fixed-rule opponent, and always-buy
                  baseline on $1,000 virtual USD.
                </p>
              </div>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-foreground">
                Choose a token pool
              </legend>
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Pick the network you want to explore. The server chooses an
                eligible prepared token from that pool, while its name and dates
                stay hidden until reveal.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                {replayNetworks.map((option) => {
                  const selected = replayNetwork === option.value;
                  const durationCount =
                    roundDuration === "INTRADAY"
                      ? option.preparedCounts.intraday
                      : option.preparedCounts.sevenDays;
                  const availableForDuration = durationCount > 0;
                  return (
                    <label
                      key={option.value}
                      className={`min-h-24 rounded-xl border p-4 transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background ${
                        availableForDuration
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-60"
                      } ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card"
                      }`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="replay-network"
                        value={option.value}
                        checked={selected}
                        disabled={!availableForDuration}
                        onChange={() => {
                          if (option.value !== "robinhood") {
                            setReplayNetwork(option.value);
                          }
                        }}
                      />
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-foreground">
                          {option.label}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {availableForDuration
                            ? `${durationCount} replays ready`
                            : "Unavailable"}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {availableForDuration
                          ? option.detail
                          : `No ${roundDuration === "INTRADAY" ? "intraday" : "swing"} DEX replays prepared`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-foreground">
                Choose your replay duration
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                {(
                  [
                    {
                      value: "INTRADAY",
                      title: "Intraday · 24 hours",
                      detail:
                        "Hourly closing prices · reveal the next 24 hours",
                    },
                    {
                      value: "SEVEN_DAYS",
                      title: "Swing · 7 days",
                      detail: "Daily closing prices · reveal the next 7 days",
                    },
                  ] as const
                ).map((option) => {
                  const countKey =
                    option.value === "INTRADAY" ? "intraday" : "sevenDays";
                  const available = replayNetworks.some(
                    (network) => network.preparedCounts[countKey] > 0,
                  );

                  return (
                    <label
                      key={option.value}
                      className={`min-h-20 rounded-xl border p-4 transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background ${
                        available
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-60"
                      } ${
                        roundDuration === option.value
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card"
                      }`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="round-duration"
                        value={option.value}
                        checked={roundDuration === option.value}
                        disabled={!available}
                        onChange={() => selectRoundDuration(option.value)}
                      />
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-foreground">
                          {option.title}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`size-4 rounded-full border-2 ${
                            roundDuration === option.value
                              ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--color-background)]"
                              : "border-muted-foreground"
                          }`}
                        />
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {available ? option.detail : "No prepared DEX replays"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* CTA */}
            <div className="pt-1 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Button
                size="lg"
                className="w-full sm:w-auto font-semibold gap-2"
                onClick={() => void startNewRound()}
                disabled={
                  submitting || !sessionReady || selectedDurationCount === 0
                }
              >
                <Play className="size-4 fill-current" />
                {submitting ? "Preparing round…" : "Start round"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {sessionReady && selectedDurationCount === 0
                  ? `No ${roundDuration === "INTRADAY" ? "intraday" : "swing"} replays are ready for ${selectedNetwork?.label ?? "this network"}. Choose another pool or duration.`
                  : "No real money or wallet connection required. 100% simulated execution."}
              </span>
            </div>
          </div>
        )}

        {/* Route: Play Round View */}
        {activeRoundId && (
          <div className="space-y-8">
            {loading && (
              <div
                role="status"
                className="py-24 text-center text-muted-foreground flex flex-col items-center justify-center gap-3"
              >
                <RefreshCw className="size-6 animate-spin text-primary" />
                <p className="text-sm">Loading historical scenario…</p>
              </div>
            )}

            {!loading && currentRound && (
              <div className="space-y-8">
                {/* Stepper / Status */}
                <div className="border-b border-border pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div>
                      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        Round {currentRound.id.slice(0, 8)}
                      </span>
                      <h1 className="text-2xl font-bold text-foreground">
                        {currentRound.state === "BLIND" &&
                          "Stage 1: Make your initial call"}
                        {currentRound.state === "EVIDENCE" &&
                          "Stage 2: Review onchain evidence"}
                        {currentRound.state === "LOCKED" &&
                          "Stage 3: Decision locked"}
                        {currentRound.state === "REVEALED" &&
                          "Stage 4: Outcome revealed"}
                      </h1>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-mono">
                      <span
                        className={`px-2.5 py-1 rounded-full ${currentRound.state === "BLIND" ? "bg-primary text-primary-foreground font-bold" : "bg-secondary text-muted-foreground"}`}
                      >
                        1. Blind
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span
                        className={`px-2.5 py-1 rounded-full ${currentRound.state === "EVIDENCE" ? "bg-primary text-primary-foreground font-bold" : "bg-secondary text-muted-foreground"}`}
                      >
                        2. Evidence
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span
                        className={`px-2.5 py-1 rounded-full ${currentRound.state === "LOCKED" ? "bg-primary text-primary-foreground font-bold" : "bg-secondary text-muted-foreground"}`}
                      >
                        3. Locked
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span
                        className={`px-2.5 py-1 rounded-full ${currentRound.state === "REVEALED" ? "bg-primary text-primary-foreground font-bold" : "bg-secondary text-muted-foreground"}`}
                      >
                        4. Reveal
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {currentRound.state === "BLIND" &&
                      (currentRound.chart.unit === "hour"
                        ? "Decide BUY or SELL from 30 days of hourly indexed price action. Hour 1 = 100."
                        : "Decide BUY or SELL from 30 days of daily indexed price action. Day 1 = 100.")}
                    {currentRound.state === "EVIDENCE" &&
                      "Historical 7-day evidence is unlocked. Switch your call or keep it, then lock your final decision."}
                    {currentRound.state === "LOCKED" &&
                      `Your final decision is locked. Inspect the fixed-rule opponent’s call, then reveal the ${currentRound.chart.unit === "hour" ? "24-hour" : "7-day"} outcome.`}
                    {currentRound.state === "REVEALED" &&
                      `Explore how your decision, the opponent, and the baseline performed over the ${currentRound.chart.unit === "hour" ? "24-hour" : "7-day"} holding window.`}
                  </p>
                  <p className="mt-3 inline-flex rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                    {currentRound.sourceLabel}
                  </p>
                </div>

                {/* Price Chart */}
                <div className="space-y-2">
                  <PriceChart round={currentRound} />
                </div>

                {/* Stage 1: BLIND Action Controls */}
                {currentRound.state === "BLIND" && (
                  <div className="p-6 rounded-xl border border-border bg-card space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-foreground">
                          Make your initial call
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Would you buy this token or sell and stay out for the
                          next{" "}
                          {currentRound.chart.unit === "hour"
                            ? "24 hours?"
                            : "7 days?"}
                        </p>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        Evidence unlocks after this choice
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        size="lg"
                        className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold py-6 text-base cursor-pointer"
                        disabled={submitting}
                        onClick={() => void submitInitial("BUY")}
                      >
                        BUY
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        className="border-border text-foreground hover:bg-secondary font-bold py-6 text-base cursor-pointer"
                        disabled={submitting}
                        onClick={() => void submitInitial("CASH")}
                      >
                        SELL
                      </Button>
                    </div>
                  </div>
                )}

                {/* Stage 2: EVIDENCE Action Controls */}
                {currentRound.state === "EVIDENCE" && (
                  <div className="space-y-6">
                    <EvidenceCards evidence={currentRound.evidence} />

                    <div className="p-6 rounded-xl border border-border bg-card space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-foreground">
                            Revise or confirm your decision
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Your first call was{" "}
                            <span className="font-bold text-foreground font-mono">
                              {choiceLabel(currentRound.initial)}
                            </span>
                            . Switch or keep it before locking.
                          </p>
                        </div>
                        <span className="text-xs font-mono text-primary">
                          Choice active: {choiceLabel(pendingChoice)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          variant={
                            pendingChoice === "BUY" ? "default" : "outline"
                          }
                          className={`py-6 text-base font-bold cursor-pointer ${
                            pendingChoice === "BUY" ? "ring-2 ring-primary" : ""
                          }`}
                          onClick={() => setPendingChoice("BUY")}
                        >
                          {pendingChoice === "BUY" && (
                            <Check className="size-4 mr-1" />
                          )}
                          BUY
                        </Button>
                        <Button
                          variant={
                            pendingChoice === "CASH" ? "default" : "outline"
                          }
                          className={`py-6 text-base font-bold cursor-pointer ${
                            pendingChoice === "CASH"
                              ? "ring-2 ring-primary"
                              : ""
                          }`}
                          onClick={() => setPendingChoice("CASH")}
                        >
                          {pendingChoice === "CASH" && (
                            <Check className="size-4 mr-1" />
                          )}
                          SELL
                        </Button>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <Button
                          size="lg"
                          className="w-full sm:w-auto font-bold gap-2 cursor-pointer"
                          disabled={submitting || !pendingChoice}
                          onClick={() => void submitFinal()}
                        >
                          <TrendingUp className="size-4" />
                          {submitting
                            ? "Locking…"
                            : `Lock final decision (${choiceLabel(pendingChoice)})`}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stage 3: LOCKED Action Controls */}
                {currentRound.state === "LOCKED" && (
                  <div className="space-y-6">
                    {/* Opponent Card */}
                    <div className="p-5 rounded-xl border border-border bg-card space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-muted-foreground uppercase">
                          Fixed-Rule Opponent Call
                        </span>
                        <span
                          className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${
                            currentRound.opponent.action === "BUY"
                              ? "bg-primary/20 text-primary border border-primary/30"
                              : currentRound.opponent.action === "CASH"
                                ? "bg-secondary text-secondary-foreground border border-border"
                                : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {choiceLabel(currentRound.opponent.action)}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {currentRound.opponent.explanation}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Rule:{" "}
                        <code className="font-mono text-foreground">
                          {currentRound.assumptions.ruleVersion}
                        </code>{" "}
                        · Deterministic evaluation using historical evidence
                        only. Not an AI predicting prices.
                      </p>
                    </div>

                    <EvidenceCards evidence={currentRound.evidence} />

                    {/* Reveal Action Button */}
                    <div className="p-6 rounded-xl border border-border bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-foreground">
                          Ready to reveal the outcome
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Your first call:{" "}
                          <span className="font-mono text-foreground font-bold">
                            {choiceLabel(currentRound.initial)}
                          </span>{" "}
                          → Final locked call:{" "}
                          <span className="font-mono text-foreground font-bold">
                            {choiceLabel(currentRound.final)}
                          </span>
                        </p>
                      </div>
                      <Button
                        size="lg"
                        className="w-full sm:w-auto font-bold gap-2 cursor-pointer"
                        disabled={submitting}
                        onClick={() => void submitReveal()}
                      >
                        <Play className="size-4 fill-current" />
                        {submitting
                          ? "Revealing…"
                          : currentRound.chart.unit === "hour"
                            ? "Reveal next 24 hours"
                            : "Reveal next 7 days"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Stage 4: REVEALED View */}
                {currentRound.state === "REVEALED" && (
                  <div className="space-y-8">
                    <ResultsComparison round={currentRound} />

                    <EvidenceCards
                      evidence={currentRound.evidence as Evidence}
                    />

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
                      <Provenance id={currentRound.id} />
                      <Button
                        size="lg"
                        className="w-full sm:w-auto font-bold gap-2 cursor-pointer"
                        onClick={returnToPicker}
                        disabled={submitting}
                      >
                        <RotateCcw className="size-4" />
                        Start new round
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global footer */}
      <footer className="border-t border-border py-6 text-xs text-muted-foreground mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <span>Hindsight · Cached Historical Replay</span>
          </div>
          <div className="flex items-center gap-4">
            <span>No real funds at risk</span>
            <span>$1,000 virtual capital</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
