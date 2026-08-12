#!/usr/bin/env bash
# =============================================================================
# MiHistorialMédico — Prueba de aislamiento de Storage (buckets privados)
# -----------------------------------------------------------------------------
# Complementa a scripts/test-rls.sql: aquel prueba las políticas de las TABLAS
# por SQL; este prueba las políticas de `storage.objects` **por HTTP contra el
# servicio de Storage real**, que es la única forma de verificar que el archivo
# —y no sólo su fila— queda protegido.
#
# Cómo se corre (con la instancia local levantada):
#
#     bash scripts/test-storage-rls.sh
#
# Es idempotente y autolimpiante: borra sus objetos, perfiles y cuentas al
# terminar. Sale con código 0 sólo si los 20 casos pasan.
#
# CÓMO SIMULA UNA SESIÓN: firma un JWT HS256 con el secreto local que expone
# `npx supabase status` (mismo `sub` / `role` / `aud` que emite GoTrue) y lo
# manda en el header Authorization, igual que lo haría el navegador. No imprime
# ninguna clave ni ningún JWT completo.
#
# Requisitos: docker, curl, openssl y python en el PATH.
# =============================================================================
set -u
cd /f/Proyectos/historialclinico
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"

ST=http://127.0.0.1:54321/storage/v1
PSQL="docker exec -i supabase_db_historialclinico psql -U postgres -d postgres -q"

eval "$(npx supabase status -o json 2>/dev/null | python -c "
import json,sys
d=json.load(sys.stdin)
print('SERVICE_KEY=%s' % d['SERVICE_ROLE_KEY'])
print('JWT_SECRET=%s' % d['JWT_SECRET'])
")"

U_A=11111111-1111-4111-8111-111111111111
U_B=22222222-2222-4222-8222-222222222222
P_A=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
P_B=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt_de() {
  local sub="$1" now exp h p si sig
  now=$(date +%s); exp=$((now + 3600))
  h=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '{"sub":"%s","role":"authenticated","aud":"authenticated","iss":"supabase","iat":%s,"exp":%s}' "$sub" "$now" "$exp" | b64url)
  si="$h.$p"
  sig=$(printf '%s' "$si" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s' "$si" "$sig"
}

JWT_A=$(jwt_de "$U_A")
JWT_B=$(jwt_de "$U_B")

