-- =============================================================================
-- MIGRACIÓN: 001_rbac_and_antiabuse.sql
-- GeoTransformer v6.0 Mobile — Control de Acceso RBAC, Modo Demo,
-- Device Binding Anti-Abuso (Redes Móviles/CGNAT Venezuela) y Auditoría
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TIPO ENUM DE ROLES Y AMPLIACIÓN DE PERFILES (public.profiles & public.usuario)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_user_role') THEN
    CREATE TYPE public.app_user_role AS ENUM (
      'demo',
      'operador_campo',
      'revisor_catastral',
      'admin'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(64) UNIQUE,
  full_name VARCHAR(120),
  role public.app_user_role NOT NULL DEFAULT 'demo',
  max_allowed_devices INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_demo_single_device CHECK (
    (role = 'demo' AND max_allowed_devices = 1) OR (role <> 'demo' AND max_allowed_devices >= 1)
  )
);

-- Trigger para forzar max_allowed_devices = 10 para 'admin' y 1 para el resto de los roles
CREATE OR REPLACE FUNCTION public.enforce_profile_device_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.max_allowed_devices := 10;
  ELSE
    NEW.max_allowed_devices := 1;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_device_limits ON public.profiles;
CREATE TRIGGER trg_enforce_profile_device_limits
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_device_limits();

-- Compatibilidad con tabla public.usuario existente en PostgreSQL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'usuario') THEN
    ALTER TABLE public.usuario ADD COLUMN IF NOT EXISTS max_allowed_devices INT NOT NULL DEFAULT 1;
    UPDATE public.usuario SET max_allowed_devices = CASE WHEN rol = 'admin' THEN 10 ELSE 1 END;
  END IF;
END $$;

