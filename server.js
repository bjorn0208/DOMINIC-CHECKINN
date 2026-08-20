import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'checkout-missoes-prototipo')));

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

let inMemoryBackup = null;

// Endpoint to check Supabase configuration & connectivity
app.get('/api/supabase-status', async (req, res) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    return res.json({
      configured: false,
      message: 'Chaves do Supabase não encontradas no ambiente.'
    });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('app_state')
      .select('updated_at')
      .eq('id', 'global')
      .maybeSingle();

    if (error && error.code === '42P01') {
      return res.json({
        configured: true,
        connected: true,
        tableExists: false,
        message: 'Conectado ao Supabase! A tabela app_state precisa ser criada no SQL Editor.',
        sqlHelp: 'CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());'
      });
    }

    return res.json({
      configured: true,
      connected: !error,
      tableExists: true,
      lastSync: data ? data.updated_at : null,
      message: error ? error.message : 'Conectado e sincronizado com o Supabase com sucesso'
    });
  } catch (err) {
    return res.json({
      configured: true,
      connected: false,
      message: err.message
    });
  }
});

// Endpoint to load data from Supabase
app.get('/api/supabase/load', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.json({ success: false, configured: false, data: inMemoryBackup });
  }

  try {
    const { data, error } = await supabase
      .from('app_state')
      .select('data, updated_at')
      .eq('id', 'global')
      .maybeSingle();

    if (error) {
      console.warn('Supabase load warning:', error.message);
      return res.json({ success: false, error: error.message, data: inMemoryBackup });
    }

    if (data && data.data) {
      inMemoryBackup = data.data;
      return res.json({ success: true, configured: true, data: data.data, updatedAt: data.updated_at });
    }

    return res.json({ success: true, configured: true, data: inMemoryBackup, empty: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, data: inMemoryBackup });
  }
});

// Endpoint to sync/save data to Supabase
app.post('/api/supabase/sync', async (req, res) => {
  const { missoes, pessoas, inventario } = req.body || {};
  const payload = { missoes: missoes || [], pessoas: pessoas || [], inventario: inventario || [] };
  inMemoryBackup = payload;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.json({
      success: false,
      configured: false,
      message: 'Supabase não configurado nas variáveis de ambiente. Dados salvos localmente.'
    });
  }

  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('app_state')
      .upsert({
        id: 'global',
        data: payload,
        updated_at: now
      }, { onConflict: 'id' });

    if (error) {
      if (error.code === '42P01') {
        return res.json({
          success: false,
          tableMissing: true,
          sqlHelp: 'CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());',
          message: 'Tabela app_state não encontrada no Supabase. Crie-a no painel SQL.'
        });
      }
      return res.json({ success: false, error: error.message });
    }

    return res.json({ success: true, syncedAt: now });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

