import { z } from "zod";

export const replayNetworkSchema = z.enum(["ethereum", "solana"]);
export type ReplayNetwork = z.infer<typeof replayNetworkSchema>;

export const replayNetworks = [
  {
    value: "ethereum" as const,
    label: "Ethereum",
    detail: "Historical price, flow, and holder replays",
  },
  {
    value: "solana" as const,
    label: "Solana",
    detail: "Historical price, flow, and holder replays",
  },
] as const;

export function replayNetworkLabel(network: ReplayNetwork) {
  return replayNetworks.find((option) => option.value === network)!.label;
}
