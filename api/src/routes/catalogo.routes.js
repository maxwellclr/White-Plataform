
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/categorias
router.get('/categorias', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nome, descricao
      FROM categorias
      WHERE ativo = TRUE
      ORDER BY nome ASC
    `);

    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao consultar categorias:', error);
    return res.status(500).json({
      message: 'Erro ao consultar categorias.'
    });
  }
});

// GET /api/produtos?categoria_id=3
router.get('/produtos', async (req, res) => {
  const { categoria_id } = req.query;

  if (
    categoria_id !== undefined &&
    !/^[1-9]\d*$/.test(String(categoria_id))
  ) {
    return res.status(400).json({
      message: 'ID de categoria inválido.'
    });
  }

  try {
    const result = await pool.query(
      `SELECT
        p.id,
        p.nome,
        p.descricao,
        p.categoria_id,
        c.nome AS categoria
      FROM produtos p
      INNER JOIN categorias c
        ON c.id = p.categoria_id
      WHERE p.ativo = TRUE
        AND c.ativo = TRUE
        AND ($1::bigint IS NULL OR p.categoria_id = $1)
      ORDER BY p.nome ASC`,
      [categoria_id || null]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Erro ao consultar produtos:', error);
    return res.status(500).json({
      message: 'Erro ao consultar produtos.'
    });
  }
});

module.exports = router;
