import { EditorCanvas } from "@/features/templates/editor-canvas"
import { useTemplateEditor } from "./template-editor"

// TemplateEditorCanvas renders in the CENTER (show) pane while the
// template-editor surface is open. Pure view over the provider state —
// all mutations route back through the shared context so the options
// pane stays in sync.
export function TemplateEditorCanvas() {
  const {
    template,
    isLoading,
    body,
    fill,
    selectedIndex,
    setSelectedIndex,
    updateBox,
  } = useTemplateEditor()

  if (isLoading || !template || !body) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/50">
        Loading template…
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 w-full bg-background">
      <EditorCanvas
        template={template}
        body={body}
        fill={fill}
        selectedIndex={selectedIndex}
        onSelectIndex={setSelectedIndex}
        onBoxChange={(i, patch) => updateBox(i, patch)}
        readOnly={false}
      />
    </div>
  )
}
