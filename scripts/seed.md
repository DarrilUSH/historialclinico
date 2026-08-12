# Seed de datos de prueba — Historial Médico

## Descripción general

El seed (`supabase/seed.sql`) carga datos de prueba que reproducen los **tres casos canónicos del modelo de permisos familiales** documentados en `docs/modelo-permisos.md` §3:

- **Caso A:** María Gómez (44 años, administrador) — perfil con cuenta propia
- **Caso B:** Roberto Gómez (78 años, perfil gestionado) — sin cuenta, administrado por María
- **Caso C:** Diego Gómez (41 años, familiar) — acceso parcial (solo lectura) a Roberto

## Credenciales de prueba

Ambas cuentas comparten la contraseña:

```
contraseña: password123
```

### Usuarios

| Email | Contraseña | Rol | Acceso |
|-------|-----------|-----|--------|
| `maria@ejemplo.com.ar` | `password123` | `admin` | Cuenta propia + administra Roberto |
| `diego@ejemplo.com.ar` | `password123` | `family_member` | Cuenta propia + solo ve Roberto |

### Perfiles gestionados

| Nombre | Edad | Cuenta | Creado por | Accesos |
|--------|------|--------|-----------|---------|
| Roberto Gómez | 78 | ✗ (NULL) | María | María (todos), Diego (solo lectura) |

## Contenido del seed

### 1. Permisos familiares (`family_permissions`)

- **María → Roberto:** `can_view=true, can_upload=true, can_manage=true` (administración total)
- **Diego → Roberto:** `can_view=true, can_upload=false, can_manage=false` (solo lectura)

### 2. Datos de Roberto (perfil gestionado)

#### Ficha SOS (emergencia offline)

```
Grupo sanguíneo: O+
Alergias: Penicilina, Ibuprofeno
Condiciones crónicas: Hipertensión arterial, Diabetes tipo 2, Insuficiencia cardíaca
Medicación crítica: Enalapril 10 mg, Metformina 850 mg
Contacto emergencia: Gabriela Gómez (Hija) — +54 9 2901 234567
Notas: Marcapasos colocado en 2019. Usa lentes.
```

#### Documentos (5 estudios)

- Análisis de sangre completo — Laboratorio Central (2026-08-01, laboratory)
- Receta — Metformina 850 mg (2026-07-20, prescription)
- Electrocardiograma (2026-06-15, imaging)
- Consulta — Control de diabetes y presión (2026-08-05, consultation)
- Informe administrativo — Antecedentes médicos (2026-05-10, other)

Storage paths: `660e8400-e29b-41d4-a716-446655440003/{año}/{uuid}.{ext}`

#### Métricas de laboratorio (20 valores)

Series temporales para gráficos del Sprint 5:

- **Glucemia:** 5 mediciones (145, 138, 142, 135, 148 mg/dL) — fechas espaciadas
- **Colesterol total:** 5 mediciones (215, 208, 220, 205, 212 mg/dL)
- **HDL colesterol:** 5 mediciones (42, 44, 41, 45, 38 mg/dL)
- **Hemoglobina:** 5 mediciones (13.8, 13.9, 13.6, 14.1, 13.7 g/dL)

#### Turnos médicos (3 appointments)

- **Futuro 1:** Cardiología — Dr. Carlos Rodríguez, en 2 días (pending)
- **Futuro 2:** Endocrinología — Dra. Marcela Torres, en 7 días (confirmed)
- **Pasado:** Medicina General — Dr. Carlos Rodríguez, hace 20 días (completed)

Todos con coordenadas de Ushuaia (lat/lng reales).

#### Medicaciones (2 activas)

1. **Glucophage (Metformina 850 mg)**
   - Frecuencia: `daily` (diariamente)
   - Horarios: `08:00, 20:00`
   - Stock: 120 comprimidos
   - Receta: vinculada al documento de prescripción
   - Notas: "Tomar con las comidas"

2. **Enalapril 10 mg**
   - Frecuencia: `interval_hours` (cada N horas)
   - Intervalo: 24 horas
   - Stock: 90 comprimidos
   - Notas: "Tomar por la mañana. Reportar mareos o tos seca."

#### Tomas de medicación (10 intakes)

Registro histórico de Metformina en los últimos 5 días:

- 2 tomas confirmadas (`taken`) con timestamp
- 1 toma saltada (`skipped`) con motivo
- 7 tomas pending (programa futuro)

#### Signos vitales (10 mediciones)

- **Presión arterial (blood_pressure):** 6 mediciones
  - Valores normales: 135-142 mmHg sistólica, 80-85 diastólica
  - **1 presión elevada:** 165/102 (3 días atrás) — para probar alertas futuras
  - Incluye pulso (72-88 lpm)

- **Glucemia (glucose):** 2 mediciones
  - 148 mg/dL (3 días atrás, en ayunas)
  - 156 mg/dL (1 día atrás, en ayunas)

- **Peso (weight):** 2 mediciones
  - 78.5 kg (7 días atrás)
  - 79.2 kg (1 día atrás)

