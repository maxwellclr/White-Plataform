
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

const camposCliente = `
  id,
  nome,
  sobrenome,
  TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
  email,
  telefone_indicativo,
  telefone,
  telefone_secundario,
  criado_em,
  atualizado_em
`;

const idValido = (id) => /^[1-9]\d*$/.test(id);

const emailValido = (email) =>
  email == null ||
  email === '' ||
  (
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );

const dataValida = (data) => {
  if (data == null || data === '') return true;

  if (typeof data !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return false;
  }

  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));

  return d.getUTCFullYear() === ano &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia;
};

const erroBanco = (res, error, mensagem) => {
  console.error(mensagem, error);

  if (['22007', '22008', '22009'].includes(error.code)) {
    return res.status(400).json({
      message: 'Data inválida.'
    });
  }

  return res.status(500).json({
    message: mensagem
  });
};

const validarAtendimento = (atendimento) => {
  if (!atendimento || typeof atendimento !== 'object') {
    return 'Os dados do atendimento são obrigatórios.';
  }

  const {
    data,
    categoria_id,
    produto_id,
    tipo_interacao,
    estado,
    canal,
    observacoes
  } = atendimento;

  if (
    typeof data !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data) ||
    !Number.isFinite(new Date(data).getTime())
  ) {
    return 'A data do atendimento é inválida.';
  }

  if (!idValido(String(categoria_id)) ||
      !idValido(String(produto_id))) {
    return 'Categoria ou produto inválido.';
  }

  if (![
    'pedido_informacao', 'interesse', 'orcamento', 'compra'
  ].includes(tipo_interacao)) {
    return 'Tipo de interação inválido.';
  }

  if (![
    'aberto', 'em_andamento', 'concluido', 'cancelado'
  ].includes(estado)) {
    return 'Estado inválido.';
  }

  if (![
    'presencial', 'telefone', 'whatsapp', 'email', 'site'
  ].includes(canal)) {
    return 'Canal inválido.';
  }

  if (observacoes != null &&
      typeof observacoes !== 'string') {
    return 'As observações são inválidas.';
  }

  return null;
};

const guardarAtendimento = async (
  db,
  clienteId,
  atendimento
) => {
  const produto = await db.query(
    `SELECT id
     FROM produtos
     WHERE id = $1 AND categoria_id = $2`,
    [
      atendimento.produto_id,
      atendimento.categoria_id
    ]
  );

  if (produto.rowCount === 0) {
    const erro = new Error(
      'O produto não existe ou não pertence à categoria.'
    );
    erro.status = 400;
    throw erro;
  }

  const resultado = await db.query(
    `INSERT INTO atendimentos (
      cliente_id,
      data_atendimento,
      estado,
      canal,
      observacoes
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id`,
    [
      clienteId,
      atendimento.data,
      atendimento.estado,
      atendimento.canal,
      atendimento.observacoes || null
    ]
  );

  const atendimentoId = resultado.rows[0].id;

  await db.query(
    `INSERT INTO atendimento_produtos (
      atendimento_id,
      produto_id,
      tipo_interacao,
      quantidade
    )
    VALUES ($1, $2, $3, $4)`,
    [
      atendimentoId,
      atendimento.produto_id,
      atendimento.tipo_interacao,
      1
    ]
  );

  return atendimentoId;
};

