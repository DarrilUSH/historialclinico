/**
 * Test de la lectura PURA de un mensaje de Gmail (`lib/gmail/mensaje.ts`,
 * Sprint 17, tarea 17.2).
 *
 * Sin red y sin mocks: se arman payloads con la MISMA forma que devuelve
 * `users.messages.get?format=full` y se comprueba qué sale. Los casos no son
 * inventados por simetría: cada uno es una forma real de correo médico
 * argentino -el PDF declarado como `octet-stream`, el aviso que llega solo en
 * HTML, el logo de la firma que parece un adjunto, el estudio de 40 MB-.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  MAX_CUERPO,
  decodificarParte,
  extraerCuerpoTexto,
  htmlATexto,
  nombreSeguroDeAdjunto,
  parsearMensajeGmail,
  parsearRemitente,
  recolectarAdjuntos,
  resolverMimeAdjunto,
} from "@/lib/gmail/mensaje"

/** Codifica como lo hace Gmail: base64url. */
function b64(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url")
}

function encabezados(pares: Record<string, string>) {
  return Object.entries(pares).map(([name, value]) => ({ name, value }))
}

describe("parsearRemitente", () => {
  it("separa nombre y dirección en el formato con comillas", () => {
    expect(parsearRemitente('"Clínica San Jorge" <turnos@sanjorge.com.ar>')).toEqual({
      nombre: "Clínica San Jorge",
      email: "turnos@sanjorge.com.ar",
    })
  })

  it("funciona sin comillas y normaliza la dirección a minúsculas", () => {
    expect(parsearRemitente("Laboratorio Austral <Resultados@Lab-Austral.COM.AR>")).toEqual({
      nombre: "Laboratorio Austral",
      email: "resultados@lab-austral.com.ar",
    })
  })

  it("acepta la dirección pelada, sin nombre", () => {
    expect(parsearRemitente("turnos@hospital.gob.ar")).toEqual({
      nombre: null,
      email: "turnos@hospital.gob.ar",
    })
  })

  it("un header vacío no inventa un remitente", () => {
    expect(parsearRemitente("   ")).toEqual({ nombre: null, email: "" })
  })
})

describe("decodificarParte", () => {
  it("decodifica base64url (con - y _, que romperían un base64 común)", () => {
    // Se busca a propósito un texto cuyo base64 traiga los dos caracteres que
    // base64url reemplaza.
    const original = "Turno confirmado: ¿podés venir el 14/7 a las 9:45? ~~~???"
    expect(decodificarParte(b64(original), "text/plain; charset=UTF-8")).toBe(original)
  })

  it("respeta el charset declarado: un aviso en ISO-8859-1 conserva las tildes", () => {
    // Este es el caso que rompe de verdad: bytes latin1 leídos como UTF-8
    // convierten "Cardiología" en un rombo justo antes de mandárselo a la IA.
    const bytes = Buffer.from("Turno de Cardiología con el Dr. Fernández", "latin1")
    const dato = bytes.toString("base64url")

    expect(decodificarParte(dato, 'text/plain; charset="ISO-8859-1"')).toBe(
      "Turno de Cardiología con el Dr. Fernández",
    )
    // Sin el charset, los mismos bytes se leen mal: es lo que se está evitando.
    expect(decodificarParte(dato, "text/plain")).not.toContain("Cardiología")
  })

  it("una etiqueta de charset inventada cae a UTF-8 en vez de romper", () => {
    expect(decodificarParte(b64("hola"), "text/plain; charset=marciano-9")).toBe("hola")
  })

  it("datos vacíos devuelven cadena vacía", () => {
    expect(decodificarParte("", "text/plain")).toBe("")
  })
})

describe("htmlATexto", () => {
  it("tira estilos y scripts enteros", () => {
    const html = "<style>.x{color:red}</style><p>Turno el 14/7</p><script>alert(1)</script>"
    const texto = htmlATexto(html)
    expect(texto).toContain("Turno el 14/7")
    expect(texto).not.toContain("color:red")
    expect(texto).not.toContain("alert")
  })

  it("convierte los cortes de bloque en saltos, para no pegar dos datos distintos", () => {
    const texto = htmlATexto("<div>Dr. Gómez</div><div>Martes 14/7</div>")
    expect(texto).toBe("Dr. Gómez\nMartes 14/7")
    expect(texto).not.toContain("GómezMartes")
  })

  it("traduce las entidades más comunes", () => {
    expect(htmlATexto("<p>Turno &amp; estudio &#8212; 9&nbsp;hs &lt;importante&gt;</p>")).toBe(
      "Turno & estudio — 9 hs <importante>",
    )
  })
})

