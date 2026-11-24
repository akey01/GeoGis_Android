-- ==============================================================================
-- MIGRACIÓN: 002_security_hardening_rls.sql
-- GeoTransformer v6.0 / GeoGIS6 — Remediación Integral Supabase Security Advisor
-- Proyecto: rmkgectnfcetzrrvdaxg
-- ==============================================================================
-- Resuelve los 11 hallazgos del Database Linter / Security Advisor + 2 índices FK:
--   [ERROR] security_definer_view       -> public.parcelas_geojson (security_invoker = true)
--   [ERROR] rls_disabled_in_public      -> proyectos, usuarios, pagos_suscripcion,
--                                          user_access_logs, user_authorized_devices,
--                                          role_permissions_config
--   [INFO]  rls_enabled_no_policy       -> actividad, proyecto, usuario
--   [WARN]  function_search_path_mutable -> public.set_updated_at()
--   [INFO]  unindexed_foreign_keys      -> proyecto(usuario_id), proyectos(usuario_id)
--   + Revoca privilegios de anon/authenticated en public vía PostgREST
-- ==============================================================================

BEGIN;

-- 1. Corregir vista SECURITY DEFINER y restringir acceso anónimo en parcelas
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'parcelas_geojson') THEN
    ALTER VIEW public.parcelas_geojson SET (security_invoker = true);
    REVOKE ALL ON TABLE public.parcelas_geojson FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.parcelas_geojson TO authenticated;
    GRANT ALL ON TABLE public.parcelas_geojson TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parcelas') THEN
    ALTER TABLE public.parcelas ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.parcelas FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.parcelas TO authenticated;
    GRANT ALL ON TABLE public.parcelas TO service_role;

    DROP POLICY IF EXISTS "Lectura publica controlada de parcelas" ON public.parcelas;
    DROP POLICY IF EXISTS "parcelas_select_authenticated" ON public.parcelas;
    CREATE POLICY "parcelas_select_authenticated"
      ON public.parcelas FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "parcelas_write_service_role" ON public.parcelas;
    CREATE POLICY "parcelas_write_service_role"
      ON public.parcelas FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. Habilitar RLS, revocar privilegios de anon/authenticated y crear política explícita service_role
DO $$
DECLARE
  t TEXT;
  pol TEXT;
  internal_tables TEXT[] := ARRAY[
    'usuario',
    'usuarios',
    'proyecto',
    'proyectos',
    'actividad',
    'pagos_suscripcion',
    'user_access_logs',
    'user_authorized_devices',
    'role_permissions_config'
  ];
BEGIN
  FOREACH t IN ARRAY internal_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);

      pol := 'service_role_full_access_' || t;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        pol, t
      );
    END IF;
  END LOOP;
END $$;

-- 3. Fijar search_path inmutable en funciones
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
  END IF;
END $$;

-- 4. Índices de cobertura en llaves foráneas (Performance Advisor)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'proyecto') THEN
    CREATE INDEX IF NOT EXISTS idx_proyecto_usuario_id ON public.proyecto (usuario_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'proyectos') THEN
    CREATE INDEX IF NOT EXISTS idx_proyectos_usuario_id ON public.proyectos (usuario_id);
  END IF;
END $$;

COMMIT;
