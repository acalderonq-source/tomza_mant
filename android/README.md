# Tomza Taller Android

Proyecto Android para publicar el sistema Tomza Taller en Google Play.

## Qué genera

- App Android con `WebView` apuntando a `https://tomza-mant.onrender.com/dashboard`.
- Soporte de subida de archivos/fotos desde la app.
- Paquete Android: `com.gastomza.taller`.
- Preparado para generar `.aab`, que es el formato que se sube a Google Play.

## Requisitos

1. Instalar Android Studio.
2. Instalar JDK desde Android Studio o tener Java configurado.
3. Abrir la carpeta `android` con Android Studio.
4. Instalar SDK Android 36 si Android Studio lo pide.

## Cambiar URL si hace falta

Editar:

`android/app/src/main/res/values/strings.xml`

```xml
<string name="app_url">https://tomza-mant.onrender.com/dashboard</string>
```

## Generar para Play Store

En Android Studio:

1. `Build` > `Generate Signed Bundle / APK`.
2. Seleccionar `Android App Bundle`.
3. Crear o seleccionar una llave de firma.
4. Generar release.
5. Subir el archivo `.aab` a Play Console.

## Asset Links opcional

El servidor ya expone `/.well-known/assetlinks.json`.

Cuando tenga la huella SHA-256 de la llave de firma, agregue en el hosting:

```env
ANDROID_PACKAGE_NAME=com.gastomza.taller
ANDROID_SHA256_CERT_FINGERPRINT=AA:BB:CC:...
```

Esto deja listo el dominio para una futura versión con Trusted Web Activity.
