/**
 * Setup global para tests: configura los mocks que deben estar listos
 * antes de cualquier import de código que dependan de librerías Next.js.
 */

import { vi } from "vitest"

// Mock de server-only
vi.mock("server-only")

// Mock de next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`[REDIRECT] ${url}`)
  }),
}))

// Mock de next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({})),
}))

// Mock de @/lib/supabase/server
vi.mock("@/lib/supabase/server", () => {
  const mockRpc = vi.fn()
  const mockClient = {
    auth: {
      getUser: vi.fn(),
    },
    rpc: mockRpc,
  }
  return {
    createClient: vi.fn(() => mockClient),
    mockRpc,
    mockClient,
  }
})