// =====================================================
// GET /api/clientes
// Lista clientes com a interação mais recente
// =====================================================

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        cl.id,
        cl.nome,
        cl.sobrenome,
        TO_CHAR(cl.data_nascimento, 'YYYY-MM-DD')
          AS data_nascimento,
        cl.email,
        cl.telefone_indicativo,
        cl.telefone,
        cl.telefone_secundario,
        cl.criado_em,
        cl.atualizado_em,

        ultima.data AS ultima_data_interacao,
        ultima.categoria AS ultima_categoria,
        ultima.produto AS ultimo_produto,
        ultima.tipo_interacao AS ultima_interacao

      FROM clientes cl

      LEFT JOIN LATERAL (
        SELECT
          a.data_atendimento AS data,
          c.nome AS categoria,
          p.nome AS produto,
          ap.tipo_interacao

        FROM atendimentos a

        INNER JOIN atendimento_produtos ap
          ON ap.atendimento_id = a.id

        INNER JOIN produtos p
          ON p.id = ap.produto_id

        LEFT JOIN categorias c
          ON c.id = p.categoria_id

        WHERE a.cliente_id = cl.id

        ORDER BY
          a.data_atendimento DESC,
          a.id DESC,
          ap.produto_id DESC

        LIMIT 1
      ) ultima ON TRUE

      ORDER BY cl.id DESC
    `);

    return res.json({
      total: result.rowCount,
      clientes: result.rows
    });

  } catch (error) {
    return erroBanco(
      res,
      error,
      'Erro ao consultar os clientes.'
    );
  }
});

// =====================================================
// GET /api/clientes/:id
// Consulta dados pessoais e histórico completo
// =====================================================


router.post('/com-atendimento', async (req, res) => {
  const { cliente, atendimento } = req.body || {};

  if (!cliente || typeof cliente !== 'object') {
    return res.status(400).json({
      message: 'Os dados do cliente são obrigatórios.'
    });
  }

  const {
    nome,
    sobrenome,
    data_nascimento,
    email,
    telefone_indicativo,
    telefone,
    telefone_secundario
  } = cliente;

  if (
    typeof nome !== 'string' ||
    !nome.trim() ||
    typeof sobrenome !== 'string' ||
    !sobrenome.trim()
  ) {
    return res.status(400).json({
      message: 'Nome e sobrenome são obrigatórios.'
    });
  }

  if (!emailValido(email) ||
      !dataValida(data_nascimento)) {
    return res.status(400).json({
      message: 'Email ou data de nascimento inválidos.'
    });
  }

  const erroAtendimento = validarAtendimento(atendimento);

  if (erroAtendimento) {
    return res.status(400).json({
      message: erroAtendimento
    });
  }

  const db = await pool.connect().catch(error => {
    console.error('Erro ao obter ligação:', error);
    return null;
  });

  if (!db) {
    return res.status(500).json({
      message: 'Não foi possível ligar à base de dados.'
    });
  }

  try {
    await db.query('BEGIN');

    const resultado = await db.query(
      `INSERT INTO clientes (
        nome,
        sobrenome,
        data_nascimento,
        email,
        telefone_indicativo,
        telefone,
        telefone_secundario
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${camposCliente}`,
      [
        nome.trim(),
        sobrenome.trim(),
        data_nascimento || null,
        email?.trim() || null,
        telefone_indicativo || null,
        telefone || null,
        telefone_secundario || null
      ]
    );

    const novoCliente = resultado.rows[0];

    const atendimentoId = await guardarAtendimento(
      db,
      novoCliente.id,
      atendimento
    );

    await db.query('COMMIT');

    return res.status(201).json({
      message: 'Cliente e atendimento criados com sucesso.',
      cliente: novoCliente,
      atendimento_id: atendimentoId
    });

  } catch (error) {
    await db.query('ROLLBACK').catch(console.error);

    if (error.status === 400) {
      return res.status(400).json({
        message: error.message
      });
    }

    return erroBanco(
      res,
      error,
      'Erro ao criar cliente e atendimento.'
    );

  } finally {
    db.release();
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!idValido(id)) {
    return res.status(400).json({
      message: 'ID de cliente inválido.'
    });
  }

  try {
    const clienteResult = await pool.query(
      `SELECT ${camposCliente}
       FROM clientes
       WHERE id = $1`,
      [id]
    );

    if (clienteResult.rowCount === 0) {
      return res.status(404).json({
        message: 'Cliente não encontrado.'
      });
    }

    const historicoResult = await pool.query(
      `SELECT
        a.id AS atendimento_id,
        a.data_atendimento AS data,
        p.id AS produto_id,
        p.nome AS produto,
        c.nome AS categoria,
        ap.tipo_interacao,
        ap.quantidade,
        ap.observacoes AS observacoes_produto,
        a.estado,
        a.canal,
        a.observacoes

      FROM atendimentos a

      LEFT JOIN atendimento_produtos ap
        ON ap.atendimento_id = a.id

      LEFT JOIN produtos p
        ON p.id = ap.produto_id

      LEFT JOIN categorias c
        ON c.id = p.categoria_id

      WHERE a.cliente_id = $1

      ORDER BY
        a.data_atendimento DESC,
        a.id DESC,
        ap.produto_id DESC`,
      [id]
    );

    return res.json({
      ...clienteResult.rows[0],
      historico: historicoResult.rows
    });

  } catch (error) {
    return erroBanco(
      res,
      error,
      'Erro ao consultar o cliente.'
    );
  }
});

// =====================================================
// POST /api/clientes
// Regista um novo cliente
// =====================================================

router.post('/', async (req, res) => {
  const {
    nome,
    sobrenome,
    data_nascimento,
    email,
    telefone_indicativo,
    telefone,
    telefone_secundario
  } = req.body;

  if (
    typeof nome !== 'string' ||
    !nome.trim() ||
    typeof sobrenome !== 'string' ||
    !sobrenome.trim()
  ) {
    return res.status(400).json({
      message: 'Nome e sobrenome são obrigatórios.'
    });
  }

  if (!emailValido(email)) {
    return res.status(400).json({
      message: 'O email não é válido.'
    });
  }

  if (!dataValida(data_nascimento)) {
    return res.status(400).json({
      message: 'A data de nascimento não é válida.'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO clientes (
        nome,
        sobrenome,
        data_nascimento,
        email,
        telefone_indicativo,
        telefone,
        telefone_secundario
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${camposCliente}`,
      [
        nome.trim(),
        sobrenome.trim(),
        data_nascimento || null,
        email?.trim() || null,
        telefone_indicativo || null,
        telefone || null,
        telefone_secundario || null
      ]
    );

    return res.status(201).json({
      message: 'Cliente criado com sucesso.',
      cliente: result.rows[0]
    });

  } catch (error) {
    return erroBanco(
      res,
      error,
      'Erro ao guardar o cliente na base de dados.'
    );
  }
});

