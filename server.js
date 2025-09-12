const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const xlsx = require('xlsx');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// --- MODO DE DEPURACÃO ---
// Mude para 'false' quando tudo estiver a funcionar para um terminal mais limpo.
const DEBUG_MODE = true;

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const HISTORICO_PATH = process.env.RENDER ? '/data/historico.json' : './historico.json';
let historicoDeTarefas = carregarHistorico();
let boardState = { tasks: [], boardData: getBoardData() }; 
let yesterdayTasks = [];
let tomorrowTasks = [];

function carregarHistorico() {
    try {
        if (fs.existsSync(HISTORICO_PATH)) {
            const data = fs.readFileSync(HISTORICO_PATH);
            const historico = JSON.parse(data);
            for (const taskId in historico) {
                const task = historico[taskId];
                if (task.dataCompleta) task.dataCompleta = new Date(task.dataCompleta);
                if (task.horaEntrada) task.horaEntrada = new Date(task.horaEntrada);
                if (task.horaFinalizacao) task.horaFinalizacao = new Date(task.horaFinalizacao);
            }
            console.log("Ficheiro de histórico carregado e datas convertidas.");
            return historico;
        }
        console.log("Nenhum ficheiro de histórico encontrado. A começar um novo.");
        return {};
    } catch (error) {
        console.error("Erro ao carregar o histórico:", error);
        return {};
    }
}

function salvarHistorico() {
    try {
        boardState.tasks.forEach(task => {
            historicoDeTarefas[task.id] = task;
        });
        fs.writeFileSync(HISTORICO_PATH, JSON.stringify(historicoDeTarefas, null, 2));
        if (DEBUG_MODE) console.log("Histórico de tarefas salvo.");
    } catch (error) {
        console.error("Erro ao salvar o histórico:", error);
    }
}

