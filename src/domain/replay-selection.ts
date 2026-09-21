import { z } from "zod";

export const replayNetworkSchema = z.enum(["ethereum", "solana"]);
export type ReplayNetwork = z.infer<typeof replayNetworkSchema>;

export const replayNetworks = [
  {
    value: "solana" as const,
    label: "Solana",
    detail: "Memecoin Smart Money DEX replays",
  },
  {
    value: "ethereum" as const,
    label: "Ethereum",
    detail: "Exploratory non-stablecoin Smart Money DEX replays",
  },
] as const;

export function replayNetworkLabel(network: ReplayNetwork) {
  return replayNetworks.find((option) => option.value === network)!.label;
}
