
import express from "express";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI não foi configurada no arquivo .env");
}

const client = new MongoClient(process.env.MONGODB_URI);
const DB_NAME = "controle_transporte";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const db = () => client.db(DB_NAME);
const collection = name => db().collection(name);

// Converte os documentos para o formato esperado pelo HTML.
function normalize(doc) {
  if (!doc) return null;

  return {
    ...doc,
    _id: doc._id ? String(doc._id) : undefined,
    id: String(doc.id || doc._id)
  };
}

// Localiza documentos pelo ID usado pelo frontend
// ou pelo _id original do MongoDB.
function idFilter(id) {
  const filter = [{ id: String(id) }];

  if (ObjectId.isValid(String(id))) {
    filter.push({ _id: new ObjectId(String(id)) });
  }

  return { $or: filter };
}

function cleanBody(body) {
  const { _id, __v, criadoEm, createdAt, updatedAt, ...dados } = body || {};
  return dados;
}

function validAmount(amount) {
  return Number.isFinite(Number(amount)) && Number(amount) > 0;
}

function validDate(date) {
  return typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00`));
}

function sendError(res, error, message) {
  console.error(message, error);
  return res.status(500).json({ erro: message });
}

// Página inicial.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Status do servidor e do MongoDB.
app.get("/api/status", async (req, res) => {
  try {
    await db().command({ ping: 1 });

    res.json({
      servidor: "online",
      banco: "conectado"
    });
  } catch (error) {
    console.error("Erro ao verificar o MongoDB:", error.message);

    res.status(500).json({
      servidor: "online",
      banco: "desconectado"
    });
  }
});

// ===============================
// CLIENTES
// ===============================

// Listar clientes.
app.get("/api/clientes", async (req, res) => {
  try {
    const docs = await collection("clientes")
      .find({})
      .sort({ criadoEm: -1 })
      .toArray();

    res.json(docs.map(normalize));
  } catch (error) {
    sendError(res, error, "Não foi possível buscar os clientes.");
  }
});

// Cadastrar cliente.
app.post("/api/clientes", async (req, res) => {
  try {
    const dados = cleanBody(req.body);

    if (
      !dados.name ||
      typeof dados.name !== "string" ||
      !validAmount(dados.amount) ||
      !validDate(dados.dueDate)
    ) {
      return res.status(400).json({
        erro: "Informe nome, valor válido e data de pagamento."
      });
    }

    const documento = {
      ...dados,
      id: String(dados.id || new ObjectId()),
      amount: Number(dados.amount),
      status: dados.status || "pending",
      paidAt: dados.paidAt || null,
      criadoEm: new Date()
    };

    await collection("clientes").insertOne(documento);

    // Retorna o cliente completo, como o HTML espera.
    res.status(201).json(normalize(documento));
  } catch (error) {
    sendError(res, error, "Não foi possível cadastrar o cliente.");
  }
});

// Editar cliente ou atualizar seu status de pagamento.
app.put("/api/clientes/:id", async (req, res) => {
  try {
    const dados = cleanBody(req.body);
    delete dados.id;

    if (dados.amount !== undefined) {
      if (!validAmount(dados.amount)) {
        return res.status(400).json({
          erro: "O valor informado é inválido."
        });
      }

      dados.amount = Number(dados.amount);
    }

    if (dados.dueDate !== undefined && !validDate(dados.dueDate)) {
      return res.status(400).json({
        erro: "A data de pagamento é inválida."
      });
    }

    const result = await collection("clientes").updateOne(
      idFilter(req.params.id),
      { $set: { ...dados, atualizadoEm: new Date() } }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        erro: "Cliente não encontrado."
      });
    }

    const atualizado = await collection("clientes").findOne(
      idFilter(req.params.id)
    );

    res.json(normalize(atualizado));
  } catch (error) {
    sendError(res, error, "Não foi possível atualizar o cliente.");
  }
});

// Excluir cliente.
app.delete("/api/clientes/:id", async (req, res) => {
  try {
    const result = await collection("clientes").deleteOne(
      idFilter(req.params.id)
    );

    if (!result.deletedCount) {
      return res.status(404).json({
        erro: "Cliente não encontrado."
      });
    }

    res.json({ mensagem: "Cliente excluído com sucesso." });
  } catch (error) {
    sendError(res, error, "Não foi possível excluir o cliente.");
  }
});

// ===============================
// MOVIMENTAÇÕES DO CAIXA
// ===============================

// Listar entradas e saídas.
app.get("/api/movimentacoes", async (req, res) => {
  try {
    const docs = await collection("movimentacoes")
      .find({})
      .sort({ date: -1, criadoEm: -1 })
      .toArray();

    res.json(docs.map(normalize));
  } catch (error) {
    sendError(res, error, "Não foi possível buscar as movimentações.");
  }
});

// Criar movimentação financeira.
app.post("/api/movimentacoes", async (req, res) => {
  try {
    const dados = cleanBody(req.body);

    if (
      !["income", "expense"].includes(dados.type) ||
      !dados.description ||
      !validAmount(dados.amount) ||
      !validDate(dados.date)
    ) {
      return res.status(400).json({
        erro: "Informe tipo, descrição, valor e data válidos."
      });
    }

    const documento = {
      ...dados,
      amount: Number(dados.amount),
      criadoEm: new Date()
    };

    const result = await collection("movimentacoes").insertOne(documento);

    res.status(201).json(
      normalize({ ...documento, _id: result.insertedId })
    );
  } catch (error) {
    sendError(res, error, "Não foi possível registrar a movimentação.");
  }
});

// Remover movimentação pelo ID.
app.delete("/api/movimentacoes/:id", async (req, res) => {
  try {
    const result = await collection("movimentacoes").deleteOne(
      idFilter(req.params.id)
    );

    if (!result.deletedCount) {
      return res.status(404).json({
        erro: "Movimentação não encontrada."
      });
    }

    res.json({ mensagem: "Movimentação removida com sucesso." });
  } catch (error) {
    sendError(res, error, "Não foi possível remover a movimentação.");
  }
});

// ===============================
// DESPESAS
// ===============================

// Listar despesas.
app.get("/api/despesas", async (req, res) => {
  try {
    const docs = await collection("despesas")
      .find({})
      .sort({ date: -1, criadoEm: -1 })
      .toArray();

    res.json(docs.map(normalize));
  } catch (error) {
    sendError(res, error, "Não foi possível buscar as despesas.");
  }
});

// Registrar despesa e sua saída correspondente no caixa.
app.post("/api/despesas", async (req, res) => {
  const session = client.startSession();

  try {
    const dados = cleanBody(req.body);

    if (
      !dados.description ||
      !validAmount(dados.amount) ||
      !validDate(dados.date)
    ) {
      return res.status(400).json({
        erro: "Informe descrição, valor e data válidos."
      });
    }

    const expenseId = new ObjectId();
    const transactionId = new ObjectId();

    const expense = {
      ...dados,
      _id: expenseId,
      amount: Number(dados.amount),
      criadoEm: new Date()
    };

    const transaction = {
      _id: transactionId,
      type: "expense",
      expenseId: String(expenseId),
      description: dados.description,
      amount: Number(dados.amount),
      date: dados.date,
      category: dados.category || "Outros",
      criadoEm: new Date()
    };

    // As duas gravações são feitas na mesma transação.
    await session.withTransaction(async () => {
      await collection("despesas").insertOne(expense, { session });
      await collection("movimentacoes").insertOne(transaction, { session });
    });

    res.status(201).json({
      expense: normalize(expense),
      transaction: normalize(transaction)
    });
  } catch (error) {
    sendError(res, error, "Não foi possível registrar a despesa.");
  } finally {
    await session.endSession();
  }
});

// Rota para endpoints inexistentes.
app.use("/api", (req, res) => {
  res.status(404).json({
    erro: `Rota da API não encontrada: ${req.method} ${req.originalUrl}`
  });
});

// Erros de JSON inválido e outros erros do Express.
app.use((error, req, res, next) => {
  console.error("Erro no servidor:", error.message);

  if (res.headersSent) return next(error);

  res.status(error.status === 400 ? 400 : 500).json({
    erro: error.status === 400
      ? "JSON inválido na requisição."
      : "Erro interno do servidor."
  });
});

// Iniciar somente depois de conectar ao MongoDB.
async function startServer() {
  try {
    await client.connect();
    await db().command({ ping: 1 });

    console.log("MongoDB conectado com sucesso!");

    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error("Erro ao iniciar o servidor:", error.message);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
