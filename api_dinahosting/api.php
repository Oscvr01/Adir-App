<?php
/**
 * ADIR API — PHP REST wrapper para MySQL en Dinahosting
 * ======================================================
 * Actúa como capa de compatibilidad Supabase → MySQL.
 * Las páginas React NO necesitan cambios:
 *   - Los nombres de tabla son los mismos (propuestas, partidas…)
 *   - Las columnas BC3 se devuelven con sus nombres originales
 *     (Proyecto, id, propuesta_id…) aunque en MySQL se llamen
 *     proyecto_bc3, id_bc3, propuesta_bc3…
 *
 * Subir a:  /public_html/api/api.php
 * Variables de entorno del frontend (Vercel):
 *   VITE_API_URL = https://TU_DOMINIO/api/api.php
 *   VITE_API_KEY = (misma clave que API_KEY aquí)
 */

// ─── Configuración ────────────────────────────────────────────────────────────
define('API_KEY',  '28e9c0b26fbee3225088ab2bd1d889aba39fe2caeee1257700f0ec91184dfa75');
define('DB_HOST',  'hl1607.dinaserver.com');
define('DB_USER',  'adirg_user_bd');   // ver panel Dinahosting → Bases de datos
define('DB_PASS',  'I0qj7n![4.23');
define('DB_NAME',  'adirg_bbdd');
define('PREFIX',   'ctcon_');

// ─── CORS ─────────────────────────────────────────────────────────────────────
$allowedOrigins = [
    'https://adir-app.vercel.app',
    'https://adirgestion.app',
    'http://localhost:5173',   // desarrollo local
    'http://localhost:3000',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://adir-app.vercel.app');
}
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key, Prefer');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Acepta X-Api-Key (React app), apikey (N8N/otros) o apikey como query param
$apiKey = $_SERVER['HTTP_X_API_KEY']
       ?? $_SERVER['HTTP_APIKEY']
       ?? $_GET['apikey']
       ?? '';
if ($apiKey !== API_KEY) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// ─── Conexión ─────────────────────────────────────────────────────────────────
try {
    $pdo = new PDO(
        "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException $e) {
    error_log('[ADIR API] DB connection failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Error de conexión con la base de datos']);
    exit;
}

// ─── Tabla whitelist y mapeo de nombres ───────────────────────────────────────
if (isset($_GET['ping'])) {
    echo json_encode(['pong' => true, 'version' => '2.1_bulk_fix']);
    exit;
}
// Nombre Supabase → tabla MySQL (con prefijo)
$TABLE_MAP = [
    'propuestas'           => PREFIX . 'propuestas',
    'partidas'             => PREFIX . 'partidas',
    'presupuestos_cliente' => PREFIX . 'presupuestos_cliente',
    'proveedores'          => PREFIX . 'proveedores',
    'solicitudes'          => PREFIX . 'solicitudes',
    'respuestas'           => PREFIX . 'respuestas',
    'historial_cambios'    => PREFIX . 'historial_cambios',
    'base_precios_adir'    => PREFIX . 'base_precios_adir',
    'base_precios'         => PREFIX . 'base_precios_adir',  // alias legacy
    'PreciosCype'          => PREFIX . 'precios_cype',
    'configuracion'        => PREFIX . 'configuracion',
];