// =====================================================
// PUT /api/clientes/:id
// Atualiza o cadastro sem apagar campos omitidos
// =====================================================

router.put('/:id', async (req, res) => {
  const { id } = req.params;

  if (!idValido(id)) {
    return res.status(400).json({
      message: 'ID de cliente inválido.'
    });
  }

  const {
    nome,
    sobrenome,
    data_nascimento,
    email,
    telefone_indicativo,
    telefone,
    telefone_secundario
  } = req.body;

  if (
    (nome !== undefined &&
      (typeof nome !== 'string' || !nome.trim())) ||
    (sobrenome !== undefined &&
      (typeof sobrenome !== 'string' || !sobrenome.trim()))
  ) {
    return res.status(400).json({
      message: 'Nome e sobrenome não podem estar vazios.'
    });
  }

  if (!emailValido(email)) {
    return res.status(400).json({
      message: 'O email não é válido.'
    });
  }

  if (!dataValida(data_nascimento)) {
    return res.status(400).json({
      message: 'A data de nascimento não é válida.'
    });
  }

  const campos = {
    nome: nome === undefined ? undefined : nome.trim(),
    sobrenome: sobrenome === undefined
      ? undefined
      : sobrenome.trim(),
    data_nascimento: data_nascimento === ''
      ? null
      : data_nascimento,
    email: email === undefined
      ? undefined
      : email?.trim() || null,
    telefone_indicativo,
    telefone,
    telefone_secundario
  };

  const permitidos = [
    'nome',
    'sobrenome',
    'data_nascimento',
    'email',
    'telefone_indicativo',
    'telefone',
    'telefone_secundario'
  ];

  const atualizacoes = [];
  const valores = [];

  for (const campo of permitidos) {
    if (campos[campo] !== undefined) {
      valores.push(campos[campo]);
      atualizacoes.push(`${campo} = $${valores.length}`);
    }
  }

  if (atualizacoes.length === 0) {
    return res.status(400).json({
      message: 'Nenhum campo foi enviado para atualização.'
    });
  }

  valores.push(id);

  try {
    const result = await pool.query(
      `UPDATE clientes
       SET
         ${atualizacoes.join(', ')},
         atualizado_em = NOW()
       WHERE id = $${valores.length}
       RETURNING ${camposCliente}`,
      valores
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: 'Cliente não encontrado.'
      });
    }

    return res.json({
      message: 'Cliente atualizado com sucesso.',
      cliente: result.rows[0]
    });

  } catch (error) {
    return erroBanco(
      res,
      error,
      'Erro ao atualizar o cliente.'
    );
  }
});


router.post('/:id/atendimentos', async (req, res) => {
  const { id } = req.params;

  if (!idValido(id)) {
    return res.status(400).json({
      message: 'ID de cliente inválido.'
    });
  }

  const erroAtendimento = validarAtendimento(req.body);

  if (erroAtendimento) {
    return res.status(400).json({
      message: erroAtendimento
    });
  }

  let db;

  try {
    db = await pool.connect();

    await db.query('BEGIN');

    const cliente = await db.query(
      'SELECT id FROM clientes WHERE id = $1',
      [id]
    );

    if (cliente.rowCount === 0) {
      await db.query('ROLLBACK');

      return res.status(404).json({
        message: 'Cliente não encontrado.'
      });
    }

    const atendimentoId = await guardarAtendimento(
      db,
      id,
      req.body
    );

    await db.query('COMMIT');

    return res.status(201).json({
      message: 'Atendimento registado com sucesso.',
      atendimento_id: atendimentoId
    });

  } catch (error) {
    if (db) {
      await db.query('ROLLBACK').catch(console.error);
    }

    if (error.status === 400) {
      return res.status(400).json({
        message: error.message
      });
    }

    return erroBanco(
      res,
      error,
      'Erro ao registar atendimento.'
    );

  } finally {
    if (db) db.release();
  }
});

module.exports = router;
