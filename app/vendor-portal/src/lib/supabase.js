import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://txdrpxbbeenefbeqexiv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4ZHJweGJiZWVuZWZiZXFleGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNDk3MDYsImV4cCI6MjA5MjkyNTcwNn0.fZVp8DO4HyieXWEJ8Ydx1Xrg4iD9JdVP5fv0wcibjtI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const BUCKET = 'invoices';
