
const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');
const clientesRoutes = require('./routes/clientes.routes');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const catalogoRoutes = require('./routes/catalogo.routes');

app.use(cors({
  origin: 'http://localhost:4200',
}));

app.use(express.json());

// Rota de teste da API e da base de dados
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        CURRENT_TIMESTAMP AS server_time
    `);

    res.json({
      status: 'ok',
      message: 'API ligada ao PostgreSQL.',
      database: result.rows[0].database,
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    console.error('Erro ao consultar PostgreSQL:', error.message);

    res.status(500).json({
      status: 'error',
      message: 'Não foi possível consultar a base de dados.',
    });
  }
});
app.use('/api/clientes', clientesRoutes);

app.use('/api', catalogoRoutes);

app.listen(PORT, () => {
  console.log(`API disponível em http://localhost:${PORT}`);
});
