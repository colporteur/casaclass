import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Casa Class] Supabase env vars are missing. ' +
    'Create a .env.local file (see .env.example) before running the app.'
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: false }
})

export const SUMMARIZE_FUNCTION_URL =
  import.meta.env.VITE_SUMMARIZE_FUNCTION_URL ??
  (url ? `${url}/functions/v1/summarize` : '')

export const SUPABASE_ANON_KEY = anonKey ?? ''
