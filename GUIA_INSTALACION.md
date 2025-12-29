# Guía de Instalación - Replica WhatsApp Web

Esta guía te ayudará a instalar y ejecutar el proyecto en una nueva computadora.

## Prerrequisitos

Antes de comenzar, asegúrate de tener instalado lo siguiente:

1.  **Node.js**: Descarga e instala la versión LTS desde [nodejs.org](https://nodejs.org/).
2.  **Git**: Descarga e instala Git desde [git-scm.com](https://git-scm.com/).
3.  **Cuenta de Supabase**: Necesitarás una cuenta en [supabase.com](https://supabase.com/) y un proyecto creado.

## Pasos de Instalación

### 1. Clonar o Copiar el Proyecto

Si tienes el proyecto en un repositorio Git:
```bash
git clone <URL_DEL_REPOSITORIO>
cd ReplicaWhatsappWeb
```

Si tienes el código fuente en una carpeta, simplemente abre una terminal en esa carpeta.

### 2. Instalar Dependencias

Ejecuta el siguiente comando en la terminal para instalar las librerías necesarias:

```bash
npm install
```

### 3. Configurar Variables de Entorno

1.  Crea una copia del archivo `.env.example` y renómbralo a `.env`.
    *   En Windows (PowerShell): `cp .env.example .env`
    *   O simplemente crea un nuevo archivo llamado `.env`.
2.  Abre el archivo `.env` con un editor de texto.
3.  Rellena las siguientes variables con los datos de tu proyecto de Supabase:

```env
SUPABASE_URL=tu_url_de_supabase
SUPABASE_KEY=tu_clave_anonima_de_supabase
```

> **Nota:** Puedes encontrar estos datos en el dashboard de Supabase: `Project Settings` -> `API`.

### 4. Configurar la Base de Datos

Si es una instalación nueva, necesitarás crear las tablas en Supabase. Puedes usar el editor SQL de Supabase para ejecutar los scripts de creación de tablas que se encuentran en el proyecto (por ejemplo, `schema.sql` si existe, o basándote en la estructura requerida por la aplicación).

*Revisa los archivos `.sql` en la raíz del proyecto para ver la estructura necesaria.*

### 5. Ejecutar el Proyecto

Para iniciar el servidor, ejecuta:

```bash
npm start
```

Deberías ver un mensaje indicando que el servidor está corriendo, por ejemplo:
`Server running at http://localhost:3000`

### 6. Usar la Aplicación

1.  Abre tu navegador y ve a `http://localhost:3000`.
2.  Verás un código QR.
3.  Abre WhatsApp en tu teléfono, ve a "Dispositivos vinculados" y escanea el código QR.
4.  La sesión se iniciará y podrás ver tus chats.

## Solución de Problemas Comunes

*   **Error de conexión a Supabase**: Verifica que `SUPABASE_URL` y `SUPABASE_KEY` en el archivo `.env` sean correctos.
*   **Puppeteer/Chromium error**: La librería `whatsapp-web.js` usa un navegador Chromium. Si falla al descargarse, intenta ejecutar `npm install` de nuevo o revisa la documentación de `whatsapp-web.js`.
*   **Puerto ocupado**: Si el puerto 3000 está en uso, puedes cambiarlo en el archivo `server.js` o detener el proceso que lo está usando.