#### Médicos (2 profesionales)

1. **Dr. Carlos Rodríguez**
   - Especialidad: Cardiología
   - Matrícula: MN 45678
   - Institución: Clínica Ushuaia
   - Ubicación: Gob. Paz 150, Ushuaia (-54.8083, -68.3000)

2. **Dra. Marcela Torres**
   - Especialidad: Endocrinología
   - Matrícula: MN 56789
   - Institución: Consultorio Torres
   - Ubicación: Maipú 345, Ushuaia (-54.8078, -68.2999)

#### Cobertura de salud (1 póliza)

- **Proveedor:** PAMI — Pensionados
- **Número de afiliado:** 2890154780
- **Plan:** Cobertura integral
- **Válida hasta:** 2027-12-31
- **Primaria:** Sí
- **Storage paths:** frente y dorso en `credenciales-cobertura`

### 3. Infraestructura de notificaciones

#### Push subscription (1)

- **Perfil:** María
- **User:** María (550e8400-e29b-41d4-a716-446655440001)
- **Endpoint:** `https://fcm.googleapis.com/fcm/send/ficticio-seed-token`
- **Claves:** base64url ficticias (p256dh, auth)

## Convenciones de datos

### Fechas

- Todas las fechas/timestamps están en rango **2025-2026** para contexto realista.
- Usar formato ISO 8601 (`YYYY-MM-DD HH:MM:SS` con zona `America/Argentina/Ushuaia`).

### Storage paths

Formato consistente: `{profile_id}/{año}/{uuid}.{ext}`

Ejemplo: `660e8400-e29b-41d4-a716-446655440003/2026/d8f4c1b9.pdf`

### Encoding

- **UTF-8 sin BOM** (obligatorio en todo el proyecto)
- Nombres en español con tildes y ñ:
  - María (Á), Gómez (Ó), Roberto, Ushuaia
  - Alergias: "Penicilina", "Ibuprofeno" (con acento si corresponde)
  - Notas: acentos y puntuación normal

### UUIDs fijos

Utilizados para reproducibilidad:

```
Usuarios:
  María:  550e8400-e29b-41d4-a716-446655440001
  Diego:  550e8400-e29b-41d4-a716-446655440002

Perfiles:
  María:    660e8400-e29b-41d4-a716-446655440001
  Diego:    660e8400-e29b-41d4-a716-446655440002
  Roberto:  660e8400-e29b-41d4-a716-446655440003

Documentos:
  Doc 1-5: 770e8400-e29b-41d4-a716-446655440001 a 005

Medicaciones:
  Med 1-2: 880e8400-e29b-41d4-a716-446655440001 a 002

Médicos:
  Cardio:  990e8400-e29b-41d4-a716-446655440001
  Endocr:  990e8400-e29b-41d4-a716-446655440002

Cobertura:
  PAMI: aa0e8400-e29b-41d4-a716-446655440001

Push:
  Sub 1: bb0e8400-e29b-41d4-a716-446655440001
```

## Cómo usar el seed

### Cargar los datos

```bash
cd historialclinico
npx supabase db reset
```

Esto:
1. Recreatea la base de datos local
2. Aplica las migraciones en orden (schema, ajustes, RLS, storage)
3. Carga `supabase/seed.sql` automáticamente

### Verificar que se cargó

```bash
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"
docker exec supabase_db_historialclinico psql -U postgres -d postgres -t -c "
  select 'profiles', count(*) from public.profiles
  union all select 'documents', count(*) from public.documents
  union all select 'lab_metrics', count(*) from public.lab_metrics
"
```

Esperado:
- `profiles`: 3
- `documents`: 5
- `lab_metrics`: 20
- (y más)

### Probar acceso con RLS

```bash
# Ejecutar suite de tests
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres < scripts/test-rls.sql
```

Esperado: **54 casos, 54 pasados** (TODOS LOS CASOS PASARON)

### Limpiar después de pruebas

El seed es **idempotente** — `npx supabase db reset` limpia y recarga desde cero.

## Cambios futuros

- **Sprint 2:** Agregar registros de acceso iniciales a `access_logs` para la auditoría.
- **Sprint 4:** Expandir `lab_metrics` con métricas canónicas y mappings de sinónimos.
- **Sprint 5:** Confirmar que los gráficos de series temporales usan las 20 métricas correctamente.
- **Sprint 6:** Validar que el borrado de perfiles encola objetos en `storage_purge_queue`.

## Notas de implementación

- El perfil gestionado (Roberto) nace con `created_by_profile_id = María`, satisfaciendo la deuda D1.
- Todos los datos de contenido tienen `created_by_profile_id` populado (deuda D2).
- La fila de arranque de family_permissions para Roberto tiene `can_view=can_upload=can_manage=true` (caso B, fila bootstrap obligatoria).
- Las presiones vitales incluyen 1 valor fuera de rango (165/102) para validar alertas futuras.
- Los timestamps de medicaciones respetan el CHECK `scheduled_at` único por medicación.
- Storage paths nunca son URLs (validación `LIKE 'http%'` protegida en CHECK).
