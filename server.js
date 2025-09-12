const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const xlsx = require('xlsx');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    } catch (error) {
        console.error("Erro ao salvar o histórico:", error);
    }
}

function processLocalSheetData() {
    try {
        const filePath = path.join(__dirname, 'agendamentos.xlsx');
        if (!fs.existsSync(filePath)) { return console.error(`ERRO: Ficheiro da planilha não encontrado em: ${filePath}`); }
        const workbook = xlsx.readFile(filePath, { cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const sheetTasks = parseSheetData(xlsx.utils.sheet_to_json(sheet));

        const allTasksMap = new Map(Object.entries(historicoDeTarefas));
        sheetTasks.forEach(task => {
            allTasksMap.set(task.id, task);
        });
        const allTasks = Array.from(allTasksMap.values());
        
        const hoje = new Date();
        const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
        const amanha = new Date(); amanha.setDate(hoje.getDate() + 1);

        const todayTasks = allTasks.filter(task => isSameDay(task.dataCompleta, hoje));
        yesterdayTasks = allTasks.filter(task => isSameDay(task.dataCompleta, ontem));
        tomorrowTasks = allTasks.filter(task => isSameDay(task.dataCompleta, amanha));
        
        boardState = { tasks: todayTasks, boardData: getBoardData() };
        console.log(`Dados processados: ${yesterdayTasks.length} de ontem, ${todayTasks.length} de hoje, ${tomorrowTasks.length} de amanhã.`);
    } catch (error) {
        console.error("ERRO ao ler a planilha local:", error.message);
    }
}

function parseSheetData(sheetData) {
    return sheetData.map((row) => {
        const upperCaseRow = {};
        for (const key in row) { upperCaseRow[key.toUpperCase().trim()] = row[key]; }
        const dataAgendamento = new Date(upperCaseRow['DATA_AGENDAMENTO']);
        if (!upperCaseRow['DATA_AGENDAMENTO'] || isNaN(dataAgendamento.getTime())) return null;
        const cliente = upperCaseRow['CLIENTE'];
        if (!cliente) return null;

        const rowAsString = JSON.stringify(row);
        const taskId = crypto.createHash('md5').update(rowAsString).digest('hex');

        const horas = String(dataAgendamento.getHours()).padStart(2, '0');
        const minutos = String(dataAgendamento.getMinutes()).padStart(2, '0');
        
        const taskNoHistorico = historicoDeTarefas[taskId];
        
        return {
            id: taskId,
            dataCompleta: dataAgendamento,
            pedido: upperCaseRow['NUMERO_PEDIDO'] || taskId,
            cliente: cliente,
            tipo: upperCaseRow['SERVIÇO'],
            horarioSugerido: `${horas}:${minutos}`,
            status: taskNoHistorico ? taskNoHistorico.status : 'Aguardando',
            horaEntrada: taskNoHistorico ? taskNoHistorico.horaEntrada : null,
            horaFinalizacao: taskNoHistorico ? taskNoHistorico.horaFinalizacao : null,
            assignedTo: taskNoHistorico ? taskNoHistorico.assignedTo : null
        };
    }).filter(task => task && task.cliente && task.tipo);
}

processLocalSheetData();
app.get('/api/yesterday', (req, res) => res.json(yesterdayTasks));
app.get('/api/tomorrow', (req, res) => res.json(tomorrowTasks));
app.get('/api/gerar-relatorio', (req, res) => { /* ... (código da função anterior) */ });
io.on('connection', (socket) => {
    socket.emit('board:init', boardState);
    socket.on('board:update', (newState) => {
        boardState = newState;
        salvarHistorico();
        socket.broadcast.emit('board:updated', newState);
    });
});
server.listen(process.env.PORT || 3000, () => { console.log(`Servidor iniciado.`); });
function getBoardData() { /* ... (código da função anterior) */ }
function isSameDay(date1, date2) { /* ... (código da função anterior) */ }
