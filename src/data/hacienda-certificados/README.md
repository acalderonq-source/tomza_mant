# Certificado de confianza SINPE

`sinpe-pj-2023.pem` contiene únicamente el certificado público de CA SINPE Persona Jurídica v2 (enero 2023–enero 2031), distribuido por el BCCR. No contiene claves privadas.

Fuente oficial: https://www.bccr.fi.cr/cr/es/firma-digital/informacion-general/certificados-y-listas-de-revocacion.html

Archivo publicado: http://fdi.sinpe.fi.cr/repositorio/CA%20SINPE%20-%20PERSONA%20JURIDICA%20v2(2).crt

Huella SHA256: `0C:D3:51:22:DA:67:1B:8E:89:6B:B1:46:53:25:6F:D8:84:52:81:2B:56:C6:B4:07:7A:3C:2B:77:C1:60:18:79`.

Las respuestas recibidas por correo se verifican con el certificado firmante contenido en XML, cuya firma debe validar contra esta CA y cuya identidad debe corresponder al Ministerio de Hacienda. Se verifica también la firma del XML completo y una CRL vigente firmada por esta CA; no se confía en el certificado aportado por el correo por sí solo. La CRL se descarga de una URL fija publicada por el BCCR y se conserva en memoria hasta treinta minutos sin exceder su vencimiento.

La integración reconoce esta jerarquía de producción; una renovación hacia otra CA requiere incorporar su certificado oficial y ajustar la CRL correspondiente. Si no se logra verificar, la factura conserva su estado anterior.
