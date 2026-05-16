import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

const STORAGE_KEY = "neoprojector.serviceNameFormat"
const DEFAULT_FORMAT = "{day} {timeOfDay}"

function readStored(): string {
  if (typeof window === "undefined") return DEFAULT_FORMAT
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === null ? DEFAULT_FORMAT : stored
}

type Ctx = {
  format: string
  setFormat: (v: string) => void
}

const ServiceNameFormatContext = createContext<Ctx>({
  format: DEFAULT_FORMAT,
  setFormat: () => {},
})

export function ServiceNameFormatProvider({ children }: { children: ReactNode }) {
  const [format, setFormatState] = useState<string>(readStored)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, format)
  }, [format])

  return (
    <ServiceNameFormatContext.Provider value={{ format, setFormat: setFormatState }}>
      {children}
    </ServiceNameFormatContext.Provider>
  )
}

export function useServiceNameFormat() {
  return useContext(ServiceNameFormatContext)
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

function timeOfDay(hours: number): string {
  if (hours < 5) return "Night"
  if (hours < 12) return "Morning"
  if (hours < 17) return "Afternoon"
  if (hours < 21) return "Evening"
  return "Night"
}

export type TokenSpec = { token: string; label: string; example: string }

// Surfaced so the settings UI can render a token reference list.
export const TOKEN_SPECS: TokenSpec[] = [
  { token: "{day}", label: "Day of week", example: "Friday" },
  { token: "{shortDay}", label: "Short day", example: "Fri" },
  { token: "{month}", label: "Month", example: "May" },
  { token: "{shortMonth}", label: "Short month", example: "May" },
  { token: "{date}", label: "Day of month", example: "14" },
  { token: "{isoDate}", label: "ISO date", example: "2026-05-14" },
  { token: "{year}", label: "Year", example: "2026" },
  { token: "{timeOfDay}", label: "Time of day", example: "Evening" },
]

export function resolveServiceName(format: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const replacements: Record<string, string> = {
    "{day}": DAYS[now.getDay()],
    "{shortDay}": SHORT_DAYS[now.getDay()],
    "{month}": MONTHS[now.getMonth()],
    "{shortMonth}": SHORT_MONTHS[now.getMonth()],
    "{date}": String(now.getDate()),
    "{isoDate}": `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    "{year}": String(now.getFullYear()),
    "{timeOfDay}": timeOfDay(now.getHours()),
  }
  let out = format
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(key).join(value)
  }
  return out.trim() || "Untitled service"
}