-- 2. TABLA DE DISPOSITIVOS AUTORIZADOS (public.user_authorized_devices)
CREATE TABLE IF NOT EXISTS public.user_authorized_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id VARCHAR(128) NOT NULL,
  device_name VARCHAR(100),
  first_seen_ip INET NOT NULL,
  last_seen_ip INET NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_authorized_devices_user_device UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_authorized_devices_user_id
  ON public.user_authorized_devices(user_id, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_authorized_devices_active
  ON public.user_authorized_devices(user_id, is_active);

-- 3. TABLA DE LOGS DE ACCESO (public.user_access_logs)
CREATE TABLE IF NOT EXISTS public.user_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id VARCHAR(128) NOT NULL,
  ip_address INET NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '/api',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_access_logs_user_window
  ON public.user_access_logs(user_id, created_at DESC);

-- 4. FUNCIÓN ALMACENADA PL/pgSQL: validate_user_session_access
-- Adaptada a condiciones de red en Venezuela (Digitel/Movistar/CANTV CGNAT):
-- No bloquea por cambio simple de IP; amarra por device_id y detecta concurrencia > 2 IPs en 5 min.
CREATE OR REPLACE FUNCTION public.validate_user_session_access(
  p_user_id UUID,
  p_device_id VARCHAR,
  p_client_ip INET,
  p_user_agent TEXT,
  p_endpoint TEXT DEFAULT '/api'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.app_user_role := 'demo';
  v_max_devices INT := 2;
  v_is_user_active BOOLEAN := TRUE;
  v_existing_device RECORD;
  v_active_devices_count INT := 0;
  v_recent_distinct_ips INT := 0;
  v_device_name VARCHAR(100);
BEGIN
  IF p_user_id IS NULL OR p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'INVALID_DEVICE_ID'
    );
  END IF;

  -- Obtener perfil y límite de dispositivos del usuario
  SELECT role, max_allowed_devices, is_active
    INTO v_role, v_max_devices, v_is_user_active
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    v_role := 'operador_campo';
    v_max_devices := 1;
    v_is_user_active := TRUE;
  END IF;

  IF NOT v_is_user_active THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'ACCOUNT_SUSPENDED'
    );
  END IF;

  IF v_role = 'admin' THEN
    v_max_devices := 10;
  ELSE
    v_max_devices := 1;
  END IF;

  -- Detectar nombre legible del terminal desde el User-Agent
  v_device_name := CASE
    WHEN p_user_agent ILIKE '%Android%' THEN 'Mobile Android'
    WHEN p_user_agent ILIKE '%iPhone%' OR p_user_agent ILIKE '%iPad%' THEN 'Mobile iOS'
    WHEN p_user_agent ILIKE '%Macintosh%' OR p_user_agent ILIKE '%Mac OS%' THEN 'Desktop macOS'
    WHEN p_user_agent ILIKE '%Linux%' THEN 'Desktop Linux'
    WHEN p_user_agent ILIKE '%Windows%' THEN 'Desktop Windows'
    ELSE 'Terminal Web GeoTransformer'
  END;

  -- Expirar automáticamente sesiones desconectadas (> 25s sin heartbeat o > 10s en /login)
  UPDATE public.user_authorized_devices
  SET is_active = FALSE
  WHERE user_id = p_user_id
    AND is_active = TRUE
    AND COALESCE(revoked_by_admin, FALSE) = FALSE
    AND last_active_at < (NOW() - CASE WHEN p_endpoint = '/login' THEN INTERVAL '10 seconds' ELSE INTERVAL '25 seconds' END);

  -- a) Verificar si el dispositivo ya existe para este usuario
  SELECT id, is_active, COALESCE(revoked_by_admin, FALSE) AS revoked_by_admin
    INTO v_existing_device
  FROM public.user_authorized_devices
  WHERE user_id = p_user_id AND device_id = p_device_id
  FOR UPDATE;

  IF FOUND AND v_existing_device.revoked_by_admin = TRUE THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'DEVICE_REVOKED'
    );
  END IF;

  IF FOUND AND v_existing_device.is_active = TRUE THEN
    UPDATE public.user_authorized_devices
    SET last_seen_ip = p_client_ip,
        last_active_at = NOW(),
        user_agent = COALESCE(p_user_agent, user_agent),
        device_name = COALESCE(device_name, v_device_name)
    WHERE id = v_existing_device.id;
  ELSE
    -- b) Es un dispositivo nuevo o inactivo: verificar cupo de dispositivos activos
    SELECT COUNT(*)::INT
      INTO v_active_devices_count
    FROM public.user_authorized_devices
    WHERE user_id = p_user_id AND is_active = TRUE;

    IF v_active_devices_count >= v_max_devices THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'DEVICE_LIMIT_EXCEEDED',
        'max_allowed_devices', v_max_devices,
        'active_devices', v_active_devices_count
      );
    END IF;

    IF FOUND THEN
      -- Reactivar dispositivo existente si hay cupo disponible
      UPDATE public.user_authorized_devices
      SET is_active = TRUE,
          revoked_by_admin = FALSE,
          last_seen_ip = p_client_ip,
          last_active_at = NOW(),
          user_agent = COALESCE(p_user_agent, user_agent),
          device_name = COALESCE(device_name, v_device_name)
      WHERE id = v_existing_device.id;
    ELSE
      -- Insertar nuevo dispositivo autorizado
      INSERT INTO public.user_authorized_devices (
        user_id, device_id, device_name, first_seen_ip, last_seen_ip, user_agent, is_active, revoked_by_admin, created_at, last_active_at
      ) VALUES (
        p_user_id, p_device_id, v_device_name, p_client_ip, p_client_ip, p_user_agent, TRUE, FALSE, NOW(), NOW()
      );
    END IF;
  END IF;

  -- c) Verificar concurrencia imposible (> 2 IPs públicas distintas en ventana de 5 minutos entre dispositivos ACTIVOS)
  SELECT COUNT(DISTINCT host(ip_address))::INT
    INTO v_recent_distinct_ips
  FROM (
    SELECT l.ip_address
    FROM public.user_access_logs l
    INNER JOIN public.user_authorized_devices d
      ON d.user_id = l.user_id AND d.device_id = l.device_id
    WHERE l.user_id = p_user_id
      AND d.is_active = TRUE
      AND l.created_at >= (NOW() - INTERVAL '5 minutes')
    UNION ALL
    SELECT p_client_ip AS ip_address
  ) AS recent_ips;

  IF v_recent_distinct_ips > 2 AND v_role <> 'admin' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'CONCURRENT_IP_ABUSE',
      'distinct_ips_5m', v_recent_distinct_ips
    );
  END IF;

  -- d) Registrar acceso en user_access_logs y retornar éxito
  INSERT INTO public.user_access_logs (user_id, device_id, ip_address, endpoint, created_at)
  VALUES (p_user_id, p_device_id, p_client_ip, COALESCE(p_endpoint, '/api'), NOW());

  RETURN jsonb_build_object(
    'allowed', true,
    'role', v_role,
    'max_allowed_devices', v_max_devices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_user_session_access(UUID, VARCHAR, INET, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_user_session_access(UUID, VARCHAR, INET, TEXT, TEXT)
  TO service_role;

-- 5. POLÍTICAS RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_authorized_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access_logs ENABLE ROW LEVEL SECURITY;

-- Función auxiliar para verificar si el usuario autenticado en Supabase es 'admin'
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = TRUE
  );
$$;

-- Políticas sobre public.profiles
DROP POLICY IF EXISTS "Users can view own profile or admin views all" ON public.profiles;
CREATE POLICY "Users can view own profile or admin views all"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin_user());

DROP POLICY IF EXISTS "Only admin can update profiles" ON public.profiles;
CREATE POLICY "Only admin can update profiles"
  ON public.profiles FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- Políticas sobre public.user_authorized_devices (Exclusivo Admin para gestión global)
DROP POLICY IF EXISTS "Admin full access to user_authorized_devices" ON public.user_authorized_devices;
CREATE POLICY "Admin full access to user_authorized_devices"
  ON public.user_authorized_devices FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- Políticas sobre public.user_access_logs (Exclusivo Admin)
DROP POLICY IF EXISTS "Admin full access to user_access_logs" ON public.user_access_logs;
CREATE POLICY "Admin full access to user_access_logs"
  ON public.user_access_logs FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

