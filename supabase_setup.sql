-- ═══════════════════════════════════════════════════
-- ProvidAI - Script SQL para Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════

-- 1. TABLA PROFILES (extiende auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  approved BOOLEAN DEFAULT FALSE,
  role TEXT DEFAULT 'lawyer' CHECK (role IN ('lawyer', 'admin')),
  mev_username TEXT,
  mev_password TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA MOVIMIENTOS (proveídos guardados)
CREATE TABLE IF NOT EXISTS public.movimientos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  parte_actora TEXT,
  demandado TEXT,
  jurisdiccion TEXT,
  juzgado TEXT,
  expediente TEXT,
  movimiento TEXT,
  texto_proveido TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ROW LEVEL SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;

-- Policies PROFILES
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete profiles"
  ON public.profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow insert on registration"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Policies MOVIMIENTOS
CREATE POLICY "Users can manage own movimientos"
  ON public.movimientos FOR ALL
  USING (auth.uid() = user_id);

-- 4. TRIGGER: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════
-- IMPORTANTE: Después de ejecutar este script,
-- creá tu usuario admin manualmente:
--
-- 1. Registrate en la app con tu email
-- 2. Ejecutá este UPDATE reemplazando tu email:
--
-- UPDATE public.profiles
-- SET role = 'admin', approved = true
-- WHERE email = 'TU_EMAIL_AQUI';
-- ═══════════════════════════════════════════════════