function processLocalSheetData() {
    try {
        if (DEBUG_MODE) console.log('\n--- INICIANDO DIAGNÓSTICO DETALHADO ---');
        const filePath = path.join(__dirname, 'agendamentos.xlsx');
        if (!fs.existsSync(filePath)) {
            console.error(`[FALHA CRÍTICA] Ficheiro da planilha não encontrado em: ${filePath}`);
            return;
        }

        const workbook = xlsx.readFile(filePath, { cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const allTasksData = xlsx.utils.sheet_to_json(sheet);

        if (!allTasksData || allTasksData.length === 0) {
            console.log('[INFO] Nenhum dado encontrado na planilha.');
            return;
        }
        if (DEBUG_MODE) console.log(`[INFO] Encontradas ${allTasksData.length} linhas na planilha para processar.`);

        const allTasks = parseSheetData(allTasksData);
        
        const hoje = new Date();
        const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
        const amanha = new Date(); amanha.setDate(hoje.getDate() + 1);
        
        if (DEBUG_MODE) {
            console.log(`\n[INFO] Data de referência para HOJE: ${hoje.toLocaleDateString('pt-BR')}`);
        }
        
        const todayTasks = allTasks.filter(task => isSameDay(task.dataCompleta, hoje));
        yesterdayTasks = allTasks.filter(task => isSameDay(task.dataCompleta, ontem));
        tomorrowTasks = allTasks.filter(task => isSameDay(task.dataCompleta, amanha));
        
        todayTasks.forEach(task => {
            if (historicoDeTarefas[task.id]) {
                Object.assign(task, historicoDeTarefas[task.id]);
            }
        });

        boardState = { tasks: todayTasks, boardData: getBoardData() };
        console.log(`\n--- RESULTADO FINAL DO DIAGNÓSTICO ---`);
        console.log(`Dados processados: ${yesterdayTasks.length} de ontem, ${todayTasks.length} de hoje, ${tomorrowTasks.length} de amanhã.`);

    } catch (error) {
        console.error("[FALHA CRÍTICA] Erro ao processar a planilha local:", error);
    }
}

function parseSheetData(sheetData) {
    if (DEBUG_MODE) console.log('\n--- A ANALISAR LINHAS INDIVIDUALMENTE ---');
    return sheetData.map((row, index) => {
        if (DEBUG_MODE) console.log(`\n[A analisar Linha ${index + 2}]`);
        if (DEBUG_MODE) console.log('  > Dados brutos da linha:', row);

        const upperCaseRow = {};
        for (const key in row) { upperCaseRow[key.toUpperCase().trim()] = row[key]; }

        if (DEBUG_MODE) console.log('  > Cabeçalhos encontrados (em maiúsculas):', Object.keys(upperCaseRow));

        if (!upperCaseRow['DATA_AGENDAMENTO']) {
            if (DEBUG_MODE) console.warn(`  > REJEITADO: Coluna 'DATA_AGENDAMENTO' não encontrada.`);
            return null;
        }

        const dataAgendamento = new Date(upperCaseRow['DATA_AGENDAMENTO']);
        if (isNaN(dataAgendamento.getTime())) {
            if (DEBUG_MODE) console.warn(`  > REJEITADO: O valor '${upperCaseRow['DATA_AGENDAMENTO']}' não é uma data válida.`);
            return null;
        }
        if (DEBUG_MODE) console.log(`  > Data interpretada: ${dataAgendamento.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);

        const cliente = upperCaseRow['CLIENTE'];
        if (!cliente) {
            if (DEBUG_MODE) console.warn(`  > REJEITADO: Coluna 'CLIENTE' não encontrada ou vazia.`);
            return null;
        }

        const normalizedCliente = String(cliente).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const taskId = `${dataAgendamento.toISOString()}-${normalizedCliente}`;

        const horas = String(dataAgendamento.getHours()).padStart(2, '0');
        const minutos = String(dataAgendamento.getMinutes()).padStart(2, '0');
        
        const task = {
            id: taskId,
            dataCompleta: dataAgendamento,
            pedido: upperCaseRow['NUMERO_PEDIDO'] || taskId,
            cliente: cliente,
            tipo: upperCaseRow['SERVIÇO'],
            horarioSugerido: `${horas}:${minutos}`,
            status: 'Aguardando',
            horaEntrada: null,
            horaFinalizacao: null,
            assignedTo: null
        };
        if (DEBUG_MODE) console.log(`  > ACEITE: Tarefa criada para '${task.cliente}' com ID único: ${task.id}`);
        return task;
    }).filter(task => task);
}

processLocalSheetData();

app.get('/api/yesterday', (req, res) => res.json(yesterdayTasks));
app.get('/api/tomorrow', (req, res) => res.json(tomorrowTasks));
app.get('/api/gerar-relatorio', (req, res) => {
    try {
        const allKnownTasks = new Map();
        Object.values(historicoDeTarefas).forEach(task => allKnownTasks.set(task.id, task));
        yesterdayTasks.forEach(task => allKnownTasks.set(task.id, task));
        boardState.tasks.forEach(task => allKnownTasks.set(task.id, task));
        tomorrowTasks.forEach(task => allKnownTasks.set(task.id, task));
        const tasks = Array.from(allKnownTasks.values());
        const tasksByMonth = tasks.reduce((acc, task) => {
            if (!task || !task.dataCompleta) return acc;
            const monthYear = new Date(task.dataCompleta).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            if (!acc[monthYear]) acc[monthYear] = [];
            acc[monthYear].push({
                'Data': new Date(task.dataCompleta).toLocaleDateString('pt-BR'), 'Hora Agendada': task.horarioSugerido, 'Cliente': task.cliente, 'Tipo': task.tipo, 'Status': task.status, 'Nº Pedido': task.id, 'Hora de Início': task.horaEntrada ? new Date(task.horaEntrada).toLocaleTimeString('pt-BR') : 'N/A', 'Hora de Fim': task.horaFinalizacao ? new Date(task.horaFinalizacao).toLocaleTimeString('pt-BR') : 'N/A'
            });
            return acc;
        }, {});
        for (const monthYear in tasksByMonth) { tasksByMonth[monthYear].sort((a, b) => new Date(a.Data.split('/').reverse().join('-')) - new Date(b.Data.split('/').reverse().join('-'))); }
        const workbook = xlsx.utils.book_new();
        for (const monthYear in tasksByMonth) {
            const worksheet = xlsx.utils.json_to_sheet(tasksByMonth[monthYear]);
            const sheetName = monthYear.charAt(0).toUpperCase() + monthYear.slice(1);
            xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
        }
        const reportFileName = 'relatorio_mensal_completo.xlsx';
        const reportPath = process.env.RENDER ? path.join('/data', reportFileName) : reportFileName;
        xlsx.writeFile(workbook, reportPath);
        res.status(200).send(`Relatório "${reportFileName}" gerado com sucesso.`);
    } catch (error) {
        console.error("Erro ao gerar o relatório:", error);
        res.status(500).send("Ocorreu um erro ao gerar o relatório.");
    }
});

io.on('connection', (socket) => {
    console.log(`Um utilizador conectou-se: ${socket.id}`);
    socket.emit('board:init', boardState);
    socket.on('board:update', (newState) => {
        boardState = newState;
        salvarHistorico();
        socket.broadcast.emit('board:updated', newState);
    });
    socket.on('disconnect', () => { console.log(`Utilizador desconectou-se: ${socket.id}`); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor iniciado na porta ${PORT}`);
});

function getBoardData() {
    return {
        'CD1': { 'Módulo 1': [{ id: 'doca-1', numero: 'Doca 01', status: 'livre' }, { id: 'doca-2', numero: 'Doca 02', status: 'livre' }], 'Módulo 2': [{ id: 'doca-3', numero: 'Doca 03', status: 'livre' }] },
        'CD2': { 'Módulo 1': [{ id: 'doca-4', numero: 'Doca 04', status: 'livre' }, { id: 'doca-5', numero: 'Doca 05', status: 'livre' }] },
        'CD3': { 'Módulo 1': [{ id: 'doca-6', numero: 'Doca 06', status: 'livre' }], 'Módulo 2': [{ id: 'doca-7', numero: 'Doca 07', status: 'livre' }] }
    };
}
function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate();
}
