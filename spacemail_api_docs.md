# Documentación de la API Interna de Spacemail

Este documento detalla los endpoints internos utilizados por la interfaz web de Spacemail (`https://www.spacemail.com/gateway/api/v1/`) para configurar y gestionar las opciones del buzón de correo.

Todos los endpoints listados aquí utilizan el método **POST**. Requieren autenticación mediante las cookies y tokens de sesión de Spacemail.

## 1. Gestión del Perfil y Cuenta

### `setdisplayname`
Actualiza el nombre para mostrar del usuario en los correos enviados.
- **URL:** `/mailcore/setdisplayname`
- **Payload:**
```json
{
  "displayName": "Nombre Apellido"
}
```

### `setAvatar`
Actualiza la imagen de perfil del usuario.
- **URL:** `/emailassets/setAvatar`
- **Payload:**
```json
{
  "url": "https://s3.us-west-2.amazonaws.com/... (URL pre-firmada obtenida previamente)"
}
```

### `deleteAvatar`
Elimina la imagen de perfil actual.
- **URL:** `/emailassets/deleteAvatar`
- **Payload:** `{}` (Vacío)

---

## 2. Gestión de Firmas (Signatures)

### `createsignature`
Crea una nueva firma vacía para ser editada posteriormente.
- **URL:** `/mailcore/createsignature`
- **Payload:**
```json
{
  "title": "Nombre de la Firma"
}
```

### `editsignature`
Modifica el contenido, título o estado por defecto de una firma existente.
- **URL:** `/mailcore/editsignature`
- **Payload:**
```json
{
  "id": 589317,
  "title": "Nombre de la Firma",
  "body": "<div style=\"font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt;\">Contenido HTML de la firma</div>",
  "isDefault": false,
  "date": "2026-03-19T02:32:12.226197Z"
}
```

### `deletesignature`
Elimina una firma por su ID.
- **URL:** `/mailcore/deletesignature`
- **Payload:**
```json
{
  "id": 589317
}
```

---

## 3. Respuesta Automática (Auto-Responder)

### `setautoreply`
Configura y activa/desactiva la respuesta automática (Mensaje de vacaciones).
- **URL:** `/mailcore/setautoreply`
- **Payload:**
```json
{
  "autoReply": {
    "subject": "Prueba automatica",
    "messageBody": "Mensaje automatico",
    "isActive": false,
    "dateStart": "2026-03-19T02:31:00.000Z",
    "dateEnd": "2026-03-20T02:31:00.000Z"
  }
}
```

---

## 4. Reglas de Filtrado (Filters)

### `createFilterRule`
Crea una nueva regla para filtrar correos entrantes.
- **URL:** `/mailcore/createFilterRule`
- **Payload (Ejemplo: Mover a 'Drafts' si contiene 'eficell'):**
```json
{
  "id": -1,
  "name": "hola",
  "order": 1,
  "isActive": true,
  "processSubsequent": false,
  "expression": {
    "id": -1,
    "ruleId": -1,
    "parentExpression": null,
    "operator": 1,
    "conditions": [
      {
        "id": -1,
        "expressionId": -1,
        "mailProperty": 0,
        "operator": 0,
        "args": ["eficell"]
      }
    ]
  },
  "actions": [
    {
      "id": -1,
      "ruleId": -1,
      "type": 0,
      "args": ["Drafts"]
    }
  ]
}
```

### `updateFilterRule`
Actualiza una regla de filtrado existente (requiere los IDs reales asignados al crearla).
- **URL:** `/mailcore/updateFilterRule`
- **Payload:** *Similar a `createFilterRule` pero con `id` válidos mayores a -1.*

### `deleteFilterRules`
Elimina un array de reglas de filtrado.
- **URL:** `/mailcore/deleteFilterRules`
- **Payload:** `[ { ... objeto completo de la regla a eliminar ... } ]`

---

## 5. Reenvío de Correos (Forwarding)

### `addForwardingAddress`
Añade una dirección de correo para reenvío automático.
- **URL:** `/mailcore/addForwardingAddress`
- **Payload:**
```json
{
  "forwardToAddress": "correo@destino.com"
}
```

### `editForwardingSettings`
Habilita/deshabilita el reenvío y decide si se mantiene una copia local.
- **URL:** `/mailcore/editForwardingSettings`
- **Payload:**
```json
{
  "address": "correo@destino.com",
  "isEnabled": false,
  "keepEmailCopy": false
}
```

### `deleteForwarding`
Elimina la configuración de reenvío actual.
- **URL:** `/mailcore/deleteForwarding`
- **Payload:** `{}` (Vacío)

---

## 6. Gestión de Carpetas

### `createfolder`
Crea una nueva carpeta (buzón) en la jerarquía.
- **URL:** `/mailcore/createfolder`
- **Payload:**
```json
{
  "path": "INBOX/subc",
  "name": "nombre de la carpeta"
}
```

### `renamefolder`
Renombra una carpeta existente.
- **URL:** `/mailcore/renamefolder`
- **Payload:**
```json
{
  "fullName": "INBOX/subcarpeta antigua",
  "newFolderName": "renombrado subcarpeta"
}
```

### `movefolder`
Mueve una carpeta dentro de otra.
- **URL:** `/mailcore/movefolder`
- **Payload:**
```json
{
  "folderFullName": "INBOX/subc/sub de la sub",
  "targetLocation": "Trash"
}
```

---

## 7. Gestión de Correos Individuales

### `movetofolder`
Mueve uno o varios correos a una carpeta específica.
- **URL:** `/mailcore/movetofolder`
- **Payload:**
```json
{
  "folderFullName": "Sent",
  "destinationFolderFullName": "Trash",
  "selection": {
    "messagesIds": [4],
    "type": "Specific"
  }
}
```

### `removemessagesflags`
Elimina marcas (flags) de un correo, por ejemplo, marcar como no leído.
- **URL:** `/mailcore/removemessagesflags`
- **Payload:**
```json
{
  "folderFullName": "INBOX",
  "flags": 4,
  "selection": {
    "type": "Specific",
    "messagesIds": [4]
  }
}
```

### `deletemessage`
Elimina permanentemente un correo.
- **URL:** `/mailcore/deletemessage`
- **Payload:**
```json
{
  "folderFullName": "Trash",
  "selection": {
    "messagesIds": [2],
    "type": "Specific"
  }
}
```
