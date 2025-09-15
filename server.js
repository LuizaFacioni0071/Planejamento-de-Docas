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
            return historico;
        }
        return {};
    } catch (error) { return {}; }
}

function salvarEstado() {
    try {
        const estadoParaSalvar = { ...historicoDeTarefas };
        boardState.tasks.forEach(task => { estadoParaSalvar[task.id] = task; });
        fs.writeFileSync(HISTORICO_PATH, JSON.stringify(estadoParaSalvar, null, 2));
    } catch (error) { console.error("Erro ao salvar o histórico:", error); }
}

function carregarDadosDoDia() {
    try {
        const filePath = path.join(__dirname, 'agendamentos.xlsx');
        let allTasks = [];
        if (fs.existsSync(filePath)) {
            const workbook = xlsx.readFile(filePath, { cellDates: true });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const sheetTasks = parseSheetData(xlsx.utils.sheet_to_json(sheet));
            const allTasksMap = new Map(Object.entries(historicoDeTarefas));
            sheetTasks.forEach(task => {
                const taskExistente = allTasksMap.get(task.id);
                if (taskExistente) {
                    allTasksMap.set(task.id, { ...task, ...taskExistente, dataCompleta: task.dataCompleta });
                } else {
                    allTasksMap.set(task.id, task);
                }
            });
            allTasks = Array.from(allTasksMap.values());
        } else {
            allTasks = Object.values(historicoDeTarefas);
        }
        
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
        const dataAgendamento = new Date(upperCaseRow['DATA DE AGENDAMENTO']);
        if (!upperCaseRow['DATA DE AGENDAMENTO'] || isNaN(dataAgendamento.getTime())) return null;
        const cliente = upperCaseRow['CLIENTE'];
        if (!cliente) return null;
        const rowAsString = JSON.stringify(row);
        const taskId = crypto.createHash('md5').update(rowAsString).digest('hex');
        const taskNoHistorico = historicoDeTarefas[taskId];
        return {
            id: taskId,
            dataCompleta: dataAgendamento,
            cliente: cliente,
            tipo: upperCaseRow['SERVIÇO'],
            horarioSugerido: new Date(dataAgendamento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit'}),
            status: taskNoHistorico ? taskNoHistorico.status : 'Aguardando',
            horaEntrada: taskNoHistorico ? taskNoHistorico.horaEntrada : null,
            horaFinalizacao: taskNoHistorico ? taskNoHistorico.horaFinalizacao : null,
            assignedTo: taskNoHistorico ? taskNoHistorico.assignedTo : null,
            subType: upperCaseRow['REGIME'] || 'N/A',
            isPalletized: String(upperCaseRow['TIPO DE CARGA']).trim().toLowerCase() === 'paletizada',
        };
    }).filter(task => task);
}

carregarDadosDoDia();

app.get('/api/yesterday', (req, res) => res.json(yesterdayTasks));
app.get('/api/tomorrow', (req, res) => res.json(tomorrowTasks));

io.on('connection', (socket) => {
    socket.emit('board:init', boardState);
    socket.on('board:update', (newState) => {
        boardState = newState;
        salvarEstado();
        io.emit('board:updated', boardState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Servidor iniciado na porta ${PORT}`); });

function getBoardData() {
    const docks = [];
    for (let i = 1; i <= 24; i++) {
        docks.push({ id: `doca-${i}`, numero: `Doca ${String(i).padStart(2, '0')}`, status: 'livre', bloqueioManual: { ativo: false, motivo: '' } });
    }
    return { 'ALF': { 'Docas': docks } };
}
function isSameDay(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1.getFullYear() === date2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

