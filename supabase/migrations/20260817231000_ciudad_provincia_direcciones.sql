-- =============================================================================
-- Historial Médico — Migración 20260817231000: ciudad y provincia en
-- direcciones de turnos y médicos (Sprint 16, tarea 16.1)
-- -----------------------------------------------------------------------------
-- ── EL BUG QUE ESTO CORRIGE
--
-- `appointments.location_address` y `doctors.address` son, desde el Sprint 6 y
-- el Sprint 10 respectivamente, un solo campo de texto libre ("calle y
-- altura", sin ciudad ni provincia). El deep link de "Cómo llegar"
-- (`lib/logistica/deep-links.ts#linkComoLlegar`) resolvía la falta de esos
-- datos agregando ", Ushuaia, Tierra del Fuego" HARDCODEADO cada vez que no
-- había coordenadas cargadas -Ushuaia es la sede real del desarrollo del
-- producto, pero la familia del usuario carga turnos en La Plata, CABA, y
-- otras localidades: el link terminaba apuntando al lugar equivocado, o
-- Google Maps no encontraba nada porque buscaba "Avenida 51 Nº 315, Ushuaia,
-- Tierra del Fuego" en vez de "..., La Plata, Buenos Aires". Bug reportado por
-- el usuario con uso real (ROADMAP_SPRINTS.md §Sprint 16, ítem 1).
--
-- ── LA DECISIÓN DE ESQUEMA: COLUMNAS NUEVAS, NO PARTIR location_address
--
-- Se evaluaron dos caminos:
--
--   1. Seguir con un solo campo de texto libre y pedirle a la persona que
--      escriba "calle, ciudad, provincia" todo junto. Se descarta: ya es el
--      comportamiento de HOY (nada le impedía escribir "Avenida 51 Nº 315, La
--      Plata, Buenos Aires" en `location_address`) y es exactamente lo que
--      generó el bug -la información puede faltar, y cuando falta, el código
--      no tiene de dónde tomar una ciudad real, así que inventaba una-. Un
--      campo de texto libre no es un dato ESTRUCTURADO: no se puede armar una
--      consulta de geocodificación con `street`/`city`/`state` separados
--      (Nominatim structured query, `lib/ubicacion/geocodificacion.ts`) ni
--      autocompletar "la última ciudad usada" de forma confiable si la ciudad
--      puede estar en cualquier posición dentro de un string libre.
--   2. Sumar `location_city`/`location_province` (turnos) y `city`/`province`
--      (médicos) como columnas propias, y dejar `location_address`/`address`
--      como lo que su propio nombre y comentario ya dicen desde el Sprint 6/10
--      -"calle y altura"-. Es la opción elegida: los datos existentes NO se
--      rompen (las columnas nuevas nacen `NULL`, un turno viejo sigue
--      funcionando exactamente igual, ver `linkComoLlegar` actualizado en el
--      mismo commit de esta migración), y de acá en adelante la app puede
--      armar tanto la consulta de geocodificación como el texto completo para
--      mostrar (`lib/ubicacion/formato.ts#direccionCompleta`) a partir de
--      partes estructuradas en vez de adivinar.
--
-- ── PROVINCIA: CATÁLOGO CERRADO, MISMO PATRÓN QUE blood_type
--
-- `location_province`/`province` son `text` + `CHECK ... IN (...)` con las 24
-- jurisdicciones argentinas (23 provincias + CABA, como
-- "Ciudad Autónoma de Buenos Aires" -no la sigla-), calcado del patrón que ya
-- usa `profiles_blood_type_valido` (20260812200000 §4.2): un dominio cerrado
-- del PRODUCTO se valida con texto + CHECK y no con un enum de Postgres a
-- propósito, porque la fuente de verdad real de las 24 jurisdicciones es la
-- constante TypeScript `lib/ubicacion/provincias.ts#PROVINCIAS_ARGENTINAS`
-- -que alimenta el `<Select>` del formulario Y el `z.enum()` del lado
-- servidor- y el CHECK de acá es la copia de esa lista en el borde de la base,
-- mismo criterio que documenta `sos.schema.ts` para los grupos sanguíneos. La
-- CIUDAD, en cambio, es texto libre sin CHECK: no hay un catálogo cerrado de
-- localidades argentinas que valga la pena mantener a mano en esta tarea (el
-- Sprint 16 ítem 3 sí trae un catálogo de establecimientos de salud vía REFES,
-- pero es una tarea aparte).
--
-- ── NULLABLE A PROPÓSITO, SIN BACKFILL
--
-- Las cuatro columnas son opcionales y nacen en `NULL` para toda fila
-- existente. No hay backfill: nadie puede reconstruir con certeza si
-- "Gob. Paz 150, Ushuaia" del seed significa ciudad "Ushuaia" sin mirarlo a
-- mano fila por fila, y automatizarlo con un parser de texto libre reintroduce
-- el mismo problema que esta migración viene a resolver (adivinar en vez de
-- preguntar). `linkComoLlegar` y el resto de la logística de turnos/médicos
-- siguen funcionando sin regresión con estas columnas en `NULL` -ver el
-- comentario de cabecera de `lib/logistica/deep-links.ts`-.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, mismo criterio que el
-- resto del proyecto. Esta migración no toca RLS: las políticas vigentes
-- (`appointments_update_administrador`, `doctors_update_administrador`, etc.,
-- 20260812220000_rls.sql) ya operan por FILA, y una columna nueva de una tabla
-- ya cubierta hereda exactamente la misma decisión de autorización sin que
-- haga falta tocar ninguna política -mismo razonamiento que ya documentó
-- 20260814120000 §4 para `display_density`-.
-- =============================================================================


-- =============================================================================
-- 1. appointments — location_city / location_province
-- =============================================================================

alter table public.appointments
    add column location_city     text,
    add column location_province text;

comment on column public.appointments.location_city is
    'Ciudad del lugar de atención, texto libre (ej: "La Plata", "CABA"). Opcional y separada de location_address ("calle y altura") a propósito, Sprint 16 tarea 16.1: permite armar una consulta de geocodificación estructurada (calle+ciudad+provincia) y corregir el sesgo a Ushuaia que tenía el deep link de "Cómo llegar". NULL en turnos cargados antes de esta migración, sin romper nada -linkComoLlegar sigue funcionando solo con location_address-.';
comment on column public.appointments.location_province is
    'Provincia del lugar de atención. Dominio cerrado a las 24 jurisdicciones argentinas (appointments_location_province_valida), calcado de profiles_blood_type_valido: la lista vive primero en lib/ubicacion/provincias.ts#PROVINCIAS_ARGENTINAS (fuente única para el <Select> y el z.enum() del servidor) y este CHECK es su copia en el borde de la base.';

alter table public.appointments
    add constraint appointments_location_province_valida
        check (location_province is null or location_province in (
            'Buenos Aires',
            'Catamarca',
            'Chaco',
            'Chubut',
            'Ciudad Autónoma de Buenos Aires',
            'Córdoba',
            'Corrientes',
            'Entre Ríos',
            'Formosa',
            'Jujuy',
            'La Pampa',
            'La Rioja',
            'Mendoza',
            'Misiones',
            'Neuquén',
            'Río Negro',
            'Salta',
            'San Juan',
            'San Luis',
            'Santa Cruz',
            'Santa Fe',
            'Santiago del Estero',
            'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
            'Tucumán'
        ));


-- =============================================================================
-- 2. doctors — city / province
-- =============================================================================

alter table public.doctors
    add column city     text,
    add column province text;

comment on column public.doctors.city is
    'Ciudad del consultorio, texto libre. Mismo criterio y mismo motivo que appointments.location_city (Sprint 16, tarea 16.1): separada de address ("calle y altura") para poder geocodificar sin adivinar la localidad. NULL en médicos cargados antes de esta migración.';
comment on column public.doctors.province is
    'Provincia del consultorio. Mismo dominio cerrado de 24 jurisdicciones que appointments.location_province (doctors_province_valida), misma fuente única lib/ubicacion/provincias.ts#PROVINCIAS_ARGENTINAS.';

alter table public.doctors
    add constraint doctors_province_valida
        check (province is null or province in (
            'Buenos Aires',
            'Catamarca',
            'Chaco',
            'Chubut',
            'Ciudad Autónoma de Buenos Aires',
            'Córdoba',
            'Corrientes',
            'Entre Ríos',
            'Formosa',
            'Jujuy',
            'La Pampa',
            'La Rioja',
            'Mendoza',
            'Misiones',
            'Neuquén',
            'Río Negro',
            'Salta',
            'San Juan',
            'San Luis',
            'Santa Cruz',
            'Santa Fe',
            'Santiago del Estero',
            'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
            'Tucumán'
        ));

-- Fin de la migración.
