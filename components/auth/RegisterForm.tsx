"use client";

import { useActionState, useState, useEffect } from "react";
import { registerUser } from "@/app/actions/registerAction";
import { RegisterSchema, type RegisterInput } from "@/lib/authSchema";
import { useAppStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShieldCheck, User, Lock, Mail, CreditCard } from "lucide-react";

const initialState = {
  success: false,
  message: "",
  errors: {} as any,
};

export function RegisterForm() {
  const [state, formAction, isPending] = useActionState(registerUser, initialState);
  const [clientErrors, setClientErrors] = useState<any>({});
  const clearProjectWorkspace = useAppStore((s) => s.clearProjectWorkspace);
  const setUser = useAppStore((s) => s.setUser);

  useEffect(() => {
    if (state?.success) {
      clearProjectWorkspace();
      setUser(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem("geotrans-offline-v1");
        localStorage.removeItem("transforven_project");
        sessionStorage.clear();
      }
    }
  }, [state?.success, clearProjectWorkspace, setUser]);

  const handleSubmit = (formData: FormData) => {
    // Validación del lado del cliente antes de enviar (Frontend Expert directive)
    const rawData = Object.fromEntries(formData.entries());
    const validated = RegisterSchema.safeParse(rawData);

    if (!validated.success) {
      setClientErrors(validated.error.flatten().fieldErrors);
      return;
    }

    setClientErrors({});
    formAction(formData);
  };

  const errors = { ...state?.errors, ...clientErrors };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl shadow-black/20">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-4 border border-emerald-500/20">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Registro Seguro · <span className="text-emerald-400">GeoGIS6</span></h2>
          <p className="text-slate-400 text-sm mt-1">Crea tu cuenta en GeoGIS6</p>
        </div>

        <form action={handleSubmit} className="space-y-5">
          <div className="relative">
            <User className="absolute left-3 top-9 h-4 w-4 text-slate-500 z-10" />
            <Input
              name="username"
              label="Usuario"
              placeholder="Ej: jsmith_2026"
              error={errors.username?.[0]}
              className="pl-10"
              required
            />
          </div>

          <div className="relative">
            <CreditCard className="absolute left-3 top-9 h-4 w-4 text-slate-500 z-10" />
            <Input
              name="nombre"
              label="Nombre Completo"
              placeholder="Ej: John Smith"
              error={errors.nombre?.[0]}
              className="pl-10"
              required
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-3 top-9 h-4 w-4 text-slate-500 z-10" />
            <Input
              name="email"
              type="email"
              label="Correo Electrónico"
              placeholder="usuario@igvsb.gob.ve"
              error={errors.email?.[0]}
              className="pl-10"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Lock className="absolute left-3 top-9 h-4 w-4 text-slate-500 z-10" />
              <Input
                name="password"
                type="password"
                label="Contraseña"
                error={errors.password?.[0]}
                className="pl-10"
                required
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-9 h-4 w-4 text-slate-500 z-10" />
              <Input
                name="confirmPassword"
                type="password"
                label="Confirmar"
                error={errors.confirmPassword?.[0]}
                className="pl-10"
                required
              />
            </div>
          </div>

          {state?.message && !state.success && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
              {state.message}
            </div>
          )}

          {state?.success && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs text-center">
              {state.message}
            </div>
          )}

          <Button type="submit" isLoading={isPending} className="mt-4">
            Registrarse ahora
          </Button>
        </form>

        <p className="text-center text-slate-500 text-xs mt-6">
          Al registrarte, aceptas nuestros <a href="#" className="text-emerald-400 hover:underline">Términos de Seguridad</a>.
        </p>
      </div>
    </div>
  );
}
