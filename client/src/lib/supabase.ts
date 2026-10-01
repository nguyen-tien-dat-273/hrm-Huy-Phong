// ============================================================================
// Supabase client (real backend).
// ----------------------------------------------------------------------------
// Previously this file was a localStorage mock. Now it creates a real Supabase
// client so all data is shared across every machine / user via the managed
// backend. The public `supabase` export keeps the same chaining API
// (.from().select().eq().insert().update().delete().single().maybeSingle()...)
// used across the pages, so they work unchanged.
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './supabaseConfig';

const cfg = getSupabaseConfig();

export const supabase: SupabaseClient = cfg
  ? createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Không dùng link magic/recovery trong URL — mật khẩu do admin cấp lại.
        detectSessionInUrl: false,
      },
    })
  : (null as unknown as SupabaseClient);
