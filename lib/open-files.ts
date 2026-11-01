import { Dialogs } from "@wailsio/runtime"

// openFilesSafe is Dialogs.OpenFile for "pick some files": the runtime
// REJECTS when the user cancels ("cancelled by user"), which surfaced as
// an unhandled error. Cancel (or any dialog failure) means no files.
export async function openFilesSafe(
  options: Parameters<typeof Dialogs.OpenFile>[0]
): Promise<string | string[]> {
  try {
    return await Dialogs.OpenFile(options)
  } catch {
    return []
  }
}
