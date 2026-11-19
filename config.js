// Shared database. Leave both empty to run from browser storage only.
// Supabase > Project Settings > API: copy "Project URL" and the "anon public" key.
// The anon key is meant to be public; the database rules in supabase.sql limit what it can do.
window.LANDLOG_CONFIG = {
  url: '',
  anonKey: ''
};
