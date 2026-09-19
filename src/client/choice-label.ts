import type { Choice } from "../domain/model";

export function choiceLabel(action: Choice | "ABSTAIN" | null) {
  if (action === null) return "";

  return action === "CASH" ? "SELL" : action;
}
