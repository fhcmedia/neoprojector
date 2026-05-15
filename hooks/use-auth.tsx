import { createContext, useContext, useState, useEffect } from "react"

type AuthContextType = {
  isAuthenticated: boolean
  user: { username: string } | null
  login: (username: string, pass: string) => boolean
  signup: (username: string, pass: string, license: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState<{ username: string } | null>(null)

  // On mount, check if there's a mocked session in localStorage
  useEffect(() => {
    const saved = localStorage.getItem("neoprojector.auth")
    if (saved) {
      setIsAuthenticated(true)
      setUser({ username: saved })
    }
  }, [])

  const login = (username: string, pass: string) => {
    // Mock login logic
    if (username === "test" && pass === "test") {
      setIsAuthenticated(true)
      setUser({ username })
      localStorage.setItem("neoprojector.auth", username)
      return true
    }
    return false
  }

  const signup = (username: string, pass: string, license: string) => {
    // Mock signup logic
    if (username && pass && license) {
      setIsAuthenticated(true)
      setUser({ username })
      localStorage.setItem("neoprojector.auth", username)
      return true
    }
    return false
  }

  const logout = () => {
    setIsAuthenticated(false)
    setUser(null)
    localStorage.removeItem("neoprojector.auth")
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
