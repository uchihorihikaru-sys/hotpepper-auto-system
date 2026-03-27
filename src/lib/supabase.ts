import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type CatchSetting = {
  id: string
  template: string
  fallback_text: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ExecutionLog = {
  id: string
  executed_at: string
  status: 'success' | 'error' | 'no_slots'
  available_slots: string[] | null
  generated_catch: string | null
  error_message: string | null
  duration_ms: number | null
}
