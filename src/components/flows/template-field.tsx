"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { RefPicker, type RefGroup, type RefPath } from "./ref-picker";
import { cn } from "@/lib/utils";

/**
 * Input/textarea wrappers that:
 *  - host the existing "Insert ref" dropdown button (kept for discoverability),
 *  - and now also provide VS-Code-style inline autocomplete: type `$` and a
 *    filtered suggestion list appears anchored under the field. Arrow keys
 *    navigate, Enter / Tab inserts, Esc closes.
 *
 * Implementation notes:
 *  - The trigger pattern is `\$[\w\.\[\]]*` walked back from the caret. As the
 *    user types, the popup filters refs whose template contains the current
 *    fragment (case-insensitive).
 *  - On select, we REPLACE the trigger fragment (from `$` to caret) with the
 *    chosen full template `{{ $node.foo.bar }}` — so the half-typed `$node.q`
 *    becomes a proper templated reference, not a literal string.
 *  - Anchored to the input element (not the caret pixel position) for
 *    simplicity. A caret-mirror could be added later; for now, "below the
 *    field" is the same UX as VS Code's popup when typing fast.
 */

type Common = {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  refs?: RefGroup[];
  helpText?: string;
};

type FlatRef = RefPath & { group: string };

/** Walk back from `caret` to find a `$`-prefixed trigger fragment, if any. */
function findTrigger(value: string, caret: number): { start: number; fragment: string } | null {
  // Scan up to ~64 chars back so giant textareas don't pay a regex tax.
  const start = Math.max(0, caret - 64);
  const slice = value.slice(start, caret);
  const m = slice.match(/\$[\w$.[\]]*$/);
  if (!m) return null;
  return { start: start + (m.index ?? 0), fragment: m[0] };
}

function useFlatRefs(refs?: RefGroup[]): FlatRef[] {
  return React.useMemo(
    () => (refs ?? []).flatMap((g) => g.paths.map((p) => ({ ...p, group: g.label }))),
    [refs]
  );
}

function filterRefs(refs: FlatRef[], fragment: string): FlatRef[] {
  const q = fragment.toLowerCase();
  // Show everything when the user has just typed `$`.
  if (q === "$" || q === "") return refs;
  return refs.filter((r) => r.template.toLowerCase().includes(q));
}

