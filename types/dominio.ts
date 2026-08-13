/**
 * Aliases legibles en español derivados de Database.
 * Facilita el tipado y la legibilidad del código sin exponer `Database["public"]["Tables"][...]`.
 */

import type { Database, Tables, TablesInsert, TablesUpdate, Enums } from "./database.types"

// Perfiles de usuario
/** Perfil de usuario del sistema */
export type Perfil = Tables<"profiles">
/** Inserción de perfil */
export type PerfilInsert = TablesInsert<"profiles">
/** Actualización de perfil */
export type PerfilUpdate = TablesUpdate<"profiles">

// Permisos y acceso
/** Permiso de acceso para un miembro familiar */
export type PermisoFamiliar = Tables<"family_permissions">
/** Inserción de permiso familiar */
export type PermisoFamiliarInsert = TablesInsert<"family_permissions">
/** Actualización de permiso familiar */
export type PermisoFamiliarUpdate = TablesUpdate<"family_permissions">

/**
 * Verbo de permiso sobre un perfil: los tres flags de `family_permissions`
 * leídos como operación (docs/modelo-permisos.md §4 y §6.1).
 *
 * - `view` → `SELECT` (dueño, o `can_view` / `can_upload` / `can_manage`)
 * - `upload` → `INSERT` (dueño, o `can_upload` / `can_manage`)
 * - `manage` → `UPDATE` / `DELETE` (dueño, o `can_manage`)
 *
 * Se mantiene en inglés a propósito: son los nombres de las columnas de la
 * base y los de la firma que fija el roadmap para `requerirPermiso`.
 */
export type VerboPermiso = "view" | "upload" | "manage"

/** Registro de acceso y auditoría */
export type RegistroAcceso = Tables<"access_logs">
/** Inserción de registro de acceso */
export type RegistroAccesoInsert = TablesInsert<"access_logs">
/** Actualización de registro de acceso */
export type RegistroAccesoUpdate = TablesUpdate<"access_logs">

// Documentos médicos
/** Documento médico (laboratorio, imagen, prescripción, consulta, otro) */
export type Documento = Tables<"documents">
/** Inserción de documento */
export type DocumentoInsert = TablesInsert<"documents">
/** Actualización de documento */
export type DocumentoUpdate = TablesUpdate<"documents">

// Laboratorio y métricas
/** Métrica de laboratorio (análisis de sangre, etc.) */
export type MetricaLaboratorio = Tables<"lab_metrics">
/** Inserción de métrica de laboratorio */
export type MetricaLaboratorioInsert = TablesInsert<"lab_metrics">
/** Actualización de métrica de laboratorio */
export type MetricaLaboratorioUpdate = TablesUpdate<"lab_metrics">

// Citas y turnos
/** Turno o cita médica */
export type Turno = Tables<"appointments">
/** Inserción de turno */
export type TurnoInsert = TablesInsert<"appointments">
/** Actualización de turno */
export type TurnoUpdate = TablesUpdate<"appointments">

// Médicos
/** Médico en el sistema */
export type Medico = Tables<"doctors">
/** Inserción de médico */
export type MedicoInsert = TablesInsert<"doctors">
/** Actualización de médico */
export type MedicoUpdate = TablesUpdate<"doctors">

// Medicaciones
/** Medicamento activo del paciente */
export type Medicacion = Tables<"medications">
/** Inserción de medicación */
export type MedicacionInsert = TablesInsert<"medications">
/** Actualización de medicación */
export type MedicacionUpdate = TablesUpdate<"medications">

/** Toma individual de medicamento */
export type TomaMedicacion = Tables<"medication_intakes">
/** Inserción de toma de medicación */
export type TomaMedicacionInsert = TablesInsert<"medication_intakes">
/** Actualización de toma de medicación */
export type TomaMedicacionUpdate = TablesUpdate<"medication_intakes">

// Signos vitales
/** Signo vital medido (presión, glucosa, peso, etc.) */
export type SignoVital = Tables<"vital_signs">
/** Inserción de signo vital */
export type SignoVitalInsert = TablesInsert<"vital_signs">
/** Actualización de signo vital */
export type SignoVitalUpdate = TablesUpdate<"vital_signs">

// Coberturas y seguros
/** Credencial o tarjeta de cobertura médica */
export type CredencialCobertura = Tables<"insurance_cards">
/** Inserción de credencial */
export type CredencialCoberturaInsert = TablesInsert<"insurance_cards">
/** Actualización de credencial */
export type CredencialCoberturaUpdate = TablesUpdate<"insurance_cards">

// Push notifications
/** Suscripción a notificaciones push */
export type SuscripcionPush = Tables<"push_subscriptions">
/** Inserción de suscripción push */
export type SuscripcionPushInsert = TablesInsert<"push_subscriptions">
/** Actualización de suscripción push */
export type SuscripcionPushUpdate = TablesUpdate<"push_subscriptions">

// Enums (tipos de dato)

/** Rol del usuario en el sistema */
export type RolUsuario = Enums<"user_role">

/** Categoría de documento médico */
export type CategoriaDocumento = Enums<"doc_category">

/** Estado de un turno o cita */
export type EstadoTurno = Enums<"appointment_status">

/** Tipo de signo vital medido */
export type TipoSignoVital = Enums<"vital_sign_type">

/** Frecuencia de medicación */
export type FrecuenciaMedicacion = Enums<"medication_frequency">

/** Estado de toma de medicación */
export type EstadoTomaMedicacion = Enums<"medication_intake_status">

/** Acción de acceso registrada */
export type AccionAcceso = Enums<"access_action">
