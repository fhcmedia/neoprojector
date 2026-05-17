import { createContext, useContext, useState, useEffect } from "react"
import {
  AUTH_STORAGE_KEY,
  MOCK_AUTH_ENABLED,
} from "@/lib/auth-storage"

type AuthContextType = {
  isAuthenticated: boolean
  user: { username: string } | null
  login: (username: string, pass: string) => boolean
  signup: (username: string, pass: string, license: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

// MOCK AUTH — DEV ONLY.
//
// Real authentication has not been wired yet (no server validation, no
// signed session, no license check). In production builds the mock is
// disabled and `isAuthenticated` is always true so the app is reachable
// without the placeholder login flow.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // In production, treat every visitor as authenticated. The auth
  // route is unreachable (see routes/auth.tsx), and the _app guard is
  // a no-op (see routes/_app.tsx beforeLoad).
  const [isAuthenticated, setIsAuthenticated] = useState(!MOCK_AUTH_ENABLED)
  const [user, setUser] = useState<{ username: string } | null>(null)

  useEffect(() => {
    if (!MOCK_AUTH_ENABLED) return
    const saved = localStorage.getItem(AUTH_STORAGE_KEY)
    if (saved) {
      setIsAuthenticated(true)
      setUser({ username: saved })
    }
  }, [])

  const login = (username: string, pass: string) => {
    if (!MOCK_AUTH_ENABLED) return true
    if (username === "test" && pass === "test") {
      setIsAuthenticated(true)
      setUser({ username })
      localStorage.setItem(AUTH_STORAGE_KEY, username)
      return true
    }
    return false
  }

  const signup = (username: string, pass: string, license: string) => {
    if (!MOCK_AUTH_ENABLED) return true
    if (username && pass && license) {
      setIsAuthenticated(true)
      setUser({ username })
      localStorage.setItem(AUTH_STORAGE_KEY, username)
      return true
    }
    return false
  }

  const logout = () => {
    setIsAuthenticated(false)
    setUser(null)
    if (MOCK_AUTH_ENABLED) localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
