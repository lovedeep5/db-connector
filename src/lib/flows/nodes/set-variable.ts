import { z } from "zod";
import type { NodeDef } from "../types";

const VarItem = z.object({
  name: z.string().min(1, "Variable name required"),
  value: z.unknown(),
});

/**
 * Set Variable supports 1–15 named variables in a single node. The form
 * stores them as `vars: [{ name, value }, ...]`. Existing flows that used
 * the legacy single-var shape `{ name, value }` are normalised into a
 * one-item array via the preprocess so they keep running without migration.
 */
const Config = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return { vars: [] };
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.vars)) return { vars: obj.vars };
    // Legacy: single { name, value } at the top level.
    if (typeof obj.name === "string") {
      return { vars: [{ name: obj.name, value: obj.value }] };
    }
    return { vars: [] };
  },
  z.object({
    vars: z.array(VarItem).min(1, "At least one variable").max(15, "Up to 15 variables per node"),
  })
);

type Output = Record<string, unknown>;

export const setVariableNode: NodeDef<z.infer<typeof Config>, Output> = {
  type: "transform.setVariable",
  label: "Set Variable",
  description:
    "Name one or more values (or templated references) so later nodes can reference them by short alias.",
  category: "transform",
  icon: "Variable",
  accent: "slate",
  schema: Config,
  defaultConfig: () => ({ vars: [{ name: "myVar", value: "" }] }),
  takesInput: true,
  async execute(_ctx, cfg) {
    const out: Record<string, unknown> = {};
    for (const v of cfg.vars) out[v.name] = v.value;
    return out;
  },
};
