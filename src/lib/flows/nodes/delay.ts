import { z } from "zod";
import type { NodeDef } from "../types";

const Config = z.object({
  /** Pause duration in milliseconds. Capped at 30 minutes. */
  durationMs: z.coerce.number().int().positive().max(30 * 60_000).default(1_000),
});

export const delayNode: NodeDef<z.infer<typeof Config>, { waitedMs: number }> = {
  type: "control.delay",
  label: "Delay",
  description: "Pause the flow for a fixed duration before continuing.",
  category: "control",
  icon: "Clock",
  accent: "slate",
  schema: Config,
  defaultConfig: () => ({ durationMs: 1_000 }),
  takesInput: true,
  async execute(_ctx, cfg) {
    await new Promise<void>((res) => setTimeout(res, cfg.durationMs));
    return { waitedMs: cfg.durationMs };
  },
};