describe("extraerCuerpoTexto", () => {
  it("prefiere text/plain cuando el correo trae las dos versiones", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain; charset=UTF-8", body: { data: b64("Version en texto") } },
        { mimeType: "text/html; charset=UTF-8", body: { data: b64("<p>Version en HTML</p>") } },
      ],
    }
    expect(extraerCuerpoTexto(payload)).toBe("Version en texto")
  })

  it("desarma el HTML cuando es lo único que hay", () => {
    const payload = {
      mimeType: "text/html; charset=UTF-8",
      body: { data: b64("<p>Su turno es el <b>14/07/2026</b></p>") },
    }
    expect(extraerCuerpoTexto(payload)).toBe("Su turno es el 14/07/2026")
  })

  it("ignora un .txt ADJUNTO: una parte con attachmentId es un archivo, no el cuerpo", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("El cuerpo de verdad") } },
        {
          mimeType: "text/plain",
          filename: "instrucciones.txt",
          body: { data: b64("ESTO ES UN ADJUNTO"), attachmentId: "ATT_1", size: 20 },
        },
      ],
    }
    expect(extraerCuerpoTexto(payload)).toBe("El cuerpo de verdad")
  })

  it("recorta al tope para no arrastrar la firma corporativa entera", () => {
    const payload = {
      mimeType: "text/plain",
      body: { data: b64("x".repeat(MAX_CUERPO + 500)) },
    }
    expect(extraerCuerpoTexto(payload)).toHaveLength(MAX_CUERPO)
  })

  it("un payload vacío no explota", () => {
    expect(extraerCuerpoTexto(null)).toBe("")
    expect(extraerCuerpoTexto({})).toBe("")
  })
})

describe("resolverMimeAdjunto", () => {
  it("acepta los cuatro tipos del pipeline", () => {
    expect(resolverMimeAdjunto("application/pdf", "orden.pdf")).toBe("application/pdf")
    expect(resolverMimeAdjunto("image/jpeg", "foto.jpg")).toBe("image/jpeg")
    expect(resolverMimeAdjunto("image/png", "foto.png")).toBe("image/png")
    expect(resolverMimeAdjunto("image/webp", "foto.webp")).toBe("image/webp")
  })

  it("deduce por extensión cuando la clínica manda octet-stream", () => {
    expect(resolverMimeAdjunto("application/octet-stream", "resultado.PDF")).toBe("application/pdf")
  })

  it("no inventa un tipo para lo que no se puede leer", () => {
    expect(resolverMimeAdjunto("application/msword", "informe.doc")).toBeNull()
    expect(resolverMimeAdjunto("application/zip", "todo.zip")).toBeNull()
  })
})

describe("recolectarAdjuntos", () => {
  it("describe un PDF normal como apto, sin bajar un solo byte", () => {
    const adjuntos = recolectarAdjuntos({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("hola") } },
        {
          mimeType: "application/pdf",
          filename: "analisis.pdf",
          body: { attachmentId: "ATT_9", size: 51234 },
        },
      ],
    })

    expect(adjuntos).toHaveLength(1)
    expect(adjuntos[0]).toMatchObject({
      attachmentId: "ATT_9",
      filename: "analisis.pdf",
      mimeType: "application/pdf",
      size: 51234,
      apto: true,
      motivo: null,
    })
  })

  it("marca el adjunto gigante como no apto, pero lo deja listado con su motivo", () => {
    // La pantalla tiene que poder explicar por qué un archivo que la persona VE
    // en su correo no se ofrece para importar.
    const adjuntos = recolectarAdjuntos({
      parts: [
        {
          mimeType: "application/pdf",
          filename: "resonancia.pdf",
          body: { attachmentId: "ATT_BIG", size: 40 * 1024 * 1024 },
        },
      ],
    })

    expect(adjuntos[0].apto).toBe(false)
    expect(adjuntos[0].motivo).toBe("demasiado_grande")
    expect(adjuntos[0].filename).toBe("resonancia.pdf")
  })

  it("marca como no apto lo que no se puede leer (un .docx)", () => {
    const adjuntos = recolectarAdjuntos({
      parts: [
        {
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filename: "informe.docx",
          body: { attachmentId: "ATT_D", size: 3000 },
        },
      ],
    })

    expect(adjuntos[0].apto).toBe(false)
    expect(adjuntos[0].motivo).toBe("tipo_no_soportado")
  })

  it("descarta el logo incrustado de la firma (Content-ID + inline)", () => {
    const adjuntos = recolectarAdjuntos({
      parts: [
        {
          mimeType: "image/png",
          filename: "logo.png",
          headers: encabezados({
            "Content-ID": "<logo123>",
            "Content-Disposition": "inline; filename=logo.png",
          }),
          body: { attachmentId: "ATT_LOGO", size: 4096 },
        },
        {
          mimeType: "image/jpeg",
          filename: "radiografia.jpg",
          body: { attachmentId: "ATT_RX", size: 900000 },
        },
      ],
    })

    expect(adjuntos.map((adjunto) => adjunto.filename)).toEqual(["radiografia.jpg"])
  })

  it("una imagen con Content-ID pero adjunta de verdad NO se descarta", () => {
    // Hacen falta las DOS señales: hay clientes que le ponen Content-ID a todo.
    const adjuntos = recolectarAdjuntos({
      parts: [
        {
          mimeType: "image/jpeg",
          filename: "ecografia.jpg",
          headers: encabezados({
            "Content-ID": "<algo>",
            "Content-Disposition": "attachment; filename=ecografia.jpg",
          }),
          body: { attachmentId: "ATT_ECO", size: 120000 },
        },
      ],
    })

    expect(adjuntos).toHaveLength(1)
    expect(adjuntos[0].apto).toBe(true)
  })

  it("recorre las partes anidadas (multipart/mixed con un alternative adentro)", () => {
    const adjuntos = recolectarAdjuntos({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64("hola") } },
            { mimeType: "text/html", body: { data: b64("<p>hola</p>") } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "orden.pdf",
          body: { attachmentId: "ATT_ANIDADO", size: 1000 },
        },
      ],
    })

    expect(adjuntos.map((adjunto) => adjunto.attachmentId)).toEqual(["ATT_ANIDADO"])
  })
})

