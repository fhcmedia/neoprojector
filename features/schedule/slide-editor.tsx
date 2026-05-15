import React, { useState, useEffect, useMemo, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Button } from "@/components/button"
import { XIcon, CheckIcon, Image as ImageIcon, TypeIcon, LayersIcon } from "lucide-react"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { Label } from "@/components/label"
import { Slider } from "@/components/slider"
import { Switch } from "@/components/switch"
import { Textarea } from "@/components/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select"
import { cn } from "@/lib/utils"
import { Input } from "@/components/input"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/context-menu"
import { Trash2Icon, PlusIcon, MusicIcon } from "lucide-react"
import { Dialogs, Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { libraryKeys } from "@/features/library/api"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import type { BoxState, AnimationState, SlideState, SlidePreview } from "./slide-types"
import { DEFAULT_STATE } from "./slide-types"

type Props = {
  itemId: number
  onClose: () => void
}



export function SlideEditor({ itemId, onClose }: Props) {
  const qc = useQueryClient()
  const [state, setState] = useState<SlideState>(DEFAULT_STATE)
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [syncEdits, setSyncEdits] = useState(true)
  const [selectedSlideIds, setSelectedSlideIds] = useState<Set<string>>(new Set())
  const [lastSelectedSlideId, setLastSelectedSlideId] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<{ title: string, content: string }[]>([])

  // 1. Find the item in the local cache
  const item = useMemo(() => {
    const lists = qc.getQueriesData<ListServiceItemsWithContentRow[]>({ queryKey: ["schedule", "items"] })
    for (const [key, list] of lists) {
      if (list) {
        const found = list.find((i) => i.id === itemId)
        if (found) return found
      }
    }
    return null
  }, [qc, itemId])

  // Load existing override if any
  useEffect(() => {
    if (item?.template_override_json?.Valid && item.template_override_json.String) {
      try {
        const loaded = JSON.parse(item.template_override_json.String)
        setState({
          ...DEFAULT_STATE,
          ...loaded,
          overrides: loaded.overrides || {},
          animation: loaded.animation || DEFAULT_STATE.animation
        })
      } catch (e) {
        console.error("Failed to parse template override", e)
      }
    }
  }, [item])

  // 2. Fetch the actual content based on item kind
  const { data: songData } = useQuery({
    queryKey: libraryKeys.song(item?.song_id ?? 0),
    queryFn: () => Songs.GetSong(item!.song_id),
    enabled: item?.kind === "song" && !!item?.song_id,
  })

  const { data: bibleData } = useQuery({
    queryKey: ["bible", item?.book, item?.chapter],
    queryFn: () => Bible.ListVerses(item!.book, item!.chapter),
    enabled: item?.kind === "bible",
  })

  // 3. Transform into a flat list of SlidePreviews
  const slides = useMemo<SlidePreview[]>(() => {
    if (!item) return []
    if (item.kind === "song" && songData) {
      const flat: SlidePreview[] = []
      let idx = 0
      for (const section of songData.sections) {
        // Group lines by verse if needed, but simple approach is 1 slide per section
        const content = section.lines.map(l => l.text).join("\n")
        const typeStr = section.section?.type || "Verse"
        flat.push({ id: `song-${idx++}`, title: typeStr.toUpperCase(), content, sectionId: section.section.id })
      }
      return flat
    }
    if (item?.kind === "bible" && bibleData) {
      const filtered = bibleData.filter(v => v.verse >= (item?.verse_start ?? 0) && v.verse <= (item?.verse_end ?? 0))
      return filtered.map(v => ({
        id: `bible-${v.verse}`,
        title: `${item?.book} ${item?.chapter}:${v.verse}`,
        content: v.text
      }))
    }
    return [{ id: "mock", title: "Preview Slide", content: "Loading or preview content..." }]
  }, [item, songData, bibleData])

  const handleDeleteSlides = useCallback(async () => {
    if (selectedSlideIds.size === 0 || !item || item.kind !== "song") return
    const idsToDelete = Array.from(selectedSlideIds)
      .map(id => slides.find(s => s.id === id)?.sectionId)
      .filter((id): id is number => id !== undefined)
    if (idsToDelete.length > 0) {
      await Promise.all(idsToDelete.map(sid => Songs.DeleteSongSection(sid)))
    }
    setSelectedSlideIds(new Set())
    qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
    qc.invalidateQueries({ queryKey: libraryKeys.songs })
    qc.invalidateQueries({ queryKey: ["schedule", "items"] })
  }, [item, slides, selectedSlideIds, qc])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === "Backspace" || e.key === "Delete") {
      if (activeBoxId) {
        setState((s) => ({
          ...s,
          boxes: s.boxes.filter((b) => b.id !== activeBoxId),
        }))
        setActiveBoxId(null)
      } else if (selectedSlideIds.size > 0) {
        handleDeleteSlides()
      }
    }
  }, [activeBoxId, selectedSlideIds, handleDeleteSlides])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  const handleCopy = useCallback(() => {
    const selected = slides.filter(s => selectedSlideIds.has(s.id))
    if (selected.length > 0) {
      setClipboard(selected.map(s => ({
        title: s.title,
        content: s.content
      })))
    }
  }, [slides, selectedSlideIds])

  const handlePaste = useCallback(async () => {
    if (!item || item.kind !== "song" || !item.song_id || clipboard.length === 0) return
    for (const clip of clipboard) {
      const section = await Songs.CreateSongSection(item.song_id, clip.title)
      await Songs.ReplaceSectionLines(section.id, clip.content)
    }
    qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
    qc.invalidateQueries({ queryKey: libraryKeys.songs })
    qc.invalidateQueries({ queryKey: ["schedule", "items"] })
  }, [item, clipboard, qc])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && e.key === "c") handleCopy()
      if ((e.ctrlKey || e.metaKey) && e.key === "v") handlePaste()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleCopy, handlePaste])

  const toggleSlideSelect = (id: string, multi: boolean, shift: boolean) => {
    setSelectedSlideIds(prev => {
      let next = new Set(prev)
      if (shift && lastSelectedSlideId) {
        const start = slides.findIndex(s => s.id === lastSelectedSlideId)
        const end = slides.findIndex(s => s.id === id)
        if (start >= 0 && end >= 0) {
          const range = slides.slice(Math.min(start, end), Math.max(start, end) + 1)
          range.forEach(s => next.add(s.id))
        }
      } else {
        if (!multi) next = new Set()
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return next
    })
    setLastSelectedSlideId(id)
    
    const idx = slides.findIndex(s => s.id === id)
    if (idx >= 0) setActiveSlideIndex(idx)
  }



  const handleAddSlide = async (type: string = "VERSE") => {
    if (!item || item.kind !== "song" || !item.song_id) return
    const section = await Songs.CreateSongSection(item.song_id, type)
    await Songs.ReplaceSectionLines(section.id, "New slide content")
    qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
    qc.invalidateQueries({ queryKey: libraryKeys.songs })
    qc.invalidateQueries({ queryKey: ["schedule", "items"] })
  }

  useEffect(() => {
    const off = Events.On("media:files-dropped", async (event: any) => {
      const data = event?.data || {}
      if (data.target_id !== "canvas-area") return
      const paths = data.paths || []
      const imagePaths = paths.filter(p => /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i.test(p))
      if (imagePaths.length === 0) return

      try {
        const imported = await Media.ImportFiles(imagePaths)
        if (imported && imported.length > 0) {
          const filename = imported[0].path.split(/[\\/]/).pop()
          setState(s => ({
            ...s,
            bgType: "image",
            bgImage: `/media/${filename}`
          }))
        }
      } catch (e) {
        console.error("Failed to import dropped images", e)
      }
    })
    return () => off()
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      let globalSongUpdated = false
      if (item?.kind === "song") {
        for (const slide of slides) {
          const override = state.overrides[slide.id]
          if (override?.content !== undefined && override.content !== slide.content) {
            if (slide.sectionId) {
              await Songs.ReplaceSectionLines(slide.sectionId, override.content)
              globalSongUpdated = true
              delete state.overrides[slide.id].content
            }
          }
        }
        if (globalSongUpdated) {
          qc.invalidateQueries({ queryKey: libraryKeys.songs })
          qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
        }
      }

      await Schedule.SetItemTemplateOverride(itemId, { Valid: true, String: JSON.stringify(state) })
      qc.invalidateQueries({ queryKey: ["schedule", "items"] })
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setIsSaving(false)
    }
  }

  const activeSlide = slides[activeSlideIndex] || { title: "", content: "" }
  const currentBoxes = (syncEdits ? state.boxes : (state.overrides[activeSlide.id]?.boxes || state.boxes))
  const activeBox = currentBoxes.find((b) => b.id === activeBoxId)

  const updateActiveBox = (updates: Partial<BoxState>) => {
    if (!activeBoxId) return
    setState((s) => {
      if (syncEdits) {
        return {
          ...s,
          boxes: s.boxes.map((b) =>
            b.id === activeBoxId ? { ...b, ...updates } : b
          ),
        }
      } else {
        const currentLocalBoxes = s.overrides[activeSlide.id]?.boxes || [...s.boxes]
        const newBoxes = currentLocalBoxes.map((b) =>
          b.id === activeBoxId ? { ...b, ...updates } : b
        )
        return {
          ...s,
          overrides: {
            ...s.overrides,
            [activeSlide.id]: {
              ...(s.overrides[activeSlide.id] || {}),
              boxes: newBoxes,
            },
          },
        }
      }
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      className="absolute inset-0 z-50 flex flex-col bg-background"
    >
      {/* Top Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Slide Editor</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {item ? (item.kind === "song" ? "Song Layout" : "Bible Layout") : "Loading..."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => console.log("Preview")}>
            Preview
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
            {!isSaving && <CheckIcon className="ml-2 size-4" />}
          </Button>
        </div>
      </header>

      {/* Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Navigator */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="w-64 shrink-0 border-r bg-muted/10 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                <MusicIcon className="size-3" /> Slides
              </h3>
              <AnimatePresence initial={false}>
                {slides.map((slide, idx) => (
                  <ContextMenu key={slide.id}>
                    <ContextMenuTrigger asChild>
                      <motion.button
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        onClick={(e) => toggleSlideSelect(slide.id, e.ctrlKey || e.metaKey, e.shiftKey)}
                        className={cn(
                          "group relative flex flex-col text-left rounded-lg border bg-card p-3 transition-all hover:border-sky-500/50",
                          activeSlideIndex === idx ? "border-sky-500 ring-1 ring-sky-500 shadow-md" : "border-border/50",
                          selectedSlideIds.has(slide.id) && "ring-2 ring-sky-500/50 bg-sky-500/5"
                        )}
                      >
                        <div className="absolute top-2 left-2 size-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                          {idx + 1}
                        </div>
                        <span className="text-[10px] font-bold text-sky-500/80 mb-1 ml-5 uppercase">{slide.title}</span>
                        <p className="text-xs text-muted-foreground line-clamp-3 ml-5 whitespace-pre-wrap">{slide.content}</p>
                      </motion.button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem 
                        onClick={() => {
                          if (!selectedSlideIds.has(slide.id)) toggleSlideSelect(slide.id, false, false)
                          handleDeleteSlides()
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2Icon className="mr-2 size-4" />
                        <span>Delete Selected</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </AnimatePresence>
              {slides.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center opacity-30">
                  <PlusIcon className="mb-2 size-6" />
                  <p className="text-xs">No slides available.<br/>Right-click to add.</p>
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            {item?.kind === "song" ? (
              <>
                <ContextMenuItem onClick={() => handleAddSlide("VERSE")}>
                  <PlusIcon className="mr-2 size-4" />
                  <span>Add Verse</span>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAddSlide("CHORUS")}>
                  <PlusIcon className="mr-2 size-4" />
                  <span>Add Chorus</span>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAddSlide("BRIDGE")}>
                  <PlusIcon className="mr-2 size-4" />
                  <span>Add Bridge</span>
                </ContextMenuItem>
              </>
            ) : (
              <ContextMenuItem onClick={() => handleAddSlide("VERSE")}>
                <PlusIcon className="mr-2 size-4" />
                <span>Add Slide</span>
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {/* Canvas Area */}
        <div
          className="relative flex-1 overflow-hidden bg-muted/30 flex items-center justify-center p-8"
          onClick={() => setActiveBoxId(null)}
        >
          <div
            id="canvas-area"
            data-file-drop-target="canvas-area"
            className="relative shadow-2xl overflow-hidden ring-1 ring-white/10 rounded-lg"
            style={{
              width: 1920 / 1.5, // Scaled down for workspace
              height: 1080 / 1.5,
              background: state.bgType === "image" ? `url(${state.bgImage}) center/cover no-repeat` : state.bgColor,
            }}
          >
            <AnimatePresence mode="popLayout">
              <motion.div
                key={activeSlide.id}
                initial={state.animation.type === "fade" ? { opacity: 0 } : state.animation.type === "slide" ? { x: 50, opacity: 0 } : { opacity: 1 }}
                animate={{ opacity: 1, x: 0 }}
                exit={state.animation.type === "fade" ? { opacity: 0 } : state.animation.type === "slide" ? { x: -50, opacity: 0 } : { opacity: 1 }}
                transition={{ duration: state.animation.duration }}
                className="absolute inset-0"
              >
                {currentBoxes.map((box) => (
                  <motion.div
                    key={box.id}
                    drag
                    dragMomentum={false}
                    onDrag={(e, info) => {
                      const updates = { x: box.x + info.delta.x * 1.5, y: box.y + info.delta.y * 1.5 }
                      setState((s) => {
                        if (syncEdits) {
                          return {
                            ...s,
                            boxes: s.boxes.map((b) => b.id === box.id ? { ...b, ...updates } : b),
                          }
                        } else {
                          const currentLocalBoxes = s.overrides[activeSlide.id]?.boxes || [...s.boxes]
                          return {
                            ...s,
                            overrides: {
                              ...s.overrides,
                              [activeSlide.id]: {
                                ...(s.overrides[activeSlide.id] || {}),
                                boxes: currentLocalBoxes.map((b) => b.id === box.id ? { ...b, ...updates } : b),
                              },
                            },
                          }
                        }
                      })
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveBoxId(box.id)
                    }}
                    className={`absolute cursor-move border-2 ${
                      activeBoxId === box.id ? "border-sky-500 bg-sky-500/10" : "border-dashed border-white/20 hover:border-sky-500/50"
                    }`}
                    style={{
                      left: box.x / 1.5,
                      top: box.y / 1.5,
                      width: box.w / 1.5,
                      height: box.h / 1.5,
                      fontSize: box.fontSize / 1.5,
                      fontFamily: box.fontFamily,
                      color: box.color,
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: box.type === "title" ? "flex-start" : "center",
                      textAlign: box.type === "title" ? "left" : "center",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {box.type === "title" 
                      ? (state.overrides[activeSlide.id]?.title ?? activeSlide.title)
                      : (state.overrides[activeSlide.id]?.content ?? activeSlide.content)}
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Right Sidebar - Properties */}
        <div className="w-80 shrink-0 border-l bg-card p-4 overflow-y-auto">
          <h3 className="mb-4 text-sm font-medium">Properties</h3>
          
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase">Background</Label>
              <div className="flex gap-2">
                <Button 
                  variant={state.bgType === "color" ? "default" : "outline"} 
                  className="flex-1 text-[10px]" 
                  onClick={() => setState(s => ({ ...s, bgType: "color", bgColor: "#000000" }))}
                >
                  Solid
                </Button>
                <Button 
                  variant={state.bgType === "gradient" ? "default" : "outline"} 
                  className="flex-1 text-[10px]" 
                  onClick={() => setState(s => ({ ...s, bgType: "gradient", bgColor: "linear-gradient(to bottom right, #0f172a, #1e293b)" }))}
                >
                  Gradient
                </Button>
                <Button 
                  variant={state.bgType === "image" ? "default" : "outline"} 
                  className="flex-1 text-[10px]" 
                  onClick={() => setState(s => ({ ...s, bgType: "image" }))}
                >
                  Image
                </Button>
              </div>

              {state.bgType === "image" && (
                <div className="space-y-2 pt-2">
                  <Label className="text-[10px] text-muted-foreground uppercase">Image URL</Label>
                  <Input 
                    value={state.bgImage || ""} 
                    onChange={(e) => setState(s => ({ ...s, bgImage: e.target.value }))}
                    placeholder="https://example.com/bg.jpg"
                    className="h-8 text-xs bg-background"
                  />
                </div>
              )}
              
              {state.bgType === "color" && (
                <div className="flex gap-2 items-center pt-2">
                  {["#000000", "#1e293b", "#450a0a", "#064e3b", "#1e1b4b"].map((c) => (
                    <button
                      key={c}
                      onClick={() => setState(s => ({ ...s, bgColor: c }))}
                      className={`size-6 rounded-full border-2 ${state.bgColor === c ? 'border-sky-500' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase">Sync Layout Edits</Label>
                <Switch 
                  checked={syncEdits} 
                  onCheckedChange={(val) => {
                    setSyncEdits(val)
                    if (val) {
                      // Apply CURRENT slide's layout to GLOBAL and clear overrides
                      const currentLayout = state.overrides[activeSlide.id]?.boxes || state.boxes
                      setState(s => {
                        const nextOverrides = { ...s.overrides }
                        Object.keys(nextOverrides).forEach(k => {
                          if (nextOverrides[k].boxes) delete nextOverrides[k].boxes
                        })
                        return {
                          ...s,
                          boxes: currentLayout,
                          overrides: nextOverrides
                        }
                      })
                    }
                  }} 
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                If on, editing layout properties applies to all slides. If off, it only applies to the current slide.
              </p>
            </div>

            <div className="space-y-4 pt-4 border-t">
              <Label className="text-xs text-muted-foreground uppercase">Slide Transition</Label>
              <Select 
                value={state.animation.type} 
                onValueChange={(val: any) => setState(s => ({ ...s, animation: { ...s.animation, type: val } }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select transition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="fade">Fade</SelectItem>
                  <SelectItem value="slide">Slide</SelectItem>
                </SelectContent>
              </Select>
              
              {state.animation.type !== "none" && (
                <div className="space-y-2 pt-2">
                  <Label className="text-xs text-muted-foreground uppercase">Duration ({state.animation.duration}s)</Label>
                  <Slider 
                    value={[state.animation.duration]} 
                    min={0.1} 
                    max={3.0} 
                    step={0.1}
                    onValueChange={([val]) => setState(s => ({ ...s, animation: { ...s.animation, duration: val } }))}
                  />
                </div>
              )}
            </div>

            {activeBox && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-4 pt-4 border-t"
              >
                <h4 className="text-xs font-semibold uppercase text-sky-500">{activeBox.type} Layout</h4>
                
                <div className="space-y-2 pt-2">
                  <Label className="text-xs text-muted-foreground uppercase">Font Family</Label>
                  <Select 
                    value={activeBox.fontFamily} 
                    onValueChange={(val: any) => updateActiveBox({ fontFamily: val })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select font" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Inter">Inter</SelectItem>
                      <SelectItem value="Roboto">Roboto</SelectItem>
                      <SelectItem value="Arial">Arial</SelectItem>
                      <SelectItem value="Times New Roman">Times New Roman</SelectItem>
                      <SelectItem value="Courier New">Courier New</SelectItem>
                      <SelectItem value="Georgia">Georgia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 pt-2">
                  <Label className="text-xs text-muted-foreground uppercase">Font Size ({activeBox.fontSize}px)</Label>
                  <Slider 
                    value={[activeBox.fontSize]} 
                    min={12} 
                    max={200} 
                    onValueChange={([val]) => updateActiveBox({ fontSize: val })}
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <Label className="text-xs text-muted-foreground uppercase">Color</Label>
                  <div className="flex gap-2 items-center">
                    {["#ffffff", "#94a3b8", "#f87171", "#60a5fa", "#34d399"].map((c) => (
                      <button
                        key={c}
                        onClick={() => updateActiveBox({ color: c })}
                        className={`size-6 rounded-full border-2 ${activeBox.color === c ? 'border-sky-500' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <div className="relative size-6 rounded-full overflow-hidden border-2 border-transparent focus-within:border-sky-500">
                      <input 
                        type="color" 
                        value={activeBox.color} 
                        onChange={(e) => updateActiveBox({ color: e.target.value })}
                        className="absolute inset-[-10px] size-12 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Label className="text-xs text-muted-foreground uppercase">Edit {activeBox.type === "title" ? "Title" : "Content"}</Label>
                  <Textarea 
                    value={
                      activeBox.type === "title" 
                        ? (state.overrides[activeSlide.id]?.title ?? activeSlide.title)
                        : (state.overrides[activeSlide.id]?.content ?? activeSlide.content)
                    }
                    onChange={(e) => {
                      const val = e.target.value
                      setState(s => ({
                        ...s,
                        overrides: {
                          ...s.overrides,
                          [activeSlide.id]: {
                            ...(s.overrides[activeSlide.id] || {}),
                            [activeBox.type === "title" ? "title" : "content"]: val
                          }
                        }
                      }))
                    }}
                    placeholder={`Enter custom ${activeBox.type}...`}
                    className="h-24 resize-none bg-background text-sm"
                  />
                </div>
              </motion.div>
            )}
            
            {!activeBox && (
              <div className="flex flex-col items-center justify-center py-12 text-center opacity-50">
                <TypeIcon className="mb-2 size-8 text-muted-foreground" />
                <p className="text-sm">Select a text box on the canvas to edit its layout properties.</p>
                <Button className="mt-4" variant="outline" size="sm" onClick={() => {
                  setState(s => ({
                    ...s,
                    boxes: [...s.boxes, {
                      id: `content-${Date.now()}`,
                      type: "content",
                      x: 200, y: 200, w: 1000, h: 300,
                      fontSize: 72, fontFamily: "Roboto", color: "#ffffff"
                    }]
                  }))
                }}>Add Content Box</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
