/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  MIGRACIÓN COMPLETADA: Supabase → MySQL (Dinahosting)        ║
 * ║  Punto de retorno: git checkout v1-supabase-last             ║
 * ║  Fecha: 2026-05-25                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Este fichero ya no usa @supabase/supabase-js.
 * Implementa la misma interfaz (supabase.from().select().eq()…)
 * pero contra la API PHP en Dinahosting.
 *
 * Variables de entorno necesarias en Vercel / .env.local:
 *   VITE_API_URL = https://TU_DOMINIO/api/api.php
 *   VITE_API_KEY = (clave configurada en api.php)
 */

const API_URL = import.meta.env.VITE_API_URL;
const API_KEY  = import.meta.env.VITE_API_KEY;

if (!API_URL || !API_KEY) {
    console.error(
        '[ADIR] Faltan variables de entorno:\n' +
        '  VITE_API_URL → URL de la API PHP en Dinahosting\n' +
        '  VITE_API_KEY → clave secreta configurada en api.php'
    );
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────
async function apiFetch(table, method, params = {}, body = null, upsert = false) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const url = `${API_URL}/${table}${qs.toString() ? '?' + qs.toString() : ''}`;
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': API_KEY,
            // Señal para el PHP: usar INSERT ... ON DUPLICATE KEY UPDATE
            ...(upsert ? { 'Prefer': 'resolution=merge-duplicates' } : {}),
        },
    };
    if (body !== null) opts.body = JSON.stringify(body);

    try {
        const res  = await fetch(url, opts);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const errMsg = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${res.status}`;
            return { data: null, error: { message: typeof errMsg === 'object' ? JSON.stringify(errMsg) : String(errMsg) } };
        }
        return { data, error: null };
    } catch (err) {
        return { data: null, error: { message: err.message } };
    }
}

// ─── Query Builder (imita supabase-js) ───────────────────────────────────────
class QueryBuilder {
    constructor(table) {
        this._table   = table;
        this._filters = {};
        this._select  = '*';
        this._method  = 'GET';
        this._body    = null;
        this._order   = null;
        this._limit   = null;
        this._offset  = null;
        this._upsert  = false;
        this._single  = false;
        this._head    = false;
        this._count   = null;
        this._orExpr  = null;
    }

    // ── Selección ─────────────────────────────────────────────────────────────
    select(cols = '*', opts = {}) {
        this._select = cols;
        if (opts.count) this._count = opts.count;
        if (opts.head)  this._head  = opts.head;
        return this;
    }

    order(col, { ascending = true } = {}) {
        this._order = `${col}.${ascending ? 'asc' : 'desc'}`;
        return this;
    }
    limit(n)  { this._limit  = n; return this; }
    offset(n) { this._offset = n; return this; }
    range(from, to) {
        this._offset = from;
        this._limit  = to - from + 1;
        return this;
    }

    // ── Filtros ───────────────────────────────────────────────────────────────
    eq(col, val)   { this._filters[col] = `eq.${val}`;   return this; }
    neq(col, val)  { this._filters[col] = `neq.${val}`;  return this; }
    gt(col, val)   { this._filters[col] = `gt.${val}`;   return this; }
    gte(col, val)  { this._filters[col] = `gte.${val}`;  return this; }
    lt(col, val)   { this._filters[col] = `lt.${val}`;   return this; }
    lte(col, val)  { this._filters[col] = `lte.${val}`;  return this; }
    like(col, val)        { this._filters[col] = `like.${val}`;         return this; }
    ilike(col, val)       { this._filters[col] = `ilike.${val}`;        return this; }
    in(col, vals)         { this._filters[col] = `in.(${vals.join(',')})`;  return this; }
    contains(col, val)    { this._filters[col] = `cs.${val}`;           return this; }
    not(col, op, val)     { this._filters[col] = `not.${op}.${val}`;    return this; }
    filter(col, op, val)  { this._filters[col] = `${op}.${val}`;        return this; }
    or(expr)              { this._orExpr = expr;                         return this; }

    // ── Single row ────────────────────────────────────────────────────────────
    maybeSingle() { this._single = true; return this; }
    single()      { this._single = true; return this; }

    // ── Escritura ─────────────────────────────────────────────────────────────
    insert(data)             { this._method = 'POST';   this._body = data; return this; }
    update(data)             { this._method = 'PATCH';  this._body = data; return this; }
    upsert(data, _opts = {}) { this._method = 'POST';   this._body = data; this._upsert = true; return this; }
    delete(_opts = {})       { this._method = 'DELETE'; return this; }

    // ── Real-time (stubs) ─────────────────────────────────────────────────────
    channel()       { return { on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }; }
    removeChannel() {}

    // ── Promise interop ───────────────────────────────────────────────────────
    catch(onRejected) { return this._execute().catch(onRejected); }
    finally(onFinally) { return this._execute().finally(onFinally); }

    // ── Ejecución ─────────────────────────────────────────────────────────────
    async _execute() {
        const params = { ...this._filters };
        if (this._select !== '*') params.select = this._select;
        if (this._order)          params.order  = this._order;
        if (this._limit  !== null) params.limit  = this._limit;
        if (this._offset !== null) params.offset = this._offset;
        if (this._orExpr)         params.or     = this._orExpr;

        // count=exact con head:true (usado en App.jsx para badges del menú).
        // Pedimos solo la columna `id` para minimizar la transferencia. La interfaz
        // que devolvemos es la misma que la de supabase-js (data:[], count, error).
        // TODO(server): cuando api.php exponga /count/<tabla>, sustituir por una sola
        // consulta SELECT COUNT(*) y eliminar este fetch.
        if (this._count === 'exact' && this._head) {
            const rAll = await apiFetch(
                this._table,
                'GET',
                { ...this._filters, limit: 5000, select: 'id' },
                null
            );
            const count = Array.isArray(rAll.data) ? rAll.data.length : 0;
            return { data: [], count, error: rAll.error };
        }

        const result = await apiFetch(this._table, this._method, params, this._body, this._upsert);

        // single / maybeSingle
        if (this._single && Array.isArray(result.data)) {
            result.data = result.data[0] ?? null;
        }

        return result;
    }

    then(resolve, reject) {
        return this._execute().then(resolve, reject);
    }
}

// ─── Exportación (misma interfaz que @supabase/supabase-js) ──────────────────
export const supabase = {
    from: (table) => new QueryBuilder(table),

    channel: (_name) => ({
        on: (_event, _filter, _cb) => ({
            subscribe: (_cb2) => ({ unsubscribe: () => {} }),
        }),
    }),
    removeChannel: () => {},

    auth: {
        getUser:  async () => ({ data: { user: null }, error: null }),
        signIn:   async () => ({ data: null, error: { message: 'Auth no implementado en MySQL' } }),
        signOut:  async () => ({ error: null }),
    },

    storage: {
        from: () => ({
            upload: async () => ({ data: null, error: { message: 'Storage: usar FTP Dinahosting para anexos' } }),
            getPublicUrl: () => ({ data: { publicUrl: '' } }),
        }),
    },
};