// ─── Configuración de traducción de columnas por tabla MySQL ──────────────────
//
// col_map:  supabase_col_name  →  mysql_col_name
//           (para filtros, INSERT, PATCH)
//
// reverse:  mysql_col_name  →  supabase_col_name
//           (para renombrar columnas en respuestas GET)
//
// hide_num_id: true → excluir la columna `id` numérica de las respuestas
//              y reemplazarla por el alias definido en reverse
//
$TABLE_CONFIG = [
    PREFIX . 'propuestas' => [
        'col_map'     => ['Proyecto' => 'proyecto_bc3'],
        'reverse'     => ['proyecto_bc3' => 'Proyecto'],
        'hide_num_id' => true,
    ],
    PREFIX . 'partidas' => [
        'col_map'     => ['id' => 'id_bc3', 'propuesta_id' => 'propuesta_bc3'],
        'reverse'     => ['id_bc3' => 'id', 'propuesta_bc3' => 'propuesta_id'],
        'hide_num_id' => true,
    ],
    PREFIX . 'presupuestos_cliente' => [
        'col_map'     => ['id' => 'id_bc3', 'propuesta_id' => 'propuesta_bc3'],
        'reverse'     => ['id_bc3' => 'id', 'propuesta_bc3' => 'propuesta_id'],
        'hide_num_id' => true,
    ],
    PREFIX . 'proveedores' => [
        'col_map'     => ['id' => 'id_bc3'],
        'reverse'     => ['id_bc3' => 'id'],
        'hide_num_id' => true,
    ],
    PREFIX . 'solicitudes' => [
        'col_map'     => ['id' => 'id_bc3', 'propuesta_id' => 'propuesta_bc3'],
        'reverse'     => ['id_bc3' => 'id', 'propuesta_bc3' => 'propuesta_id'],
        'hide_num_id' => true,
    ],
    PREFIX . 'respuestas' => [
        'col_map'     => [
            'id'           => 'id_bc3',
            'solicitud_id' => 'solicitud_bc3',
            'partida_id'   => 'partida_bc3',
            'proveedor_id' => 'proveedor_bc3',
        ],
        'reverse'     => [
            'id_bc3'          => 'id',
            'solicitud_bc3'   => 'solicitud_id',
            'partida_bc3'     => 'partida_id',
            'proveedor_bc3'   => 'proveedor_id',
        ],
        'hide_num_id' => true,
    ],
    PREFIX . 'historial_cambios'  => ['col_map' => [], 'reverse' => [], 'hide_num_id' => false],
    PREFIX . 'base_precios_adir'  => ['col_map' => [], 'reverse' => [], 'hide_num_id' => false],
    PREFIX . 'precios_cype'       => ['col_map' => [], 'reverse' => [], 'hide_num_id' => false],
    PREFIX . 'configuracion'      => ['col_map' => [], 'reverse' => [], 'hide_num_id' => false],
];

// ─── Helpers de traducción ────────────────────────────────────────────────────

/** Traduce un nombre de columna Supabase → MySQL para esta tabla */
function colToMySQL(string $mysqlTable, string $col): string {
    global $TABLE_CONFIG;
    $map = $TABLE_CONFIG[$mysqlTable]['col_map'] ?? [];
    return $map[$col] ?? $col;
}

/**
 * Sanea un identificador (nombre de columna) para poder interpolarlo con
 * seguridad dentro de backticks. PDO no permite parametrizar identificadores,
 * así que eliminamos todo lo que no sea [A-Za-z0-9_]. Los nombres de columna
 * legítimos de este esquema son snake_case alfanuméricos, por lo que esto no
 * altera ninguna consulta válida, pero neutraliza la inyección vía backtick.
 */
function sanitizeIdent(string $ident): string {
    return preg_replace('/[^A-Za-z0-9_]/', '', $ident);
}

