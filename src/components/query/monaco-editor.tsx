"use client";
import * as React from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";

type MonacoNs = Parameters<OnMount>[1];

export function MonacoEditor({
  value,
  onChange,
  language = "sql",
  onRun,
  height = "100%",
  extraTypeDeclarations,
}: {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  onRun?: () => void;
  height?: string | number;
  /**
   * Optional TypeScript declarations to feed Monaco's JS/TS language service.
   * The JS Code flow node uses this to expose typed `$input`, `$prev`,
   * `$node`, etc. based on the last test run's data — so autocomplete shows
   * the real field names from the upstream node's output instead of a flat
   * list of words it has seen in the file.
   */
  extraTypeDeclarations?: string;
}) {
  const { resolvedTheme } = useTheme();
  const onRunRef = React.useRef(onRun);
  onRunRef.current = onRun;
  const monacoRef = React.useRef<MonacoNs | null>(null);
  // Each Monaco `addExtraLib` returns an IDisposable; we keep the latest one
  // so we can dispose it before adding a new declaration (otherwise old types
  // accumulate and contradict each other).
  const libDisposeRef = React.useRef<{ dispose: () => void } | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });
    applyExtraTypes(monaco, extraTypeDeclarations, libDisposeRef);
  };

  // Re-apply when the declarations change (e.g. after a test run produces
  // new sample data).
  React.useEffect(() => {
    if (monacoRef.current) {
      applyExtraTypes(monacoRef.current, extraTypeDeclarations, libDisposeRef);
    }
  }, [extraTypeDeclarations]);

  // Drop the lib on unmount so it doesn't leak into other Monaco editors
  // (e.g. the SQL workbench) that share the same JS language service.
  React.useEffect(() => {
    return () => {
      libDisposeRef.current?.dispose();
      libDisposeRef.current = null;
    };
  }, []);

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        renderLineHighlight: "all",
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12 },
        // Critical: render Monaco's IntelliSense + parameter-hint widgets at
        // the document body level instead of inside the editor DOM. The
        // Inspector panel has overflow:hidden, so without this the popup
        // gets clipped and (worse) stays active while invisible. With it,
        // the popup appears above all panels as expected.
        fixedOverflowWidgets: true,
        // Don't auto-format on type/paste — keeps the user's spacing exactly
        // as typed (otherwise `const x = 1` may get re-spaced mid-typing).
        formatOnType: false,
        formatOnPaste: false,
        // Suggestions are useful — let only Tab / Enter accept them so other
        // typed characters (especially space) always pass straight through.
        acceptSuggestionOnCommitCharacter: false,
        acceptSuggestionOnEnter: "smart",
      }}
    />
  );
}

function applyExtraTypes(
  monaco: MonacoNs,
  source: string | undefined,
  ref: React.MutableRefObject<{ dispose: () => void } | null>
) {
  ref.current?.dispose();
  ref.current = null;
  if (!source) return;
  // Use a stable filePath so subsequent applyExtraTypes calls (after re-mount
  // or live edit) replace the prior contribution cleanly via dispose() above.
  const disposable = monaco.languages.typescript.javascriptDefaults.addExtraLib(
    source,
    "ts:dbc-flow-context.d.ts"
  );
  ref.current = disposable;
}
