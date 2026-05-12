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
      }}
    />
  );
}