describe("parsearMensajeGmail", () => {
  it("arma el mensaje completo a partir del JSON de la API", () => {
    const mensaje = parsearMensajeGmail({
      id: "18f2abc",
      threadId: "18f2abc",
      snippet: "esto es cuerpo y se ignora",
      internalDate: "1786000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: encabezados({
          From: '"Clínica San Jorge" <turnos@sanjorge.com.ar>',
          Subject: "Resultado de su análisis",
          Date: "Tue, 14 Jul 2026 09:45:00 -0300",
        }),
        parts: [
          { mimeType: "text/plain", body: { data: b64("Adjuntamos el resultado.") } },
          {
            mimeType: "application/pdf",
            filename: "resultado.pdf",
            body: { attachmentId: "ATT_1", size: 22000 },
          },
        ],
      },
    })

    expect(mensaje).not.toBeNull()
    expect(mensaje?.id).toBe("18f2abc")
    expect(mensaje?.remitenteEmail).toBe("turnos@sanjorge.com.ar")
    expect(mensaje?.remitenteNombre).toBe("Clínica San Jorge")
    expect(mensaje?.asunto).toBe("Resultado de su análisis")
    expect(mensaje?.fechaIso).toBe(new Date(1786000000000).toISOString())
    expect(mensaje?.adjuntos).toHaveLength(1)
    expect(mensaje?.cuerpoTexto).toBe("Adjuntamos el resultado.")
  })

  it("un mensaje sin id no se puede registrar: devuelve null", () => {
    expect(parsearMensajeGmail({ payload: {} })).toBeNull()
    expect(parsearMensajeGmail(null)).toBeNull()
  })

  it("sin asunto ni fecha no inventa nada", () => {
    const mensaje = parsearMensajeGmail({
      id: "x1",
      payload: { headers: encabezados({ From: "a@b.com" }) },
    })
    expect(mensaje?.asunto).toBeNull()
    expect(mensaje?.fechaIso).toBeNull()
  })

  it("encuentra los headers sin importar las mayúsculas", () => {
    const mensaje = parsearMensajeGmail({
      id: "x2",
      payload: { headers: encabezados({ FROM: "a@b.com", subject: "Turno" }) },
    })
    expect(mensaje?.remitenteEmail).toBe("a@b.com")
    expect(mensaje?.asunto).toBe("Turno")
  })
})

describe("nombreSeguroDeAdjunto", () => {
  it("saca separadores de directorio del nombre", () => {
    expect(nombreSeguroDeAdjunto("../../etc/passwd.pdf", "application/pdf")).not.toContain("/")
  })

  it("cae a un nombre genérico cuando no queda nada usable", () => {
    expect(nombreSeguroDeAdjunto("   ", "image/png")).toBe("adjunto.png")
  })

  it("conserva un nombre normal tal cual", () => {
    expect(nombreSeguroDeAdjunto("Análisis de sangre.pdf", "application/pdf")).toBe(
      "Análisis de sangre.pdf",
    )
  })

  it("acota el largo", () => {
    expect(nombreSeguroDeAdjunto(`${"a".repeat(400)}.pdf`, "application/pdf").length).toBe(120)
  })
})
