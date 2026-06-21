// ── SUPABASE CONFIG ──
const SUPABASE_URL = "https://ywkqxfoaelaoiuoquyrf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3a3F4Zm9hZWxhb2l1b3F1eXJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzI3MjcsImV4cCI6MjA5NzU0ODcyN30.gnoA2vpswnth14Hy25O8DdgPL46e8GOtGxSqUoDU8bA";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── AUTH HELPERS ──
async function getCurrentUser() {
  const { data: { user } } = await db.auth.getUser();
  return user;
}

async function getUserProfile(userId) {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

async function signOut() {
  await db.auth.signOut();
  window.location.href = "/index.html";
}

// ── GUARD: require login ──
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "/index.html";
    return null;
  }
  return user;
}

// ── GUARD: require approved (admin also allowed) ──
async function requireApproved() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getUserProfile(user.id);
  // Admin puede acceder al dashboard también
  if (!profile.approved && profile.role !== "admin") {
    window.location.href = "/pending.html";
    return null;
  }
  return { user, profile };
}

// ── GUARD: require admin ──
async function requireAdmin() {
  const result = await requireApproved();
  if (!result) return null;
  if (result.profile.role !== "admin") {
    window.location.href = "/dashboard.html";
    return null;
  }
  return result;
}