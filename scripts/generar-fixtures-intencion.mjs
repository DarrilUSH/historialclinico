#!/usr/bin/env node
/**
 * Genera los PDF sintéticos con los que se mide el CLASIFICADOR DE INTENCIÓN
 * (Sprint 20 — "una foto, el lugar correcto").
 *
 * Los consume `scripts/test-clasificador-intencion.mjs`, que los manda a Gemini
 * DE VERDAD y reporta la tasa de acierto.
 *
 * ## Por qué se generan acá y no se guardan fotos
 *
 * Los casos que motivaron el sprint son papeles de personas reales -la lista de
 * remedios del padre del dueño, la captura de la agenda de su clínica-, y no
 * pueden entrar al repositorio: son datos de salud de alguien
 * (`docs/minimizacion-datos.md`). Se reconstruye el CONTENIDO -los mismos
 * medicamentos, los mismos dos turnos, las mismas fechas- en documentos
 * inventados, con este generador a la vista para que se pueda auditar qué se le
 * está mostrando al modelo.
 *
 * ## Qué NO prueban estos PDF, dicho de frente
 *
 * Son texto tipografiado, no fotos. Miden si el modelo, LEYENDO el contenido,
 * clasifica bien la intención. NO miden la lectura de letra manuscrita ni la
 * calidad de una foto torcida con poca luz: eso solo se mide con el teléfono en
 * la mano, y queda anotado como deuda del sprint. La distinción importa para no
 * leer la tasa de acierto como más de lo que es.
 *
 * PDF mínimo (1.4), una página, Helvetica, sin comprimir: no hace falta ninguna
 * dependencia y el archivo se puede abrir con un editor de texto para ver qué
 * dice.
 *
 * Uso:
 *   node scripts/generar-fixtures-intencion.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'documentos-intencion');

/** Escapa lo que un literal de cadena PDF no admite crudo. */
function escaparPdf(texto) {
  return texto.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** PDF de una página con `lineas` de texto, en Helvetica 11. */
function armarPdf(lineas) {
  const contenido =
    'BT\n/F1 11 Tf\n50 790 Td\n15 TL\n' +
    lineas.map((linea) => `(${escaparPdf(linea)}) Tj T*\n`).join('') +
    'ET';

  const objetos = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(contenido, 'latin1')}>>\nstream\n${contenido}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
  ];

  let pdf = '%PDF-1.4\n';
  const posiciones = [];
  objetos.forEach((cuerpo, indice) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${indice + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });

  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const posicion of posiciones) {
    pdf += `${String(posicion).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/**
 * Los ocho casos. Cada uno reconstruye una situación REAL descrita por quien
 * usa la aplicación, o un control que tiene que seguir comportándose como
 * siempre.
 */
const CASOS = [
  {
    archivo: 'receta-manuscrita-tres-remedios.pdf',
    lineas: [
      'Lo que tomo',
      '',
      'COVERAM 5/5   perindopril/amlodipina',
      'LIPOMAX 105   acido fenofibrico',
      'ROSUVASTATINA 10',
    ],
  },
  {
    archivo: 'receta-con-dosis-y-frecuencia.pdf',
    lineas: [
      'CONSULTORIOS DEL PARQUE',
      'Dr. Alberto Sanchez  (MP 8871)   -   Clinica medica',
      '',
      'RECETA',
      'Fecha: 14/08/2026',
      '',
      'Rp/',
      '  1) Losartan 50 mg .......... 1 comprimido por dia, a la manana',
      '  2) Metformina 850 mg ....... 1 comprimido cada 12 horas, con las comidas',
      '  3) Vitamina D3 gotas ....... 8 gotas por dia',
      '',
      'Control en 60 dias.',
      'Firma y sello',
    ],
  },
  {
    archivo: 'agenda-dos-turnos-confirmados.pdf',
    lineas: [
      'Mis turnos - Sanatorio del Norte',
      'Proximos turnos confirmados',
      '',
      'ECO-STRESS',
      'Lunes 22/09/2026  -  18:00 hs   (duracion 30 min)',
      'C.M. Vicente Lopez - Av. Maipu 1444',
      'Estado: CONFIRMADO',
      '',
      'CONSULTA - ROZANEC JOSE JUAN',
      'Miercoles 24/09/2026  -  13:00 hs',
      'Sede Central - Perdriel 74',
      'Estado: CONFIRMADO',
      '',
      'Presentarse 15 minutos antes con documento y credencial.',
    ],
  },
  {
    archivo: 'turno-comprobante-unico.pdf',
    lineas: [
      'CENTRO DE DIAGNOSTICO DEL SUR',
      'COMPROBANTE DE TURNO',
      '',
      'Practica: Resonancia magnetica de rodilla derecha',
      'Fecha: 05/10/2026    Hora: 09:15',
      'Lugar: Sede Belgrano - Av. Cabildo 2230, piso 3',
      '',
      'Concurrir en ayunas de 4 horas. Traer estudios previos.',
      'Este comprobante no es un informe medico.',
    ],
  },
  {
    archivo: 'orden-de-practica.pdf',
    lineas: [
      'HOSPITAL ZONAL - SERVICIO DE CARDIOLOGIA',
      '',
      'ORDEN DE PRACTICA',
      'Fecha de emision: 20/08/2026',
      '',
      'Se solicita: ECOCARDIOGRAMA DOPPLER COLOR',
      'Diagnostico presuntivo: soplo sistolico a estudiar',
      '',
      'Solicita: Dra. Marta Iriarte  (MP 12345)',
      '',
      'Presentar esta orden al sacar el turno. Valida por 90 dias.',
    ],
  },
  {
    archivo: 'estudio-laboratorio.pdf',
    lineas: [
      'LABORATORIO BIOQUIMICO CENTRAL',
      'N de Orden: 1683737',
      'Fecha: 12/08/2026',
      '',
      'ANALISIS DE SANGRE - RESULTADOS',
      '',
      'Glucemia en ayunas ........ 96 mg/dl      (70 - 110)',
      'Colesterol total .......... 212 mg/dl     (hasta 200)',
      'Trigliceridos ............. 158 mg/dl     (hasta 150)',
      'TSH ....................... 2.10 uUI/ml   (0.40 - 4.00)',
      'VDRL ...................... No Reactivo',
      '',
      'Bioquimico responsable: Dr. Luis Peralta',
    ],
  },
  {
    archivo: 'estudio-ecografia.pdf',
    lineas: [
      'DIAGNOSTICO POR IMAGENES DEL LITORAL',
      'Fecha: 03/08/2026',
      '',
      'ECOGRAFIA ABDOMINAL - INFORME',
      '',
      'Higado de tamano y ecoestructura conservados, sin lesiones focales.',
      'Vesicula biliar alitiasica, de paredes finas.',
      'Rinones de tamano normal, sin dilatacion de la via excretora.',
      'Bazo y pancreas sin particularidades.',
      '',
      'CONCLUSION: examen dentro de limites normales.',
      '',
      'Dr. Ramon Vidal  (MN 44210)',
    ],
  },
  {
    archivo: 'estudio-epicrisis.pdf',
    lineas: [
      'CLINICA SAN MARTIN - INTERNACION',
      'Fecha de egreso: 28/07/2026',
      '',
      'EPICRISIS',
      '',
      'Paciente que ingresa por dolor abdominal en hipocondrio derecho de',
      '48 horas de evolucion. Se realiza ecografia que evidencia litiasis',
      'vesicular. Se efectua colecistectomia laparoscopica sin complicaciones.',
      'Evoluciona favorablemente, afebril, tolerando dieta.',
      '',
      'Se otorga el alta con indicaciones de control por consultorio externo.',
      '',
      'Dr. Federico Alonso  (MP 7712) - Cirugia general',
    ],
  },
];

mkdirSync(DIR, { recursive: true });
for (const caso of CASOS) {
  const destino = path.join(DIR, caso.archivo);
  writeFileSync(destino, armarPdf(caso.lineas));
  console.log(`  escrito  ${caso.archivo}`);
}
console.log(`\n${CASOS.length} PDF sintéticos en tests/fixtures/documentos-intencion/`);