export function TemplateField({
  label, value, onChange, refs, placeholder, helpText, type,
}: Common & { placeholder?: string; type?: string }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const ac = useAutocomplete(ref, value, onChange, refs);
  return (
    <FieldShell label={label} refs={refs} onPick={(t) => insertAtCursor(ref, value, onChange, t)} helpText={helpText}>
      <Popover open={ac.open}>
        <PopoverAnchor asChild>
          <Input
            ref={ref}
            value={value}
            type={type}
            onChange={(e) => ac.handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onSelect={(e) => ac.handleCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
            onKeyDown={ac.handleKeyDown}
            onBlur={ac.handleBlur}
            placeholder={placeholder}
          />
        </PopoverAnchor>
        <SuggestionList ac={ac} />
      </Popover>
    </FieldShell>
  );
}

export function TemplateTextarea({
  label, value, onChange, refs, placeholder, helpText, rows = 4,
}: Common & { placeholder?: string; rows?: number }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const ac = useAutocomplete(ref, value, onChange, refs);
  return (
    <FieldShell label={label} refs={refs} onPick={(t) => insertAtCursor(ref, value, onChange, t)} helpText={helpText}>
      <Popover open={ac.open}>
        <PopoverAnchor asChild>
          <Textarea
            ref={ref}
            value={value}
            rows={rows}
            onChange={(e) => ac.handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onSelect={(e) => ac.handleCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={ac.handleKeyDown}
            onBlur={ac.handleBlur}
            placeholder={placeholder}
            className="font-mono text-xs"
          />
        </PopoverAnchor>
        <SuggestionList ac={ac} />
      </Popover>
    </FieldShell>
  );
}

function SuggestionList({ ac }: { ac: ReturnType<typeof useAutocomplete> }) {
  if (!ac.open) return null;
  return (
    <PopoverContent
      align="start"
      sideOffset={4}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      // Prevent Radix from stealing focus / closing when the user clicks an item
      onMouseDown={(e) => e.preventDefault()}
      className="w-80 max-h-72 overflow-y-auto p-0"
    >
      {ac.suggestions.map((s, i) => (
        <button
          type="button"
          key={`${s.group}::${s.template}::${i}`}
          onMouseDown={(e) => {
            e.preventDefault();
            ac.insert(s.template);
          }}
          onMouseEnter={() => ac.setSelectedIdx(i)}
          className={cn(
            "w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs",
            i === ac.selectedIdx ? "bg-accent" : "hover:bg-accent/60"
          )}
        >
          <code className="text-[10px] truncate flex-1 text-emerald-600 dark:text-emerald-400">{s.template}</code>
          {s.preview && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[110px]">{s.preview}</span>
          )}
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 shrink-0">{s.group}</span>
        </button>
      ))}
    </PopoverContent>
  );
}

/**
 * Hook that bundles the trigger detection, filtering and keyboard handling
 * for either an input or textarea. The caller wires the returned handlers
 * onto the element and renders the suggestion list when `open` is true.
 */
function useAutocomplete(
  elRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  onChange: (v: string) => void,
  refs?: RefGroup[]
) {
  const flatRefs = useFlatRefs(refs);
  const [trigger, setTrigger] = React.useState<{ start: number; fragment: string } | null>(null);
  const [selectedIdx, setSelectedIdx] = React.useState(0);

  const suggestions = React.useMemo(
    () => (trigger ? filterRefs(flatRefs, trigger.fragment) : []),
    [flatRefs, trigger]
  );
  const open = !!trigger && suggestions.length > 0;

  // Keep selection inside bounds when the filtered list shrinks.
  React.useEffect(() => {
    if (selectedIdx >= suggestions.length) setSelectedIdx(0);
  }, [suggestions.length, selectedIdx]);

  const handleChange = (next: string, caret: number) => {
    onChange(next);
    const t = findTrigger(next, caret);
    setTrigger(t);
    setSelectedIdx(0);
  };

  const handleCursor = (caret: number) => {
    // Re-detect trigger on caret moves so arrow-keying out of a `$...` chunk
    // closes the popup, and moving back in re-opens it.
    const t = findTrigger(value, caret);
    if (t?.fragment !== trigger?.fragment) {
      setTrigger(t);
      setSelectedIdx(0);
    }
  };

  const insert = (template: string) => {
    const el = elRef.current;
    if (!el || !trigger) return;
    const caret = el.selectionStart ?? value.length;
    const next = value.slice(0, trigger.start) + template + value.slice(caret);
    onChange(next);
    const pos = trigger.start + template.length;
    setTrigger(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const pick = suggestions[selectedIdx];
      if (pick) insert(pick.template);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTrigger(null);
    }
  };

  const handleBlur = () => {
    // Defer so a mousedown on a suggestion still wins the race.
    setTimeout(() => setTrigger(null), 120);
  };

  return {
    open,
    suggestions,
    selectedIdx,
    setSelectedIdx,
    insert,
    handleChange,
    handleCursor,
    handleKeyDown,
    handleBlur,
  };
}

function FieldShell({
  label, children, refs, onPick, helpText,
}: {
  label?: string;
  children: React.ReactNode;
  refs?: RefGroup[];
  onPick: (t: string) => void;
  helpText?: string;
}) {
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center justify-between gap-1">
          <Label className="text-xs">{label}</Label>
          {refs && refs.length > 0 && <RefPicker groups={refs} onPick={onPick} />}
        </div>
      )}
      {children}
      {helpText && <p className="text-[10px] text-muted-foreground">{helpText}</p>}
    </div>
  );
}

function insertAtCursor(
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  onChange: (v: string) => void,
  text: string
) {
  const el = ref.current;
  if (!el || typeof el.selectionStart !== "number") {
    onChange(value + text);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
  });
}
