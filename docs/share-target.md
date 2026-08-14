# Web Share Target: recibir archivos desde el menú Compartir del sistema

> Sprint 11, tarea 11.2. Implementación: `app/manifest.ts` (bloque
> `share_target`), `app/api/compartir/route.ts` (receptor),
> `app/(app)/(sin-nav)/compartir/*` (pantalla de recepción + Server Actions),
> `lib/documentos/compartir-temporal*.ts` (helpers + escritura con
> `service_role`), `supabase/migrations/20260814100000_share_target_temporal.sql`
> (bucket `compartidos-temp` + tabla `shared_uploads_temp`).
>
> Depende de: `app/manifest.ts` e instalabilidad (tarea 11.1) y el pipeline de
> ingesta del Sprint 4 (`lib/documentos/ingesta.ts`,
> `components/documentos/formulario-revision.tsx`).

---

## 1. Qué resuelve

Compartir un PDF o una foto desde **cualquier app** del celular (galería,
Gmail, WhatsApp, el explorador de archivos) y que "Historial Médico" aparezca
como destino en la hoja de "Compartir" del sistema — sin tener que abrir la
app primero, buscar "Subir estudio" y elegir el archivo a mano.

El flujo completo, decidido en el roadmap:

```
compartir desde otra app
        │
        ▼
pantalla de recepción (/compartir)
        │
        ▼
elegir PERFIL DE DESTINO   ← crítico: la app es multiperfil
        │
        ▼
extracción automática con Gemini   ← el pipeline del Sprint 4, sin cambios
        │
        ▼
formulario de revisión   ← el mismo de siempre
        │
        ▼
visto bueno del usuario  →  RECIÉN ACÁ se guarda
```

**La IA nunca guarda sin confirmación.** Esa regla del Sprint 4 no tiene
ninguna excepción para este camino: un archivo compartido pasa exactamente por
la misma pantalla de revisión que un archivo subido a mano desde
`/estudios/nuevo`.

---

## 2. El flujo paso a paso

### 2.1 El sistema operativo hace un POST

`share_target` en `app/manifest.ts` registra a la PWA como destino:

```json
{
  "action": "/api/compartir",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "titulo",
    "text": "texto",
    "files": [{ "name": "archivos", "accept": ["application/pdf", "image/jpeg", "image/png", "image/webp"] }]
  }
}
```

Cuando alguien elige "Historial Médico" en la hoja de compartir, el navegador
hace un **POST `multipart/form-data` de nivel superior** (una navegación real,
no un `fetch` de script) a `/api/compartir`, con el archivo en el campo
`archivos`. `title`/`text` viajan si la app de origen los manda (por ejemplo,
una leyenda de WhatsApp), pero el receptor no los usa: el título final se
decide en la pantalla de revisión existente, que ya deja retitular todo antes
de confirmar. Enchufarlos ahora sería una segunda fuente de título compitiendo
con la que ya funciona.

### 2.2 El receptor (`app/api/compartir/route.ts`)

1. **Sesión.** `supabase.auth.getUser()`. Sin sesión, `303 → /login?desde=/compartir`
   y **el archivo se pierde** (§5).
2. **Purga perezosa** de las propias filas vencidas de la cuenta (§4.3).
3. **Extrae el primer archivo** del campo `archivos`. Si el sistema operativo
   compartió varios a la vez, se toma solo el primero — el pipeline entero
   (extracción, revisión, confirmación) es de UN documento por vez; una cola de
   varios queda fuera de este sprint. Sin ningún archivo válido,
   `303 → /compartir?error=sin_archivo`.
4. **Valida y guarda** con `guardarArchivoCompartido`
   (`lib/documentos/compartir-temporal-admin.ts`): magic bytes y tamaño con el
   mismo `lib/archivos/validacion.ts` que usa el resto de la app (nunca se
   confía en el `Content-Type` que declaró el sistema operativo), sube al área
   de espera. Un archivo inválido termina en
   `303 → /compartir?error=archivo_invalido`.
5. **Éxito:** `303 → /compartir?archivo={id}`.

Cada camino termina en un `303 See Other` (no `307`/`302`): le pide al
navegador repetir la navegación con `GET`, así que recargar `/compartir` nunca
reenvía el mismo POST.

### 2.3 La pantalla de recepción (`/compartir`)

Tres estados, según los parámetros de la URL:

| Estado | Cuándo | Qué muestra |
|---|---|---|
| **Con archivo** | `?archivo={id}` y la fila existe, no venció | Vista previa (nombre, tipo, tamaño, miniatura si es imagen) + selector de perfil de destino + "Descartar" |
| **Con error** | `?error={codigo}` y no hay archivo válido | Mensaje fijo por código (nunca texto libre en la URL — ver §2.4) + volver a inicio |
| **Vacío** | Ninguno de los dos (alguien navegó acá directo) | Explicación breve de cómo usar la función |

Si un intento anterior de elegir perfil falló pero el archivo TODAVÍA existe
(`?archivo={id}&error={codigo}` a la vez), se muestra el estado "con archivo"
con el error como aviso arriba: la persona no tiene que volver a compartir
para reintentar con otro perfil.

El selector (`components/compartir/selector-destino.tsx`) solo lista perfiles
donde la sesión tiene `can_upload` — mismo patrón visual que
`components/perfiles/selector-perfiles.tsx` (Sprint 2), pero filtrado: un
perfil de solo lectura no tiene sentido como destino de una carga.

### 2.4 Códigos de error (`lib/documentos/compartir-temporal.ts`)

| Código | Cuándo |
|---|---|
| `sin_archivo` | El receptor no encontró ningún archivo en el POST |
| `archivo_invalido` | Magic bytes/tamaño no pasan la validación |
| `no_encontrado` | El token no existe, no es de esta cuenta (RLS), o ya venció |
| `permiso_denegado` | Al elegir perfil, la sesión ya no tiene `can_upload` sobre ese perfil (revocado entre que se renderizó la lista y el click) |
| `inesperado` | Cualquier otra falla (red, Storage, base) |

Se viaja por código, nunca por texto libre en la query string: un mensaje en
español embebido en la URL es una superficie de inyección de contenido
gratuita, y tampoco sobrevive bien al encoding. `mensajeErrorCompartido`
traduce cada código a un texto fijo elegido por el servidor.

### 2.5 Elegir perfil: acá el archivo se vuelve un documento real

`elegirPerfilParaCompartido` (`app/(app)/(sin-nav)/compartir/actions.ts`):

1. `requerirPermiso(perfilId, "upload")`.
2. Descarga el archivo del área de espera (`descargarObjeto`, cliente
   `service_role` porque `compartidos-temp` no tiene política de cliente —
   pero el PERMISO ya se verificó en el paso 1).