/** Traduce un array de columnas para SELECT (devuelve lista SQL con aliases) */
function translateSelectCols(string $mysqlTable, string $selectStr): string {
    global $TABLE_CONFIG;
    $cfg = $TABLE_CONFIG[$mysqlTable] ?? [];
    $colMap  = $cfg['col_map']     ?? [];
    $reverse = $cfg['reverse']     ?? [];
    $hideId  = $cfg['hide_num_id'] ?? false;

    if (trim($selectStr) === '*') {
        // SELECT * pero con aliases para columnas renombradas
        // Excluye la clave numérica si está mapeada
        $aliases = [];
        foreach ($reverse as $mysqlCol => $sbCol) {
            $aliases[] = "`$mysqlCol` AS `$sbCol`";
        }
        if ($hideId) {
            // Seleccionamos todo excepto `id` numérico y las columnas _bc3 que van con alias
            $exclude = array_merge(['id'], array_keys($reverse));
            $excludeStr = implode(', ', array_map(fn($c) => "`$c`", $exclude));
            $base = "* /*!80000 EXCEPT ($excludeStr)*/ "; // MySQL 8+
            // Fallback para MySQL 5.x / MariaDB: usar INFORMATION_SCHEMA
            // Nota: en Dinahosting generalmente es MySQL 5.7/8 o MariaDB 10.x
            // Usamos solución compatible: devolvemos `*` y post-procesamos en PHP
            return '*';   // post-procesado en PHP
        }
        return '*';
    }

    // Columnas específicas
    $cols = array_map('trim', explode(',', $selectStr));
    $sql  = [];
    foreach ($cols as $col) {
        if ($col === '') continue;
        $colClean = preg_replace('/[^a-zA-Z0-9_]/', '', $col);
        $mysqlCol = $colMap[$colClean] ?? $colClean;
        if ($mysqlCol !== $colClean) {
            $sql[] = "`$mysqlCol` AS `$colClean`";
        } else {
            $sql[] = "`$colClean`";
        }
    }
    return implode(', ', $sql) ?: '*';
}

/** Traduce las claves de un array de filtros/body de Supabase → MySQL */
function translateKeys(string $mysqlTable, array $data): array {
    global $TABLE_CONFIG;
    $map = $TABLE_CONFIG[$mysqlTable]['col_map'] ?? [];
    $out = [];
    foreach ($data as $k => $v) {
        $out[$map[$k] ?? $k] = $v;
    }
    return $out;
}

/** Post-procesa una fila: renombra columnas MySQL → Supabase y limpia id numérico */
function postProcessRow(string $mysqlTable, array $row): array {
    global $TABLE_CONFIG;
    $cfg     = $TABLE_CONFIG[$mysqlTable] ?? [];
    $reverse = $cfg['reverse']     ?? [];
    $hideId  = $cfg['hide_num_id'] ?? false;

    // 1. Eliminar el id numérico AUTO_INCREMENT ANTES de renombrar
    //    (así el rename de id_bc3 → id no se borra accidentalmente)
    if ($hideId) {
        unset($row['id']);
    }

    // 2. Renombrar columnas _bc3 / internas → nombres originales Supabase
    //    ej: id_bc3 → id,  propuesta_bc3 → propuesta_id,  proyecto_bc3 → Proyecto
    foreach ($reverse as $mysqlCol => $sbCol) {
        if (array_key_exists($mysqlCol, $row)) {
            $row[$sbCol] = $row[$mysqlCol];
            unset($row[$mysqlCol]);
        }
    }

    // 3. Decodificar JSON en campo partidas (presupuestos_cliente)
    if (isset($row['partidas']) && is_string($row['partidas'])) {
        $decoded = json_decode($row['partidas'], true);
        if (json_last_error() === JSON_ERROR_NONE) {
            $row['partidas'] = $decoded;
        }
    }

    return $row;
}

// ─── Router ──────────────────────────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts  = array_values(array_filter(explode('/', trim($uri, '/'))));

// URL: /api/api.php/TABLA  → último segmento es siempre la tabla
// Funciona tanto con /api/api.php/tabla como con /api/tabla (via .htaccess)
$sbTable = end($parts) ?: '';
$mysqlTable = $TABLE_MAP[$sbTable] ?? '';

if (!$mysqlTable) {
    http_response_code(404);
    echo json_encode(['error' => "Tabla '$sbTable' no encontrada"]);
    exit;
}

$query = $_GET;
$body  = json_decode(file_get_contents('php://input'), true) ?? [];

