"use server";

import { RegisterSchema } from "@/lib/authSchema";
import db, { dbGet } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function registerUser(prevState: any, formData: FormData) {
  // 1. Extraer datos
  const rawData = Object.fromEntries(formData.entries());
  
  // 2. Validar con Zod
  const validated = RegisterSchema.safeParse(rawData);
  
  if (!validated.success) {
    return {
      success: false,
      errors: validated.error.flatten().fieldErrors,
    };
  }

  const { username, password, nombre, email } = validated.data;

  try {
    // 3. Verificar si el usuario ya existe
    const existingUser = await dbGet("SELECT id FROM usuario WHERE username = $1 OR email = $2 LIMIT 1", [username, email]);
    if (existingUser) {
      return {
        success: false,
        message: "El nombre de usuario o correo ya está en uso.",
      };
    }

    // 4. Hashear contraseña con costo 10 (óptimo para contenedores de 0.5 vCPU sin bloquear el Event Loop)
    const hash = await bcrypt.hash(password, 10);
    
    // 5. Insertar en DB y garantizar que inicie sin proyectos ni parcelas residuales
    const id = "usr_" + Date.now();
    const creado = new Date().toISOString();
    
    await db.query(
      `INSERT INTO usuario (id, username, password, nombre, email, rol, activo, creado) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, username, hash, nombre, email, "junior", false, creado]
    );

    await db.query(`DELETE FROM proyecto WHERE usuario_id = $1`, [id]);

    return {
      success: true,
      message: "Usuario registrado con éxito. Tu cuenta debe ser activada por un administrador.",
    };
  } catch (error: any) {
    console.error("Registration Error:", error);
    return {
      success: false,
      message: "Error interno del servidor. Inténtelo de nuevo más tarde.",
    };
  }
}
