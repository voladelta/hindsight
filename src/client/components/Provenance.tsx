import { useState } from "react";
import { FileText } from "lucide-react";
import type { ProvenanceDTO } from "../../domain/dto";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function Provenance({ id }: { id: string }) {
  const [data, setData] = useState<ProvenanceDTO>();
  const [error, setError] = useState("");
  async function load(open: boolean) {
    if (!open || data) return;
    setError("");
    try {
      const response = await fetch(`/api/rounds/${id}/provenance`);
      if (!response.ok)
        throw new Error(
          "Could not load the round data. Close and reopen to try again.",
        );
      setData(await response.json());
    } catch {
      setError("Could not load the round data. Close and reopen to try again.");
    }
  }
  return (
    <Dialog onOpenChange={(open) => void load(open)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileText />
          Data and assumptions
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="drawer-title">Data and assumptions</DialogTitle>
        <DialogDescription className="muted">
          See the historical inputs, timing assumptions, and limits of this
          round.
        </DialogDescription>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">Loading round data…</p>}
        {data && (
          <div className="provenance-content">
            <span className="source-badge">{data.source}</span>
            <dl>
              <dt>Scenario version</dt>
              <dd>{data.version}</dd>
              <dt>Input cutoff (exclusive, UTC)</dt>
              <dd>{data.inputCutoffExclusive}</dd>
              <dt>Assumed availability delay</dt>
              <dd>{data.assumedAvailabilityDelayHours} hours</dd>
              <dt>Entry / exit (UTC)</dt>
              <dd>
                {data.entryAt}
                <br />
                {data.exitAt}
              </dd>
              <dt>Scenario prepared</dt>
              <dd>{data.preparedAt}</dd>
              <dt>Data retrieved</dt>
              <dd>{data.fetchedAt ?? "None — invented fixture"}</dd>
              <dt>Rule</dt>
              <dd>{data.ruleVersion}</dd>
              <dt>Selection policy</dt>
              <dd>{data.selectionPolicy}</dd>
              <dt>Opponent choice</dt>
              <dd>{data.ruleOutput === "CASH" ? "SELL" : data.ruleOutput}</dd>
              <dt>Coverage</dt>
              <dd>
                {Object.entries(data.coverage).map(([key, val]) => (
                  <div key={key}>
                    {key}: {val}
                  </div>
                ))}
              </dd>
              <dt>Price references</dt>
              <dd>{data.priceReference}</dd>
              <dt>Request fingerprints</dt>
              <dd>
                {data.requestFingerprints.length
                  ? data.requestFingerprints.map((fingerprint) => (
                      <div key={fingerprint}>{fingerprint}</div>
                    ))
                  : "None — no upstream requests"}
              </dd>
              <dt>Provider coverage warnings</dt>
              <dd>
                {data.providerWarnings.length
                  ? data.providerWarnings.join(", ")
                  : "None reported"}
              </dd>
            </dl>
            <h3>What this result means</h3>
            {data.notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
