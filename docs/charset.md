# Auditoría de Charset UTF-8 — Repositorio Historial Médico

**Fecha:** 2026-08-12  
**Proyecto:** Historial Médico (Next.js 16)  
**Rama:** main  
**Estado:** ✅ CONFORME

## Resultados de la Auditoría

| Métrica | Resultado |
|---------|-----------|
| Archivos escaneados | 32 |
| Archivos con problemas | 0 |
| Archivos con BOM UTF-8 | 0 |
| Archivos no-UTF-8 válido | 0 |
| Secuencias de mojibake detectadas | 0 |

**Conclusión:** Todos los archivos de texto trackeados por git están correctamente codificados en UTF-8 sin BOM.

## Tipos de archivo verificados

Las extensiones consideradas como texto son:

- **Código:** `js`, `jsx`, `ts`, `tsx`, `css`, `html`, `json`, `mjs`, `sql`
- **Configuración:** `yml`, `yaml`, `toml`, `example`, `local`
- **Documentación:** `md`
- **Especiales:** `txt`, `.env.local`, `.gitignore`, `.gitattributes`

Los archivos binarios (`ico`, `png`, `jpg`, `svg`, `webp`, `woff2`) se saltearon automáticamente.

## Procedimiento para Re-correr la Auditoría

Para verificar el charset nuevamente en el futuro:

```bash
# Opción 1: Usar el script de auditoría
node docs/../.charset_check.js .

# Opción 2: Buscar manualmente archivos sospechosos
# Archivos con BOM UTF-8
hexdump -C archivo.js | head -1 | grep "ef bb bf"

# Archivos con encoding inválido (Linux/Mac/WSL)
file -i archivo.js | grep -v "charset=utf-8"
```

## Reglas para Windows / PowerShell

**CRÍTICO:** Al editar o crear archivos en Windows con PowerShell, el encoding predeterminado es **UTF-16 LE con BOM**, que rompe parsers. Siempre forzar UTF-8:

### Opción A: Herramienta `Write` de Claude Code (recomendado)
```bash
# Usa automáticamente UTF-8 sin BOM
Write "archivo.md"
```

### Opción B: PowerShell 5.1 (Windows 11 built-in)
```powershell
# Fuerza UTF-8 sin BOM (CRÍTICO: usar UTF8Encoding($false))
[System.IO.File]::WriteAllText(
  "C:\ruta\archivo.md",
  $contenido,
  (New-Object System.Text.UTF8Encoding $false)
)

# NUNCA hacer esto (genera BOM):
$contenido | Out-File "archivo.md"
$contenido | Out-File -Encoding UTF8 "archivo.md"  # Aún agrega BOM en PS 5.1
```

### Opción C: PowerShell 7+ (si está instalado)
```powershell
# PS 7+ usa UTF-8 sin BOM por defecto
$contenido | Out-File -Encoding utf8NoBOM "archivo.md"
```

### Opción D: Git Bash / WSL
```bash
# Bash siempre respeta UTF-8
echo "contenido" > archivo.md
```

## Regla de Oro

**Después de crear o editar cualquier archivo de texto**, verificar:

```bash
# Debe mostrar UTF-8 (SIN "BOM")
file -i archivo.md

# Debe salir vacío (SIN salida de BOM)
hexdump -C archivo.md | grep "ef bb bf" || echo "OK (sin BOM)"
```

## Referencias

- **Configuración MySQL/MariaDB:** Usar `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` en todas las tablas.
- **Conexión PHP PDO:** `mysql:host=...;charset=utf8mb4`
- **Configuración servidor:** Apache `AddDefaultCharset utf-8`; Nginx `charset utf-8;`
- **HTML:** `<meta charset="utf-8">` (siempre en el primer elemento del `<head>`).
