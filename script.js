document.addEventListener('DOMContentLoaded', () => {

    // --- LÓGICA DE NAVEGAÇÃO E BOTÕES ---
    const navLinks = document.querySelectorAll('.main-nav a');
    const views = document.querySelectorAll('.view');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetViewId = link.id.replace('nav-', 'view-');
            
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            views.forEach(view => {
                view.style.display = view.id === targetViewId ? 'flex' : 'none';
            });

            if (targetViewId === 'view-yesterday') fetchAndRenderYesterday();
            if (targetViewId === 'view-tomorrow') fetchAndRenderTomorrow();
        });
    });

    document.getElementById('generate-report-btn').addEventListener('click', async () => {
        try {
            const response = await fetch('http://localhost:3000/api/gerar-relatorio');
            const message = await response.text();
            alert(message);
        } catch (error) {
            console.error("Erro ao contactar a API de relatório:", error);
            alert("Falha ao gerar o relatório. Verifique a consola do servidor.");
        }
    });

    // --- LÓGICA DE TEMPO REAL PARA A TELA 'HOJE' ---
    const socket = io('http://localhost:3000');
    let tasks = [];
    let boardData = {};
    const timeSlots = [];
    for (let i = 0; i < 24; i++) {
        timeSlots.push(`${String(i).padStart(2, '0')}:00`);
    }
    let currentTaskInModal = null;

    socket.on('board:init', (initialState) => {
        tasks = initialState.tasks;
        boardData = initialState.boardData;
        renderBoard();
    });
    socket.on('board:updated', (newState) => {
        tasks = newState.tasks;
        boardData = newState.boardData;
        renderBoard();
    });
    
    // --- FUNÇÕES PARA BUSCAR E RENDERIZAR AS NOVAS TELAS ---
    async function fetchAndRenderYesterday() {
        try {
            const response = await fetch('http://localhost:3000/api/yesterday');
            const yesterdayTasks = await response.json();
            const container = document.getElementById('yesterday-content');
            container.innerHTML = `<div class="report-column"><h3>Finalizados</h3><div id="yesterday-finalizados"></div></div><div class="report-column"><h3>Pendentes</h3><div id="yesterday-pendentes"></div></div>`;
            const finalizadosContainer = document.getElementById('yesterday-finalizados');
            const pendentesContainer = document.getElementById('yesterday-pendentes');
            yesterdayTasks.forEach(task => {
                const item = document.createElement('div');
                item.className = 'report-item';
                item.innerHTML = `<p><strong>${task.cliente}</strong> (${task.tipo})</p>`;
                if (task.status === 'Finalizado') { finalizadosContainer.appendChild(item); } else { pendentesContainer.appendChild(item); }
            });
        } catch (error) { console.error("Erro ao buscar dados de ontem:", error); }
    }

    async function fetchAndRenderTomorrow() {
        try {
            const response = await fetch('http://localhost:3000/api/tomorrow');
            const tomorrowTasks = await response.json();
            const container = document.getElementById('tomorrow-content');
            container.innerHTML = `<div class="report-column"><h3>Agendamentos Confirmados</h3><div id="tomorrow-agendados"></div></div>`;
            const agendadosContainer = document.getElementById('tomorrow-agendados');
            tomorrowTasks.sort((a,b) => a.horarioSugerido.localeCompare(b.horarioSugerido));
            tomorrowTasks.forEach(task => {
                const item = document.createElement('div');
                item.className = 'report-item';
                item.innerHTML = `<p><strong>${task.horarioSugerido} - ${task.cliente}</strong> (${task.tipo})</p>`;
                agendadosContainer.appendChild(item);
            });
        } catch (error) { console.error("Erro ao buscar dados de amanhã:", error); }
    }

    // --- FUNÇÕES DE RENDERIZAÇÃO E LÓGICA DA TELA 'HOJE' ---
    const unassignedList = document.getElementById('unassigned-list');
    const dockBoard = document.getElementById('dock-board');
    const modal = document.getElementById('modal');
    const closeModalBtn = document.querySelector('.close-button');
    
    function renderBoard() {
        unassignedList.innerHTML = '';
        dockBoard.innerHTML = '';
        const unassignedTasks = tasks.filter(task => !task.assignedTo && task.status !== 'Finalizado');
        const tasksByTime = unassignedTasks.reduce((acc, task) => {
            const time = task.horarioSugerido;
            if (!acc[time]) acc[time] = []; acc[time].push(task); return acc;
        }, {});
        const sortedTimes = Object.keys(tasksByTime).sort((a, b) => a.localeCompare(b));
        sortedTimes.forEach(time => {
            const timeHeader = document.createElement('h3');
            timeHeader.className = 'time-group-header';
            timeHeader.textContent = time;
            unassignedList.appendChild(timeHeader);
            const timeGroupList = document.createElement('div');
            timeGroupList.className = 'task-list-group';
            tasksByTime[time].forEach(task => timeGroupList.appendChild(createTaskCard(task)));
            unassignedList.appendChild(timeGroupList);
        });
        const allDocks = Object.values(boardData).flatMap(cd => Object.values(cd).flatMap(mod => mod));
        allDocks.forEach(dock => {
            const dockColumn = document.createElement('div');
            dockColumn.className = 'dock-column';
            const location = findDockLocation(dock.id);
            const headerDiv = document.createElement('div');
            headerDiv.className = 'dock-column-header';
            headerDiv.innerHTML = `<span>${location.cd} - ${location.modulo}<br>${dock.numero}</span>`;
            dockColumn.appendChild(headerDiv);
            timeSlots.forEach(time => {
                const dropZone = document.createElement('div');
                dropZone.className = 'drop-zone';
                dropZone.dataset.dockId = dock.id;
                dropZone.dataset.time = time;
                const assignedTask = tasks.find(t => t.assignedTo?.dockId === dock.id && t.assignedTo?.time === time);
                if (assignedTask) { dropZone.appendChild(createTaskCard(assignedTask)); } else { dropZone.innerHTML = `<span class="time-watermark">${time}</span>`; }
                dockColumn.appendChild(dropZone);
            });
            dockBoard.appendChild(dockColumn);
        });
        renderFinalizados();
        initializeSortable();
    }

    function initializeSortable() {
        const draggableContainers = [...document.querySelectorAll('.task-list-group'), ...document.querySelectorAll('.drop-zone')];
        draggableContainers.forEach(container => {
            if(container.sortableInstance) container.sortableInstance.destroy(); // Evita múltiplas inicializações
            container.sortableInstance = new Sortable(container, {
                group: 'shared', animation: 150, filter: '.time-watermark',
                onEnd: (evt) => {
                    const taskId = evt.item.id;
                    const targetContainer = evt.to;
                    const task = findTaskById(taskId);
                    if (!task) return;
                    if (targetContainer.classList.contains('drop-zone')) {
                        const targetDockId = targetContainer.dataset.dockId;
                        const targetTime = targetContainer.dataset.time;
                        const dock = findDockById(targetDockId);
                        if (dock.status !== 'livre') { renderBoard(); return; }
                        if (task.assignedTo) { const oldDock = findDockById(task.assignedTo.dockId); if (oldDock) { oldDock.status = 'livre'; oldDock.taskIdAtual = null; } }
                        task.assignedTo = { dockId: targetDockId, time: targetTime };
                        task.status = 'Agendado';
                        dock.status = 'ocupada';
                        dock.taskIdAtual = task.id;
                    } else {
                        if (task.assignedTo) { const oldDock = findDockById(task.assignedTo.dockId); if (oldDock) { oldDock.status = 'livre'; oldDock.taskIdAtual = null; } }
                        task.assignedTo = null;
                        task.status = 'Aguardando';
                    }
                    socket.emit('board:update', { tasks, boardData });
                    renderBoard();
                }
            });
        });
        document.querySelectorAll('.task-card').forEach(card => {
            card.addEventListener('click', () => openModal(findTaskById(card.id)));
        });
        document.querySelectorAll('.no-show-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = e.target.dataset.taskId;
                const task = findTaskById(taskId);
                if (task && confirm(`Tem a certeza que deseja marcar o agendamento de "${task.cliente}" como NÃO COMPARECEU?`)) {
                    task.status = 'Não Compareceu';
                    socket.emit('board:update', { tasks, boardData });
                    renderBoard();
                }
            });
        });
    }

    function renderFinalizados() {
        const finalList = document.getElementById('agenda-list');
        finalList.innerHTML = '';
        const finalizadosTasks = tasks.filter(task => task.status === 'Finalizado').sort((a, b) => new Date(b.horaFinalizacao) - new Date(a.horaFinalizacao));
        if (finalizadosTasks.length === 0) { finalList.innerHTML = '<p>Nenhum processo finalizado hoje.</p>'; } else {
            finalizadosTasks.forEach(task => {
                const finalItem = document.createElement('div');
                finalItem.className = `agenda-item ${task.tipo.toLowerCase()}`;
                const horaInicio = new Date(task.horaEntrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const horaFinal = new Date(task.horaFinalizacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                finalItem.innerHTML = `<p class="agenda-item-header">${task.cliente}</p><p><strong>Início:</strong> ${horaInicio}</p><p><strong>Finalizado:</strong> ${horaFinal}</p>`;
                finalList.appendChild(finalItem);
            });
        }
    }

    function createTaskCard(task) {
        const card = document.createElement('div');
        const statusClass = task.status === 'Não Compareceu' ? 'no-show' : '';
        card.className = `task-card ${task.tipo ? task.tipo.toLowerCase() : ''} ${statusClass}`;
        card.id = task.id;
        let actionButton = '';
        if (!task.assignedTo && task.status === 'Aguardando') {
            actionButton = `<div class="card-actions"><button class="no-show-btn" data-task-id="${task.id}">Não Compareceu</button></div>`;
        }
        card.innerHTML = `<p class="task-client">${task.cliente}</p><p class="task-details"><strong>${task.tipo}</strong></p><p class="task-suggestion">Agendado para: <strong>${task.horarioSugerido}</strong></p>${actionButton}`;
        return card;
    }

    function openModal(task) {
        if (!task) return;
        currentTaskInModal = task;
        document.getElementById('modal-cliente').textContent = task.cliente;
        document.getElementById('modal-pedido').textContent = task.pedido;
        document.getElementById('modal-status').textContent = task.status;
        document.getElementById('modal-entrada').textContent = task.horaEntrada ? new Date(task.horaEntrada).toLocaleString('pt-BR') : 'N/A';
        document.getElementById('modal-finalizacao').textContent = task.horaFinalizacao ? new Date(task.horaFinalizacao).toLocaleString('pt-BR') : 'N/A';
        modal.style.display = 'block';
    }

    function closeModalAndRefresh() {
        modal.style.display = 'none';
        currentTaskInModal = null;
    }

    closeModalBtn.onclick = closeModalAndRefresh;
    window.onclick = e => { if (e.target == modal) closeModalAndRefresh(); };

    document.getElementById('start-process-btn').addEventListener('click', () => {
        if (currentTaskInModal && currentTaskInModal.assignedTo) {
            currentTaskInModal.status = 'Em Processo';
            currentTaskInModal.horaEntrada = new Date();
            socket.emit('board:update', { tasks, boardData });
            closeModalAndRefresh();
            renderBoard();
        } else { alert('Um pedido precisa ser alocado a uma doca para ser iniciado.'); }
    });

    document.getElementById('end-process-btn').addEventListener('click', () => {
        if (currentTaskInModal && currentTaskInModal.status === 'Em Processo') {
            currentTaskInModal.status = 'Finalizado';
            currentTaskInModal.horaFinalizacao = new Date();
            if (currentTaskInModal.assignedTo) {
                const dock = findDockById(currentTaskInModal.assignedTo.dockId);
                if (dock) { dock.status = 'livre'; dock.taskIdAtual = null; }
            }
            currentTaskInModal.assignedTo = null;
            socket.emit('board:update', { tasks, boardData });
            closeModalAndRefresh();
            renderBoard();
        } else { alert('O processo precisa ser iniciado antes de ser finalizado.'); }
    });

    function findTaskById(taskId) { return tasks.find(task => task.id === taskId); }
    function findDockLocation(dockId) { for (const cdName in boardData) { for (const moduleName in boardData[cdName]) { if (boardData[cdName][moduleName].some(d => d.id === dockId)) { return { cd: cdName, modulo: moduleName }; } } } return { cd: 'N/A', modulo: 'N/A' }; }
    function findDockById(dockId) { for (const cd of Object.values(boardData)) { for (const modulo of Object.values(cd)) { const found = modulo.find(d => d.id === dockId); if (found) return found; } } return null; }
    
    const slider = document.querySelector('.dock-board-container');
    let isDown = false;
    let startX;
    let scrollLeft;
    if (slider) {
        slider.addEventListener('mousedown', (e) => {
            if (e.target.closest('.task-card')) return;
            isDown = true; slider.classList.add('active'); startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft;
        });
        slider.addEventListener('mouseleave', () => { isDown = false; slider.classList.remove('active'); });
        slider.addEventListener('mouseup', () => { isDown = false; slider.classList.remove('active'); });
        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2;
            slider.scrollLeft = scrollLeft - walk;
        });
    }
});