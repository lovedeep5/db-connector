"use client";
import * as React from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";

export function MonacoEditor({
  value,
  onChange,
  language = "sql",
  onRun,
  height = "100%",
}: {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  onRun?: () => void;
  height?: string | number;
}) {
  const { resolvedTheme } = useTheme();
  const onRunRef = React.useRef(onRun);
  onRunRef.current = onRun;

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });
  };

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