// ─── Construir WHERE desde filtros Supabase ───────────────────────────────────
function buildWhere(string $mysqlTable, array $params, PDO $pdo): array {
    $allowedOps = [
        'eq'    => '=',
        'neq'   => '!=',
        'gt'    => '>',
        'gte'   => '>=',
        'lt'    => '<',
        'lte'   => '<=',
        'like'  => 'LIKE',
        'ilike' => 'LIKE',   // MySQL LIKE es case-insensitive por defecto
        'in'    => 'IN',
    ];
    $conditions = [];
    $binds = [];

    foreach ($params as $key => $val) {
        if (in_array($key, ['select', 'limit', 'offset', 'order', 'apikey'])) continue;

        // OR expression: ?or=col1.op.val1,col2.op.val2
        if ($key === 'or') {
            $orConds = [];
            $pieces = explode(',', $val);
            foreach ($pieces as $piece) {
                $piece = trim($piece);
                $d1 = strpos($piece, '.');
                if ($d1 === false) continue;
                $col  = substr($piece, 0, $d1);
                $rest = substr($piece, $d1 + 1);
                $d2   = strpos($rest, '.');
                if ($d2 === false) continue;
                $op = substr($rest, 0, $d2);
                $v  = substr($rest, $d2 + 1);
                $mc = sanitizeIdent(colToMySQL($mysqlTable, $col));
                if ($mc === '') continue;
                $sqlOp = $allowedOps[$op] ?? 'LIKE';
                $orConds[] = "`$mc` $sqlOp ?";
                $binds[] = $v;
            }
            if ($orConds) {
                $conditions[] = '(' . implode(' OR ', $orConds) . ')';
            }
            continue;
        }

        $mysqlCol = sanitizeIdent(colToMySQL($mysqlTable, $key));
        if ($mysqlCol === '') continue;

        if (strpos($val, '.') !== false) {
            // NOT prefix: not.op.val
            if (strpos($val, 'not.') === 0) {
                $rest = substr($val, 4);
                $dp   = strpos($rest, '.');
                if ($dp !== false) {
                    $op    = substr($rest, 0, $dp);
                    $v     = substr($rest, $dp + 1);
                    $sqlOp = $allowedOps[$op] ?? '=';
                    $conditions[] = "NOT (`$mysqlCol` $sqlOp ?)";
                    $binds[] = $v;
                }
                continue;
            }

            [$op, $v] = explode('.', $val, 2);
            $sqlOp = $allowedOps[$op] ?? '=';
            if ($op === 'in') {
                $vals = explode(',', trim($v, '()'));
                $phs  = implode(',', array_fill(0, count($vals), '?'));
                $conditions[] = "`$mysqlCol` IN ($phs)";
                foreach ($vals as $iv) $binds[] = trim($iv, '"\'');
            } else {
                $conditions[] = "`$mysqlCol` $sqlOp ?";
                $binds[] = $v;
            }
        } else {
            $conditions[] = "`$mysqlCol` = ?";
            $binds[] = $val;
        }
    }
    return [
        'sql'   => $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '',
        'binds' => $binds,
    ];
}

