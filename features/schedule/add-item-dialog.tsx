import { useState } from "react"
import { PlusIcon, MusicIcon, BookOpenIcon, ImageIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/tabs"
import { SongPicker } from "@/features/schedule/pickers/song-picker"
import { BiblePicker } from "@/features/schedule/pickers/bible-picker"
import { MediaPicker } from "@/features/schedule/pickers/media-picker"

export function AddItemDialog({ sectionId }: { sectionId: number }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="ml-7 mt-0.5 flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground"
        >
          <PlusIcon className="size-3" />
          Add
        </button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-none gap-0 p-0 sm:max-w-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Add item</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="song" className="flex h-[32rem] flex-col gap-0">
          <TabsList
            variant="line"
            className="h-11 w-full justify-start gap-2 border-b border-border/50 px-4"
          >
            <TabsTrigger value="song">
              <MusicIcon /> Song
            </TabsTrigger>
            <TabsTrigger value="bible">
              <BookOpenIcon /> Bible
            </TabsTrigger>
            <TabsTrigger value="media">
              <ImageIcon /> Media
            </TabsTrigger>
          </TabsList>
          <TabsContent value="song" className="overflow-hidden px-4 pb-4">
            <SongPicker sectionId={sectionId} onAdded={() => setOpen(false)} />
          </TabsContent>
          <TabsContent value="bible" className="overflow-hidden px-4 pb-4">
            <BiblePicker
              mode="add"
              sectionId={sectionId}
              onSaved={() => setOpen(false)}
            />
          </TabsContent>
          <TabsContent value="media" className="overflow-hidden px-4 pb-4">
            <MediaPicker
              sectionId={sectionId}
              onAdded={() => setOpen(false)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