# ---------------------------------------------------------------- datos base
$PSQL <<SQL >/dev/null
delete from public.profiles where id in ('$P_A','$P_B');
delete from auth.users where id in ('$U_A','$U_B');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('$U_A','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'maria@ejemplo.ar','x',now(),now(),now(),'{"provider":"email"}','{}'),
       ('$U_B','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'diego@ejemplo.ar','x',now(),now(),now(),'{"provider":"email"}','{}');
insert into public.profiles (id, user_id, full_name) values
  ('$P_A','$U_A','María Gómez'), ('$P_B','$U_B','Diego Gómez');
SQL

OBJ_DOC="$P_A/2026/estudio.pdf"
OBJ_AVA="$P_A/avatar.png"
ARCH=./.tmp-obj.bin
printf 'contenido de prueba\n' > "$ARCH"

# el objeto de A lo crea el servidor (service key), como en producción
curl -s -o /dev/null -X DELETE "$ST/object/documentos-medicos/$OBJ_DOC" -H "Authorization: Bearer $SERVICE_KEY"
curl -s -o /dev/null -X POST "$ST/object/documentos-medicos/$OBJ_DOC" \
  -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/pdf" --data-binary "@$ARCH"

OK=0; FAIL=0
check() { # descripcion  esperado_regex  obtenido
  if [[ "$3" =~ $2 ]]; then OK=$((OK+1)); printf '  PASS  %-58s -> %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); printf '  FAIL  %-58s -> %s (esperaba %s)\n' "$1" "$3" "$2"; fi
}
code_get()  { curl -s -o /dev/null -w '%{http_code}' "$ST/object/$1/$2" -H "Authorization: Bearer $3"; }
code_post() { curl -s -o /dev/null -w '%{http_code}' -X POST "$ST/object/$1/$2" -H "Authorization: Bearer $3" -H "Content-Type: $4" --data-binary "@$ARCH"; }
code_del()  { curl -s -o /dev/null -w '%{http_code}' -X DELETE "$ST/object/$1/$2" -H "Authorization: Bearer $3"; }
permiso() { $PSQL -c "insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage) values ('$P_A','$P_B',$1,$2,$3) on conflict (owner_profile_id, granted_profile_id) do update set can_view=$1, can_upload=$2, can_manage=$3;" >/dev/null; }

echo ""
echo "=== BLOQUE 1 — B SIN NINGUN PERMISO sobre el perfil de A ==="
check "A (titular) descarga su propio estudio"        '^200$' "$(code_get documentos-medicos "$OBJ_DOC" "$JWT_A")"
check "B descarga el estudio de A"                    '^(400|403|404)$' "$(code_get documentos-medicos "$OBJ_DOC" "$JWT_B")"
check "B sube al prefijo de A"                        '^(400|403)$' "$(code_post documentos-medicos "$P_A/2026/intruso.pdf" "$JWT_B" application/pdf)"
check "B borra el estudio de A"                       '^(400|403|404)$' "$(code_del documentos-medicos "$OBJ_DOC" "$JWT_B")"

echo ""
echo "=== BLOQUE 2 — B con can_view (lee, no escribe) ==="
permiso true false false
check "B descarga el estudio de A"                    '^200$' "$(code_get documentos-medicos "$OBJ_DOC" "$JWT_B")"
check "B sube al prefijo de A sin can_upload"         '^(400|403)$' "$(code_post documentos-medicos "$P_A/2026/intruso.pdf" "$JWT_B" application/pdf)"
check "B borra el estudio de A"                       '^(400|403|404)$' "$(code_del documentos-medicos "$OBJ_DOC" "$JWT_B")"

echo ""
echo "=== BLOQUE 3 — B con can_upload (crea, no edita ni borra) ==="
permiso true true false
check "B sube un estudio al perfil de A"              '^200$' "$(code_post documentos-medicos "$P_A/2026/subido-por-b.pdf" "$JWT_B" application/pdf)"
check "B sube la foto de una credencial"              '^200$' "$(code_post credenciales-cobertura "$P_A/tarjeta/front.jpg" "$JWT_B" image/jpeg)"
check "B sube un AVATAR (exige can_manage)"           '^(400|403)$' "$(code_post avatares "$OBJ_AVA" "$JWT_B" image/png)"
check "B borra el estudio de A"                       '^(400|403|404)$' "$(code_del documentos-medicos "$OBJ_DOC" "$JWT_B")"

echo ""
echo "=== BLOQUE 4 — B con can_manage (administra) ==="
permiso true true true
check "B sube un AVATAR"                              '^200$' "$(code_post avatares "$OBJ_AVA" "$JWT_B" image/png)"
check "B borra el estudio de A"                       '^200$' "$(code_del documentos-medicos "$OBJ_DOC" "$JWT_B")"

echo ""
echo "=== BLOQUE 5 — limites del bucket y convencion de path ==="
permiso true true true
check "MIME no permitido en documentos (text/plain)"  '^(400|415)$' "$(code_post documentos-medicos "$P_A/2026/x.txt" "$JWT_B" text/plain)"
check "PDF en el bucket de avatares"                  '^(400|415)$' "$(code_post avatares "$P_A/x.pdf" "$JWT_B" application/pdf)"
check "objeto en la RAIZ del bucket (sin profile_id)" '^(400|403)$' "$(code_post documentos-medicos "suelto.pdf" "$JWT_B" application/pdf)"
check "primer segmento que no es uuid"                '^(400|403)$' "$(code_post documentos-medicos "no-es-uuid/x.pdf" "$JWT_B" application/pdf)"
check "prefijo de un perfil inexistente"              '^(400|403)$' "$(code_post documentos-medicos "99999999-9999-4999-8999-999999999999/x.pdf" "$JWT_B" application/pdf)"

echo ""
echo "=== BLOQUE 6 — anon ==="
eval "$(npx supabase status -o json 2>/dev/null | python -c "import json,sys;print('ANON=%s'%json.load(sys.stdin)['ANON_KEY'])")"
check "anon descarga el estudio de A"                 '^(400|401|403|404)$' "$(code_get documentos-medicos "$P_A/2026/subido-por-b.pdf" "$ANON")"
check "anon sube al prefijo de A"                     '^(400|401|403)$' "$(code_post documentos-medicos "$P_A/2026/anon.pdf" "$ANON" application/pdf)"

echo ""
printf '=== TOTAL: %s PASS / %s FAIL ===\n' "$OK" "$FAIL"

# limpieza
for o in "$P_A/2026/subido-por-b.pdf" "$P_A/2026/estudio.pdf"; do
  curl -s -o /dev/null -X DELETE "$ST/object/documentos-medicos/$o" -H "Authorization: Bearer $SERVICE_KEY"
done
curl -s -o /dev/null -X DELETE "$ST/object/credenciales-cobertura/$P_A/tarjeta/front.jpg" -H "Authorization: Bearer $SERVICE_KEY"
curl -s -o /dev/null -X DELETE "$ST/object/avatares/$OBJ_AVA" -H "Authorization: Bearer $SERVICE_KEY"
$PSQL -c "delete from public.profiles where id in ('$P_A','$P_B'); delete from auth.users where id in ('$U_A','$U_B');" >/dev/null
rm -f "$ARCH"
[ "$FAIL" -eq 0 ]