// ─── Resolver Foreign Keys para mantener compatibilidad con UUIDs / id_bc3 ──────
function resolveForeignKeys(string $mysqlTable, array $data, PDO $pdo): array {
    // 1. Resolver propuesta_id desde propuesta_bc3 (o proyecto_bc3)
    if (isset($data['propuesta_bc3'])) {
        $stmt = $pdo->prepare("SELECT id FROM `ctcon_propuestas` WHERE `proyecto_bc3` = ? LIMIT 1");
        $stmt->execute([$data['propuesta_bc3']]);
        $val = $stmt->fetchColumn();
        if ($val !== false) {
            $data['propuesta_id'] = $val;
        }
    }

    // 2. Resolver proveedor_id en solicitudes / respuestas / partidas
    if ($mysqlTable === PREFIX . 'solicitudes' && isset($data['proveedor_id']) && !is_numeric($data['proveedor_id'])) {
        $stmt = $pdo->prepare("SELECT id FROM `ctcon_proveedores` WHERE `id_bc3` = ? LIMIT 1");
        $stmt->execute([$data['proveedor_id']]);
        $val = $stmt->fetchColumn();
        if ($val !== false) {
            $data['proveedor_id'] = $val;
        }
    }
    
    if ($mysqlTable === PREFIX . 'partidas' && isset($data['proveedor_adjudicado_id']) && !is_numeric($data['proveedor_adjudicado_id'])) {
        $stmt = $pdo->prepare("SELECT id FROM `ctcon_proveedores` WHERE `id_bc3` = ? LIMIT 1");
        $stmt->execute([$data['proveedor_adjudicado_id']]);
        $val = $stmt->fetchColumn();
        if ($val !== false) {
            $data['proveedor_adjudicado_id'] = $val;
        }
    }

    if ($mysqlTable === PREFIX . 'respuestas') {
        if (isset($data['solicitud_bc3'])) {
            $stmt = $pdo->prepare("SELECT id FROM `ctcon_solicitudes` WHERE `id_bc3` = ? LIMIT 1");
            $stmt->execute([$data['solicitud_bc3']]);
            $val = $stmt->fetchColumn();
            if ($val !== false) {
                $data['solicitud_id'] = $val;
            }
        }
        if (isset($data['proveedor_bc3'])) {
            $stmt = $pdo->prepare("SELECT id FROM `ctcon_proveedores` WHERE `id_bc3` = ? LIMIT 1");
            $stmt->execute([$data['proveedor_bc3']]);
            $val = $stmt->fetchColumn();
            if ($val !== false) {
                $data['proveedor_id'] = $val;
            }
        }
        if (isset($data['partida_bc3'])) {
            $stmt = $pdo->prepare("SELECT id FROM `ctcon_partidas` WHERE `id_bc3` = ? LIMIT 1");
            $stmt->execute([$data['partida_bc3']]);
            $val = $stmt->fetchColumn();
            if ($val !== false) {
                $data['partida_id'] = $val;
            }
        }
    }

    return $data;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
try {
    switch ($method) {

        // ── GET ──────────────────────────────────────────────────────────────
        case 'GET': {
            $selectRaw = $query['select'] ?? '*';
            $selectSQL = translateSelectCols($mysqlTable, $selectRaw);
            $cols      = preg_replace('/[^a-zA-Z0-9_,\s\*`]/', '', $selectSQL);

            ['sql' => $where, 'binds' => $binds] = buildWhere($mysqlTable, $query, $pdo);

            $limit  = isset($query['limit'])  ? max(1, (int)$query['limit'])  : 5000;
            $offset = isset($query['offset']) ? max(0, (int)$query['offset']) : 0;
            $order  = '';
            if (isset($query['order'])) {
                $ord    = explode('.', $query['order']);
                $oCol   = colToMySQL($mysqlTable, preg_replace('/[^a-zA-Z0-9_]/', '', $ord[0]));
                $oDir   = (isset($ord[1]) && strtolower($ord[1]) === 'desc') ? 'DESC' : 'ASC';
                $order  = "ORDER BY `$oCol` $oDir";
            }

            $sql  = "SELECT $cols FROM `$mysqlTable` $where $order LIMIT $limit OFFSET $offset";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($binds);
            $rows = $stmt->fetchAll();

            $rows = array_map(fn($r) => postProcessRow($mysqlTable, $r), $rows);
            echo json_encode($rows, JSON_UNESCAPED_UNICODE);
            break;
        }

        // ── POST (INSERT / UPSERT) ───────────────────────────────────────────
        case 'POST': {
            // Soporta inserción individual {} o masiva [{}, {}...]
            $firstVal = (!empty($body) && is_array($body)) ? reset($body) : null;
            $isBulk   = is_array($body) && !empty($body) && is_array($firstVal);
            $rows     = $isBulk ? $body : [$body];

            $cfg      = $TABLE_CONFIG[$mysqlTable] ?? [];
            $prefer   = $_SERVER['HTTP_PREFER'] ?? '';
            $isUpsert = (strpos($prefer, 'merge-duplicates') !== false);

            $lastId   = null;
            $lastData = null;

            foreach ($rows as $rowRaw) {
                $data = translateKeys($mysqlTable, $rowRaw);
                $data = resolveForeignKeys($mysqlTable, $data, $pdo);

                if (isset($data['partidas']) && is_array($data['partidas'])) {
                    $data['partidas'] = json_encode($data['partidas'], JSON_UNESCAPED_UNICODE);
                }

                if (empty($data)) continue;

                $colList = implode(', ', array_map(fn($c) => "`$c`", array_keys($data)));
                $phs     = implode(', ', array_fill(0, count($data), '?'));

                if ($isUpsert) {
                    $updates = implode(', ', array_map(fn($c) => "`$c`=VALUES(`$c`)", array_keys($data)));
                    $sql = "INSERT INTO `$mysqlTable` ($colList) VALUES ($phs) ON DUPLICATE KEY UPDATE $updates";
                } else {
                    $sql = "INSERT INTO `$mysqlTable` ($colList) VALUES ($phs)";
                }

                $stmt = $pdo->prepare($sql);
                $stmt->execute(array_values($data));
                $lastId   = $pdo->lastInsertId();
                $lastData = $data;
            }

            http_response_code(201);
            if ($lastData !== null) {
                $idField = $cfg['reverse']['id_bc3'] ?? null;
                if ($idField && isset($lastData['id_bc3'])) {
                    echo json_encode([$idField => $lastData['id_bc3'], 'mysql_id' => $lastId]);
                } else {
                    echo json_encode(['id' => (string)$lastId, 'count' => count($rows)]);
                }
            } else {
                http_response_code(400);
                echo json_encode(['error' => 'Body vacío']);
            }
            break;
        }

        // ── PATCH (UPDATE) ───────────────────────────────────────────────────
        case 'PATCH': {
            $data = translateKeys($mysqlTable, $body);
            $data = resolveForeignKeys($mysqlTable, $data, $pdo);

            if (isset($data['partidas']) && is_array($data['partidas'])) {
                $data['partidas'] = json_encode($data['partidas'], JSON_UNESCAPED_UNICODE);
            }

            ['sql' => $where, 'binds' => $wBinds] = buildWhere($mysqlTable, $query, $pdo);

            if (!$where) {
                http_response_code(400);
                echo json_encode(['error' => 'PATCH sin WHERE no permitido']);
                break;
            }

            if (empty($data)) {
                http_response_code(400);
                echo json_encode(['error' => 'Body vacío para PATCH']);
                break;
            }

            $sets  = implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($data)));
            $binds = array_merge(array_values($data), $wBinds);
            $stmt  = $pdo->prepare("UPDATE `$mysqlTable` SET $sets $where");
            $stmt->execute($binds);
            echo json_encode(['updated' => $stmt->rowCount()]);
            break;
        }

        // ── DELETE ───────────────────────────────────────────────────────────
        case 'DELETE': {
            ['sql' => $where, 'binds' => $binds] = buildWhere($mysqlTable, $query, $pdo);

            if (!$where) {
                http_response_code(400);
                echo json_encode(['error' => 'DELETE sin WHERE no permitido']);
                break;
            }

            $stmt = $pdo->prepare("DELETE FROM `$mysqlTable` $where");
            $stmt->execute($binds);
            echo json_encode(['deleted' => $stmt->rowCount()]);
            break;
        }

        default:
            http_response_code(405);
            echo json_encode(['error' => 'Método no permitido']);
    }

} catch (Exception $e) {
    error_log('[ADIR API] ' . $method . ' ' . $sbTable . ' → ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Error interno del servidor']);
}
