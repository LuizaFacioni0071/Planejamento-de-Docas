const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const xlsx = require('xlsx');
const cors = require('cors');
const fs = require('fs'); // Biblioteca para interagir com ficheiros

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const HISTORICO_PATH = '/data/historico.json';
let historicoDeTarefas = carregarHistorico();

let boardState = { tasks: [], boardData: getBoardData() };
let yesterdayTasks = [];
let tomorrowTasks = [];

function carregarHistorico() {
    try {
        if (fs.existsSync(HISTORICO_PATH)) {
            const data = fs.readFileSync(HISTORICO_PATH);
            console.log("Ficheiro de histórico carregado com sucesso.");
            return JSON.parse(data);
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
        // Atualiza o histórico com as tarefas do estado atual
        boardState.tasks.forEach(task => {
            historicoDeTarefas[task.id] = task;
        });
        fs.writeFileSync(HISTORICO_PATH, JSON.stringify(historicoDeTarefas, null, 2));
        console.log("Histórico de tarefas salvo com sucesso.");
    } catch (error) {
        console.error("Erro ao salvar o histórico:", error);
    }
}

function processLocalSheetData() {
    try {
        console.log('--- A LER FICHEIRO LOCAL agendamentos.xlsx ---');
        const workbook = xlsx.readFile('agendamentos.xlsx', { cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const allTasksData = xlsx.utils.sheet_to_json(sheet);

        if (!allTasksData || allTasksData.length === 0) {
            console.log('Nenhum dado encontrado na planilha.');
            return;
        }

        const allTasks = parseSheetData(allTasksData);
        const hoje = new Date();
        const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
        const amanha = new Date(); amanha.setDate(hoje.getDate() + 1);

        const todayTasks = allTasks.filter(task => isSameDay(task.dataCompleta, hoje));
        todayTasks.forEach(task => {
            if (historicoDeTarefas[task.id]) {
                Object.assign(task, historicoDeTarefas[task.id]);
            }
        });
        
        yesterdayTasks = allTasks.filter(task => isSameDay(task.dataCompleta, ontem)).map(task => historicoDeTarefas[task.id] || task);
        tomorrowTasks = allTasks.filter(task => isSameDay(task.dataCompleta, amanha));
        
        boardState = { tasks: todayTasks, boardData: getBoardData() };
        console.log(`Dados processados: ${yesterdayTasks.length} de ontem, ${todayTasks.length} de hoje, ${tomorrowTasks.length} de amanhã.`);
    } catch (error) {
        console.error("ERRO ao ler a planilha local:", error.message);
    }
}

processLocalSheetData();

// --- ROTAS DE API ---
app.get('/api/yesterday', (req, res) => res.json(yesterdayTasks));
app.get('/api/tomorrow', (req, res) => res.json(tomorrowTasks));

app.get('/api/gerar-relatorio', (req, res) => {
    try {
        console.log("A gerar relatório mensal...");
        const tasks = Object.values(historicoDeTarefas);
        const tasksByMonth = tasks.reduce((acc, task) => {
            const monthYear = new Date(task.dataCompleta).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            if (!acc[monthYear]) acc[monthYear] = [];
            acc[monthYear].push({
                'Data': new Date(task.dataCompleta).toLocaleDateString('pt-BR'),
                'Hora Agendada': task.horarioSugerido,
                'Cliente': task.cliente,
                'Tipo': task.tipo,
                'Status': task.status,
                'Hora de Início': task.horaEntrada ? new Date(task.horaEntrada).toLocaleTimeString('pt-BR') : 'N/A',
                'Hora de Fim': task.horaFinalizacao ? new Date(task.horaFinalizacao).toLocaleTimeString('pt-BR') : 'N/A'
            });
            return acc;
        }, {});

        const workbook = xlsx.utils.book_new();
        for (const monthYear in tasksByMonth) {
            const worksheet = xlsx.utils.json_to_sheet(tasksByMonth[monthYear]);
            const sheetName = monthYear.charAt(0).toUpperCase() + monthYear.slice(1);
            xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
        }

        const reportFileName = 'relatorio_mensal.xlsx';
        xlsx.writeFile(workbook, reportFileName);
        
        console.log(`Relatório "${reportFileName}" gerado com sucesso.`);
        res.status(200).send(`Relatório "${reportFileName}" gerado com sucesso na pasta do servidor.`);
    } catch (error) {
        console.error("Erro ao gerar o relatório:", error);
        res.status(500).send("Ocorreu um erro ao gerar o relatório.");
    }
});

// Lógica de tempo real com Socket.IO
io.on('connection', (socket) => {
    console.log(`Um utilizador conectou-se: ${socket.id}`);
    socket.emit('board:init', boardState);
    socket.on('board:update', (newState) => {
        boardState = newState;
        salvarHistorico(); // Salva o estado sempre que houver uma atualização
        socket.broadcast.emit('board:updated', newState);
    });
    socket.on('disconnect', () => { console.log(`Utilizador desconectou-se: ${socket.id}`); });
});

server.listen(3000, () => { console.log('Servidor em tempo real iniciado na porta 3000.'); });

// --- FUNÇÕES AUXILIARES ---
function parseSheetData(sheetData) {
    return sheetData.map((row, index) => {
        const upperCaseRow = {};
        for (const key in row) { upperCaseRow[key.toUpperCase()] = row[key]; }
        const dataAgendamento = new Date(upperCaseRow['DATA_AGENDAMENTO']);
        if (!upperCaseRow['DATA_AGENDAMENTO'] || isNaN(dataAgendamento.getTime())) return null;
        const horas = String(dataAgendamento.getHours()).padStart(2, '0');
        const minutos = String(dataAgendamento.getMinutes()).padStart(2, '0');
        return {
            id: `task-${index + 1}`, dataCompleta: dataAgendamento, pedido: upperCaseRow['NUMERO_PEDIDO'] || `Agend. ${index + 1}`, cliente: upperCaseRow['CLIENTE'], tipo: upperCaseRow['SERVIÇO'], horarioSugerido: `${horas}:${minutos}`, status: 'Aguardando', horaEntrada: null, horaFinalizacao: null, assignedTo: null
        };
    }).filter(task => task && task.cliente && task.tipo);
}
function getBoardData() {
    return {
        'CD1': { 'Módulo 1': [{ id: 'doca-1', numero: 'Doca 01', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }, { id: 'doca-2', numero: 'Doca 02', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }], 'Módulo 2': [{ id: 'doca-3', numero: 'Doca 03', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }] },
        'CD2': { 'Módulo 1': [{ id: 'doca-4', numero: 'Doca 04', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }, { id: 'doca-5', numero: 'Doca 05', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }] },
        'CD3': { 'Módulo 1': [{ id: 'doca-6', numero: 'Doca 06', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }], 'Módulo 2': [{ id: 'doca-7', numero: 'Doca 07', status: 'livre', taskIdAtual: null, bloqueioManual: { ativo: false, motivo: '' } }] }
    };
}
function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate();
}