3. Reconstruye un `File` con el nombre y MIME originales.
4. **`ingestarDocumento(supabase, perfilId, archivo)`** —
   `lib/documentos/ingesta.ts`, **exactamente el mismo núcleo** que usa
   `/estudios/nuevo`. Ese módulo fue diseñado en el Sprint 4 explícitamente
   para este momento (ver su propio encabezado: "en el Sprint 11 lo va a
   llamar el Web Share Target"). Ninguna rama especial, ningún `if
   (vieneDeCompartir)` en ningún lado del pipeline de subida.
5. Limpia el área de espera (objeto + fila).
6. `redirect("/estudios/nuevo/procesando?doc={id}")` — la pantalla de
   extracción + revisión del Sprint 4, sin cambios.

De ahí en adelante es el flujo de siempre: `PantallaProcesando` dispara `POST
/api/documentos/extraer` (Gemini, con su propio manejo de error que nunca
bloquea la subida), y `FormularioRevision` es la única puerta que persiste
algo, al tocar "Confirmar y guardar".

---

## 3. Por qué NO hay una fila de `documents` desde el primer POST

En el momento del POST a `/api/compartir` todavía no se eligió PERFIL — es una
app multiperfil (María puede administrar a Roberto y a sí misma) — y
`documents.profile_id` es `NOT NULL`. Toda la matriz de RLS de `documents` y
de `storage.objects` deriva del `profile_id`: no hay ningún camino para
insertar un documento "sin dueño todavía".

## 4. El almacenamiento temporal: alternativas evaluadas

### 4.1 Alternativas descartadas

1. **Prefijo `compartidos-temp/{user_id}/` dentro del bucket
   `documentos-medicos`** (la sugerencia inicial de la tarea). Descartada:
   `perfil_de_objeto_storage()` interpreta el primer segmento del path como
   `profile_id`; mezclar ahí objetos SIN fila de `documents` rompe el
   invariante "todo objeto de `documentos-medicos` tiene una fila que lo
   referencia" — útil para cualquier auditoría futura de huérfanos — y hubiera
   exigido una segunda rama en una función hoy simple e `immutable`.
2. **`profile_id` nullable en `documents`, INSERT inmediato sin perfil.**
   Descartada: revisar cada política RLS y cada función `SECURITY DEFINER` de
   `documents` que hoy asume `profile_id` no nulo es semanas de trabajo para
   un documento que, sin perfil, no se puede mostrar en ningún lado igual.
   Desproporcionado para este sprint.

### 4.2 Elegida: bucket y tabla propios

- **Bucket `compartidos-temp`** (25 MiB, mismos 4 MIME que
  `documentos-medicos`). **Sin ninguna política de `storage.objects`**: como
  todas las políticas existentes filtran por `bucket_id in (...)` a los tres
  buckets del producto, un bucket nuevo sin política propia queda con RLS en
  negación por defecto para `anon`/`authenticated` — nadie del lado cliente lo
  puede tocar, solo `service_role` (`lib/storage-admin.ts`, funciones
  `subirObjeto`/`descargarObjeto`/`borrarObjeto`).
- **Tabla `public.shared_uploads_temp`**: `user_id` (la CUENTA que compartió,
  no un perfil — todavía no se eligió), `storage_path`, `mime_type`,
  `original_filename`, `file_size_bytes`, `expires_at` (default 1 hora, la
  misma ventana que `confirmar_documento_recien_subido`). RLS: `SELECT` y
  `DELETE` para `authenticated` con `user_id = auth.uid()`; **sin `INSERT` ni
  `UPDATE`** para `authenticated` — la única fila la crea el receptor con
  `service_role`, después de verificar la sesión.
- El path dentro del bucket es `{user_id}/{uuid}.{ext}` — más chico que
  `construirStoragePath` de `ingesta.ts` (que además mete el año): acá no
  existe un archivo del año pasado por definición, vive como mucho una hora.

Detalle completo, con el razonamiento línea por línea, en el encabezado de
`supabase/migrations/20260814100000_share_target_temporal.sql`.

### 4.3 Purga: perezosa ahora, deuda declarada para un job programado

**Qué hace hoy** (`purgarCompartidosVencidos`,
`lib/documentos/compartir-temporal-admin.ts`): en cada POST al receptor y en
cada carga de `/compartir`, se barren las filas VENCIDAS **de la misma
cuenta** (`user_id = auth.uid()`, con el cliente normal de la sesión —
`shared_uploads_temp_delete_propio` ya alcanza) junto con sus objetos en
Storage (`borrarObjeto`, la única forma de tocar el bucket). Cubre el caso
común: alguien comparte, decide no continuar, y en algún momento vuelve a
tocar la función.

**Qué NO cubre:** una cuenta que comparte una vez y nunca vuelve a abrir la
app. Su fila queda viva más allá de la hora hasta que algo la barra.

**Por qué no se armó un tercer job de `pg_cron`.** El proyecto ya tiene el
patrón funcionando dos veces (`20260813050000_recordatorios_turnos.sql`:
`pg_cron` + `pg_net` + secretos en Supabase Vault + `x-cron-secret`), así que
técnicamente hubiera sido calcar ese molde. Pero:

- Exige configurar Vault a mano en CADA entorno (local y producción) — un paso
  manual que nadie puede verificar sin desplegar de verdad, y este sprint no
  tiene forma de probarlo end-to-end.
- Sería **más automatización que la que tiene hoy el propio mecanismo del que
  es calco**: `storage_purge_queue` (`20260812210000_ajustes_modelo.sql`)
  dice textualmente en su comentario "el job que la drena... es del Sprint 6"
  y, a la fecha de esta tarea (Sprint 11), **ese job todavía no se
  escribió** — es deuda aceptada del proyecto, no un olvido de esta tarea.

Se documenta como la MISMA deuda, con el mismo alcance: la peor consecuencia
posible es un archivo que queda unas horas de más en un bucket privado **sin
ninguna política de cliente** (nadie más lo puede leer, ni siquiera su propia
cuenta después de que expira visualmente en `/compartir` — la fila deja de
resolver por RLS igual, aunque el objeto siga en Storage hasta la próxima
purga perezosa). Cuando se escriba el job que drene `storage_purge_queue`, es
el lugar natural para agregar un segundo barrido sobre
`shared_uploads_temp.expires_at` en el mismo Route Handler.

---

## 5. Limitaciones conocidas

### 5.1 iOS no tiene Web Share Target

Safari/iOS no implementa `share_target` del Web App Manifest (a la fecha de
esta tarea). En iPhone, "Historial Médico" nunca va a aparecer en la hoja de
compartir del sistema, esté o no instalada la PWA. **La alternativa es la de
siempre:** abrir la app y subir el archivo desde `/estudios/nuevo`
(`CargadorDocumento`, Sprint 4) — cámara, galería o PDF ya guardado. No hay
forma de emular `share_target` en iOS sin una app nativa (fuera del alcance de
una PWA).

### 5.2 Verificación real contra localhost/WebAPK — heredada de la tarea 11.1

La tarea 11.1 (manifest e instalabilidad) ya documentó esto y sigue vigente
acá con el mismo alcance: `share_target` **solo lo aplica el sistema cuando la
PWA está instalada como WebAPK real**, y el WebAPK real no se puede acuñar
contra `localhost` — el servicio de Google que lo genera no alcanza un túnel
`adb reverse`. Eso significa que **"Historial Médico" apareciendo en la hoja
de compartir de Android nunca se pudo ver en esta tarea**, ni se va a poder
ver hasta que la app esté servida desde el dominio real
(`historialmedico.com.ar`, Sprint 12).

### 5.3 Qué SÍ se verificó en esta tarea (sin la hoja de compartir)

El circuito entero, salvo el gesto de "tocar Compartir → elegir la app" en
Android, se verificó de punta a punta contra la instancia local (ver §7 para
el detalle de cada paso):

- El receptor sin sesión responde `303` con el `Location` exacto
  (`curl`, sin seguir redirects).
- Con sesión, un `POST multipart/form-data` real (`fetch` + `FormData` desde
  la consola del navegador, con un PDF generado en el momento) es aceptado,
  guardado en el área de espera, y redirige al token correcto.
- La pantalla de recepción muestra la vista previa y el selector de perfil
  reales.
- Elegir un perfil dispara una llamada REAL a Gemini (una sola vez — se
  verificó en los logs del servidor) y aterriza en la pantalla de revisión
  existente del Sprint 4.
- Confirmar deja el documento en `/estudios` del perfil elegido, con
  `confirmed_at` sellado (verificado por SQL).
- Descartar borra la fila y el objeto temporal (verificado por SQL, en 0 y 0).
- La purga perezosa barre una fila vencida "a mano" (sembrada por SQL,
  simulando abandono real) apenas la cuenta vuelve a abrir `/compartir`.

### 5.4 Plan de verificación en producción (Sprint 12, smoke test)

Una vez desplegado a `historialmedico.com.ar` y la PWA reinstalada como
WebAPK real:

1. Instalar la PWA en un Android real (Chrome).
2. Desde la galería, compartir una foto → confirmar que "Historial Médico"
   aparece en la hoja de compartir del sistema.
3. Elegirla → confirmar que abre la pantalla de recepción con la foto.
4. Elegir un perfil → confirmar que llega a la revisión con datos reales
   extraídos por Gemini (no el fallback de "no pudimos leer" que se vio en
   esta tarea con un PDF sintético sin contenido real).
5. Compartir un PDF de verdad desde el explorador de archivos → mismo camino.
6. Compartir sin tener la PWA instalada (o con sesión cerrada) → confirmar que
   la opción simplemente no aparece / que cerrar sesión no rompe nada.
7. Actualizar `docs/estado-proyecto.md` con la evidencia (capturas,
   igual que el resto de las verificaciones en dispositivo real del
   proyecto).

---

## 6. Referencias

| Archivo | Rol |
|---|---|
| `app/manifest.ts` | Bloque `share_target` |
| `lib/auth/rutas.ts` | `RUTA_COMPARTIR`: excepción de proxy (pública para el 401 automático, el receptor hace su propia guarda de sesión) |
| `app/api/compartir/route.ts` | Receptor POST multipart |
| `app/(app)/(sin-nav)/compartir/page.tsx` | Pantalla de recepción (tres estados) |
| `app/(app)/(sin-nav)/compartir/actions.ts` | `elegirPerfilParaCompartido`, `descartarCompartido` |
| `components/compartir/selector-destino.tsx` | Selector de perfil de destino (solo `can_upload`) |
| `components/compartir/boton-descartar.tsx` | Botón + diálogo de descarte |
| `lib/documentos/compartir-temporal.ts` | Helpers puros (path, TTL, mensajes de error, vencimiento) — testeados en `tests/unit/compartir-temporal.test.ts` |
| `lib/documentos/compartir-temporal-admin.ts` | Escritura con `service_role`: `guardarArchivoCompartido`, `purgarCompartidosVencidos` |
| `lib/storage-admin.ts` | `BUCKETS.compartidosTemp`, `subirObjeto` (nuevo) |
| `lib/documentos/ingesta.ts` | Núcleo reusado sin cambios (`ingestarDocumento`) |
| `supabase/migrations/20260814100000_share_target_temporal.sql` | Bucket + tabla + RLS, con el razonamiento completo de las alternativas |
