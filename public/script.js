document.addEventListener('DOMContentLoaded', () => {
    // ESTADO GLOBAL
    let currentView = 'today';
    let allTasks = [];
    let boardData = {};
    let currentTaskInModal = null;
    const socket = io();
    const isMobile = window.innerWidth <= 768;

    // ELEMENTOS DO DOM
    const appContainer = document.getElementById('app-container');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const overlay = document.getElementById('overlay');
    const modal = document.getElementById('modal');

    // CONEXÃO SOCKET.IO
    socket.on('board:init', (initialState) => {
        allTasks = initialState.tasks || [];
        boardData = initialState.boardData || {};
        updateView();
    });
    socket.on('board:updated', (newState) => {
        allTasks = newState.tasks || [];
        boardData = newState.boardData || {};
        updateView();
    });

    // NAVEGAÇÃO
    function setupDayNavigation() {}

    const mainNavDesktop = document.getElementById('main-nav-desktop');
    if (mainNavDesktop) {
        mainNavDesktop.addEventListener('click', handleNavClick);
    }
    const mobileNavContent = document.getElementById('mobile-menu-content');
    if (mobileNavContent) {
        mobileNavContent.addEventListener('click', handleNavClick);
    }

    function handleNavClick(e) {
        const navLink = e.target.closest('a');
        if (navLink) {
            e.preventDefault();
            currentView = navLink.id.replace('nav-', '');
            updateView();
            closeMobileMenu();
        }
    }

    // FUNÇÃO "ROUTER" PRINCIPAL
    function updateView() {
        renderMobileNav();
        document.querySelectorAll('.main-nav a, #mobile-menu-content a').forEach(l => l.classList.remove('active'));
        document.querySelectorAll(`#nav-${currentView}`).forEach(l => l.classList.add('active'));

        const hoje = new Date();
        const todayTasks = allTasks.filter(task => isSameDay(new Date(task.dataCompleta), hoje));
        
        if (currentView === 'today') {
            if (isMobile) {
                renderMobileTodayView(todayTasks);
            } else {
                renderDesktopTodayView(todayTasks);
            }
        } else {
            renderReportView(currentView);
        }
    }
    
    // RENDERIZAÇÃO PC
    function renderDesktopTodayView(tasks) {
        appContainer.innerHTML = `<main id="view-today" class="container view">
            <div id="unassigned-tasks" class="unassigned-container"><h2>Pedidos do Dia</h2><div id="unassigned-list" class="task-list"></div></div>
            <div id="patio-container" class="unassigned-container"><h2>Pátio</h2><div id="patio-list" class="task-list"></div></div>
            <div id="dock-board" class="dock-board-container"></div>
            <div id="daily-agenda" class="daily-agenda-container"><h2>Finalizados do Dia</h2><div id="agenda-list" class="agenda-list"></div></div>
        </main>`;
        
        renderPendingTasks(tasks, document.getElementById('unassigned-list'));
        renderPatioTasks(tasks, document.getElementById('patio-list'));
        renderDockBoard(tasks, document.getElementById('dock-board'));
        renderFinalizados(tasks, document.getElementById('agenda-list'));
        initializeDesktopInteractions();
    }
    
    // RENDERIZAÇÃO TELEMÓVEL SEM ABAS
    function renderMobileTodayView(tasks) {
        appContainer.innerHTML = `
            <main id="view-today" class="container view">
                <div id="content-pedidos" class="unassigned-container">
                    <h2>Pedidos do Dia</h2>
                    <div class="task-list"></div>
                </div>
                <div id="content-docas" class="dock-board-container">
                    </div>
                <div id="content-finalizados" class="daily-agenda-container">
                    <h2>Finalizados do Dia</h2>
                    <div class="agenda-list"></div>
                </div>
            </main>`;
        renderPendingTasks(tasks, document.querySelector('#content-pedidos .task-list'));
        renderDockBoard(tasks, document.getElementById('content-docas'));
        renderFinalizados(tasks, document.querySelector('#content-finalizados .agenda-list'));
        initializeMobileInteractions();
    }

    async function renderReportView(day) {
        const viewTitle = day === 'yesterday' ? 'Resumo de Ontem' : 'Previsão de Amanhã';
        appContainer.innerHTML = `<main class="container-simple view"><h2>${viewTitle}</h2><div id="report-content" class="report-container"><p>A carregar dados...</p></div></main>`;
        try {
            const response = await fetch(`/api/${day}`);
            if (!response.ok) throw new Error('Falha ao buscar dados.');
            const reportTasks = await response.json() || [];
            const container = document.getElementById('report-content');
            container.innerHTML = '';
            if (reportTasks.length === 0) { container.innerHTML = `<p>Nenhum agendamento encontrado.</p>`; return; }
            if (day === 'yesterday') {
                container.innerHTML = `<div class="report-column"><h3>Finalizados</h3><div id="yesterday-finalizados"></div></div><div class="report-column"><h3>Pendentes</h3><div id="yesterday-pendentes"></div></div>`;
                const finalizadosContainer = document.getElementById('yesterday-finalizados');
                const pendentesContainer = document.getElementById('yesterday-pendentes');
                reportTasks.forEach(task => {
                    const item = document.createElement('div');
                    item.className = 'report-item';
                    item.innerHTML = `<p><strong>${task.cliente}</strong> (${task.tipo}) - Status: ${task.status}</p>`;
                    if (task.status === 'Finalizado') finalizadosContainer.appendChild(item);
                    else pendentesContainer.appendChild(item);
                });
            } else { // tomorrow
                container.innerHTML = `<div class="report-column"><h3>Agendamentos Confirmados</h3><div id="tomorrow-agendados"></div></div>`;
                const agendadosContainer = document.getElementById('tomorrow-agendados');
                reportTasks.sort((a,b) => a.horarioSugerido.localeCompare(b.horarioSugerido));
                reportTasks.forEach(task => {
                    const item = document.createElement('div');
                    item.className = 'report-item';
                    item.innerHTML = `<p><strong>${task.horarioSugerido} - ${task.cliente}</strong> (${task.tipo})</p>`;
                    agendadosContainer.appendChild(item);
                });
            }
        } catch (error) { document.getElementById('report-content').innerHTML = `<p>Ocorreu um erro ao carregar os dados.</p>`; }
    }
    
    function renderPendingTasks(tasks, container) {
        if (!container) return;
        container.innerHTML = ''; // Limpa a lista para renderização
        const unassignedTasks = tasks.filter(task => (task.status === 'Aguardando' || task.status === 'Não Compareceu'));
        const tasksByTime = unassignedTasks.reduce((acc, task) => { const time = task.horarioSugerido; if (!acc[time]) acc[time] = []; acc[time].push(task); return acc; }, {});
        const sortedTimes = Object.keys(tasksByTime).sort((a, b) => a.localeCompare(b));
        sortedTimes.forEach(time => {
            const timeHeader = document.createElement('h3');
            timeHeader.className = 'time-group-header';
            timeHeader.textContent = time;
            container.appendChild(timeHeader);
            const timeGroupList = document.createElement('div');
            timeGroupList.className = 'task-list-group';
            tasksByTime[time].forEach(task => timeGroupList.appendChild(createTaskCard(task)));
            container.appendChild(timeGroupList);
        });
    }

    function renderPatioTasks(tasks, container) {
        if (!container) return;
        container.innerHTML = ''; 
        const patioTasks = tasks.filter(task =>
            (task.status === 'No Pátio') ||
            (task.status === 'Em Processo' && !task.assignedTo) ||
            (task.status === 'Finalizado' && !task.assignedTo)
        );

        patioTasks.sort((a, b) => {
            if (a.status === 'Finalizado' && b.status !== 'Finalizado') return 1;
            if (a.status !== 'Finalizado' && b.status === 'Finalizado') return -1;
            return a.cliente.localeCompare(b.cliente);
        });

        patioTasks.forEach(task => {
            container.appendChild(createTaskCard(task));
        });
    }

    function renderDockBoard(tasks, container) {
        if (!container) return;
        container.innerHTML = '';

        if (isMobile) {
            const patioProcessTasks = tasks.filter(task => (task.status === 'No Pátio') || (task.status === 'Em Processo' && !task.assignedTo));
            if (patioProcessTasks.length > 0) {
                const patioColumn = document.createElement('div');
                patioColumn.className = 'dock-column patio-process-column';
                const headerDiv = document.createElement('div');
                headerDiv.className = 'dock-column-header';
                headerDiv.innerHTML = `<span>Pátio</span>`;
                patioColumn.appendChild(headerDiv);

                const listDiv = document.createElement('div');
                listDiv.className = 'patio-process-list';
                patioProcessTasks.forEach(task => {
                    listDiv.appendChild(createTaskCard(task));
                });
                patioColumn.appendChild(listDiv);
                container.appendChild(patioColumn);
            }
        }

        const allDocks = Object.values(boardData).flatMap(cd => Object.values(cd).flatMap(mod => mod));
        allDocks.forEach(dock => {
            const dockColumn = document.createElement('div');
            dockColumn.className = 'dock-column';
            const headerDiv = document.createElement('div');
            headerDiv.className = 'dock-column-header';
            headerDiv.innerHTML = `<span>${dock.numero}</span><button class="block-btn ${dock.status === 'bloqueada' ? 'blocked' : ''}" data-dock-id="${dock.id}">${dock.status === 'bloqueada' ? 'Desbloquear' : 'Bloquear'}</button>`;
            dockColumn.appendChild(headerDiv);
            for (let i = 0; i < 24; i++) {
                const time = `${String(i).padStart(2, '0')}:00`;
                const assignedTask = tasks.find(t => t.assignedTo?.dockId === dock.id && t.assignedTo?.time === time);
                let cell;
                if (assignedTask && assignedTask.status === 'Finalizado') {
                    cell = document.createElement('div');
                    cell.className = 'finalized-slot';
                    cell.appendChild(createTaskCard(assignedTask));
                } else {
                    cell = document.createElement('div');
                    cell.className = 'drop-zone';
                    cell.dataset.dockId = dock.id;
                    cell.dataset.time = time;
                    if (assignedTask) { cell.appendChild(createTaskCard(assignedTask)); } 
                    else { cell.innerHTML = `<span class="time-watermark">${time}</span>`; }
                }
                dockColumn.appendChild(cell);
            }
            container.appendChild(dockColumn);
        });
    }

    function renderFinalizados(tasks, container) {
        if (!container) return;
        container.innerHTML = ''; // Limpa a lista para renderização
        const finalizadosTasks = tasks.filter(task => task.status === 'Finalizado').sort((a, b) => new Date(b.horaFinalizacao) - new Date(a.horaFinalizacao));
        if (finalizadosTasks.length === 0) { container.innerHTML = '<p>Nenhum processo finalizado hoje.</p>'; } 
        else {
            finalizadosTasks.forEach(task => {
                const finalItem = document.createElement('div');
                finalItem.className = `agenda-item ${task.tipo.toLowerCase()}`;
                const horaInicio = task.horaEntrada ? new Date(task.horaEntrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
                const horaFinal = task.horaFinalizacao ? new Date(task.horaFinalizacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
                finalItem.innerHTML = `<p class="agenda-item-header">${task.cliente}</p><p><strong>Início:</strong> ${horaInicio}</p><p><strong>Finalizado:</strong> ${horaFinal}</p>`;
                container.appendChild(finalItem);
            });
        }
    }

    function createTaskCard(task) {
        const card = document.createElement('div');
        let statusClass = '';
        if (task.status === 'Não Compareceu') statusClass = 'no-show non-draggable';
        if (task.status === 'Finalizado') statusClass += ' finalizado-na-grelha non-draggable';
        if (task.status === 'Em Processo') statusClass += ' in-process';
        card.className = `task-card ${task.tipo ? task.tipo.toLowerCase() : ''} ${statusClass}`;
        card.id = task.id;
        const checkIcon = task.status === 'Finalizado' ? `<i class="fa-solid fa-circle-check check-icon"></i>` : '';
        let timestamps = '';
        if (task.horaEntrada) {
            const inicio = new Date(task.horaEntrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const fim = task.horaFinalizacao ? new Date(task.horaFinalizacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '...';
            timestamps = `<p class="card-timestamps">Início: ${inicio} | Fim: ${fim}</p>`;
        }
        let actionButton = '';
        if (!task.assignedTo && task.status === 'Aguardando') {
            actionButton = `<div class="card-actions"><button class="no-show-btn" data-task-id="${task.id}">Não Compareceu</button></div>`;
        }
        const metaDetails = `<p class="task-meta-details">${task.subType} | ${task.isPalletized ? 'Paletizado' : 'Não-Paletizado'}</p>`;
        card.innerHTML = `${checkIcon}<div class="card-body"><p class="task-client">${task.cliente}</p><p class="task-details"><strong>${task.tipo}</strong></p>${metaDetails}<p class="task-suggestion">Agendado para: <strong>${task.horarioSugerido}</strong></p></div>${timestamps}${actionButton}`;
        return card;
    }

    // INTERAÇÕES DESKTOP
    function initializeDesktopInteractions() {
        const draggableContainers = [...document.querySelectorAll('.task-list-group'), ...document.querySelectorAll('#patio-list'), ...document.querySelectorAll('.drop-zone')];
        draggableContainers.forEach(container => {
            if (container.sortableInstance) container.sortableInstance.destroy();
            container.sortableInstance = new Sortable(container, {
                group: 'shared', animation: 150, filter: '.non-draggable',
                onEnd: (evt) => {
                    const taskId = evt.item.id;
                    const task = findTaskById(taskId);
                    if (!task) return;

                    if (task.assignedTo) {
                        const oldDock = findDockById(task.assignedTo.dockId);
                        if (oldDock) {
                            oldDock.status = 'livre';
                            oldDock.taskIdAtual = null;
                        }
                    }
                    
                    const targetContainer = evt.to;
                    
                    if (targetContainer.classList.contains('drop-zone')) {
                        const targetDockId = targetContainer.dataset.dockId;
                        const dock = findDockById(targetDockId);
                        if (dock.status !== 'livre') {
                            alert(`A doca ${dock.numero} não está disponível (Status: ${dock.status}).`);
                            socket.emit('board:update', { tasks: allTasks, boardData }); 
                            return;
                        }
                        task.assignedTo = { dockId: targetDockId, time: targetContainer.dataset.time };
                        task.status = 'Agendado';
                        dock.status = 'ocupada';
                        dock.taskIdAtual = task.id;
                    } else {
                        task.assignedTo = null;
                        if (targetContainer.closest('#patio-container')) {
                            task.status = 'No Pátio';
                        } else {
                            task.status = 'Aguardando';
                        }
                    }
                    socket.emit('board:update', { tasks: allTasks, boardData });
                }
            });
        });
        document.querySelectorAll('.task-card').forEach(card => {
            card.addEventListener('click', (e) => { if (e.target.closest('button')) return; openModal('details', card.id); });
        });
        document.querySelectorAll('.no-show-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = e.target.dataset.taskId;
                const task = findTaskById(taskId);
                if (task && confirm(`Marcar "${task.cliente}" como NÃO COMPARECEU?`)) {
                    task.status = 'Não Compareceu';
                    socket.emit('board:update', { tasks: allTasks, boardData });
                }
            });
        });
        document.querySelectorAll('.block-btn').forEach(button => {
             button.addEventListener('click', handleBlockButtonClick);
        });
    }
    
    // MODIFICADO: Lógica de clique restaurada e corrigida
    function initializeMobileInteractions() {
        // Listener específico para cards na lista de "Pedidos" -> ABRE O MODAL DE AGENDAMENTO
        document.querySelectorAll('#content-pedidos .task-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                // Como este container só tem tarefas 'Aguardando', podemos chamar diretamente.
                openScheduleModal(card.id);
            });
        });

        // Listener para cards nas docas e na coluna Pátio (móvel) -> ABRE O MODAL DE DETALHES
        document.querySelectorAll('#content-docas .task-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                openModal('details', card.id);
            });
        });
        
        // Listener para itens finalizados (sem ação por enquanto)
        document.querySelectorAll('#content-finalizados .agenda-item').forEach(card => {
            // Nenhum evento de clique por enquanto, mas pode ser adicionado aqui
        });

        // Listeners gerais para outros botões
        document.querySelectorAll('.block-btn').forEach(button => {
             button.addEventListener('click', handleBlockButtonClick);
        });
    }
    
    // LÓGICA DO MODAL
    function openModal(type, taskId) {
        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = '';
        const task = findTaskById(taskId);
        if (!task) return;
        currentTaskInModal = task;
        modalContent.innerHTML = `
            <span class="close-button">&times;</span><h2>Detalhes do Processo</h2>
            <div class="form-container">
                <p><strong>Cliente:</strong> ${task.cliente}</p><p><strong>Tipo:</strong> ${task.tipo}</p>
                <p><strong>Regime:</strong> ${task.subType}</p><p><strong>Tipo de Carga:</strong> ${task.isPalletized ? 'Paletizado' : 'Não-Paletizado'}</p>
                <p><strong>Status:</strong> ${task.status}</p>
                <p><strong>Início do Processo:</strong> ${task.horaEntrada ? new Date(task.horaEntrada).toLocaleString('pt-BR') : 'N/A'}</p>
                <p><strong>Finalização:</strong> ${task.horaFinalizacao ? new Date(task.horaFinalizacao).toLocaleString('pt-BR') : 'N/A'}</p>
            </div>
            <div class="modal-actions">
                <button id="start-process-btn">Iniciar Processo</button><button id="end-process-btn">Finalizar Processo</button>
            </div>`;
        modalContent.querySelector('.close-button').addEventListener('click', closeModal);
        document.getElementById('start-process-btn').addEventListener('click', handleStartProcess);
        document.getElementById('end-process-btn').addEventListener('click', handleEndProcess);
        modal.style.display = 'block';
    }
    
    function openScheduleModal(taskId) {
        const task = findTaskById(taskId);
        if (!task) return;
        currentTaskInModal = task;
        const modalContent = document.getElementById('modal-content');

        let optionsHTML = `<button class="schedule-option-btn schedule-patio-btn" data-task-id="${taskId}" data-destination="patio"><strong>Pátio</strong></button>`;

        const now = new Date();
        const allDocks = Object.values(boardData).flatMap(cd => Object.values(cd).flatMap(mod => mod));
        
        allDocks.forEach(dock => {
            if (dock.status === 'livre' && !dock.bloqueioManual?.ativo) {
                for (let i = now.getHours(); i < 24; i++) {
                    const time = `${String(i).padStart(2, '0')}:00`;
                    const isOccupied = allTasks.some(t => t.assignedTo?.dockId === dock.id && t.assignedTo?.time === time);
                    if (!isOccupied) {
                        optionsHTML += `<button class="schedule-option-btn" data-task-id="${taskId}" data-dock-id="${dock.id}" data-time="${time}"><strong>${dock.numero}</strong> - Agendar às ${time}</button>`;
                        break;
                    }
                }
            }
        });

        modalContent.innerHTML = `
            <span class="close-button">&times;</span>
            <h3>Agendar ${task.cliente}</h3>
            <div class="schedule-options-list">
                ${optionsHTML}
            </div>`;
        
        modalContent.querySelector('.close-button').addEventListener('click', closeModal);

        modalContent.querySelectorAll('.schedule-option-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const { taskId, destination, dockId, time } = e.currentTarget.dataset;
                const taskToUpdate = findTaskById(taskId);
                if (!taskToUpdate) return;

                if (destination === 'patio') {
                    taskToUpdate.status = 'No Pátio';
                    taskToUpdate.assignedTo = null;
                } else if (dockId && time) {
                    const dockToSchedule = findDockById(dockId);
                    if (dockToSchedule) {
                        taskToUpdate.assignedTo = { dockId, time };
                        taskToUpdate.status = 'Agendado';
                        dockToSchedule.status = 'ocupada';
                        dockToSchedule.taskIdAtual = taskId;
                    }
                }
                
                socket.emit('board:update', { tasks: allTasks, boardData });
                closeModal();
            });
        });

        modal.style.display = 'block';
    }


    function closeModal() { modal.style.display = 'none'; currentTaskInModal = null; }
    
    function handleStartProcess() {
        const task = currentTaskInModal;
        if (task && (task.status === 'Agendado' || task.status === 'No Pátio')) {
            task.status = 'Em Processo';
            task.horaEntrada = new Date();
            socket.emit('board:update', { tasks: allTasks, boardData });
            closeModal();
        } else { alert('A tarefa precisa estar "Agendada" ou "No Pátio" para ser iniciada.'); }
    }

    function handleEndProcess() {
        const task = currentTaskInModal;
        if (task && task.status === 'Em Processo') {
            task.status = 'Finalizado';
            task.horaFinalizacao = new Date();
            if (task.assignedTo) {
                const dock = findDockById(task.assignedTo.dockId);
                if (dock) { 
                    dock.status = 'livre'; 
                    dock.taskIdAtual = null; 
                }
            }
            socket.emit('board:update', { tasks: allTasks, boardData });
            closeModal();
        } else { alert('A tarefa precisa estar "Em Processo" para ser finalizada.'); }
    }

    function handleBlockButtonClick(e) {
        const dockId = e.target.dataset.dockId;
        const dock = findDockById(dockId);
        if (!dock) return;
        if (dock.bloqueioManual?.ativo) {
            dock.bloqueioManual = { ativo: false, motivo: '' };
            dock.status = 'livre';
        } else {
            if (dock.status !== 'livre') { alert('A doca precisa estar "livre" para ser bloqueada.'); return; }
            const motivo = prompt('Motivo do bloqueio?');
            if (motivo) { dock.bloqueioManual = { ativo: true, motivo: motivo }; dock.status = 'bloqueada'; }
        }
        socket.emit('board:update', { tasks: allTasks, boardData });
    }
    
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    
    // LÓGICA DO MENU MÓVEL
    function renderMobileNav() {
        const mobileNav = document.getElementById('mobile-menu-content');
        mobileNav.innerHTML = `<a href="#" id="nav-yesterday">Resumo de Ontem</a><a href="#" id="nav-today">Planejamento de Hoje</a><a href="#" id="nav-tomorrow">Previsão de Amanhã</a>`;
        setupDayNavigation();
    }
    function openMobileMenu() { mobileMenu.classList.add('open'); overlay.classList.add('open'); }
    function closeMobileMenu() { mobileMenu.classList.remove('open'); overlay.classList.remove('open'); }
    hamburgerBtn.addEventListener('click', openMobileMenu);
    closeMenuBtn.addEventListener('click', closeMenuBtn);
    overlay.addEventListener('click', closeMobileMenu);

    // FUNÇÕES AUXILIARES
    function findTaskById(id) { return allTasks.find(task => task.id === id); }
    function findDockById(id) { return Object.values(boardData).flatMap(cd => Object.values(cd).flatMap(mod => mod)).find(d => d.id === id); }
    function isSameDay(date1, date2) { return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate(); }
    
    // INICIALIZAÇÃO DA NAVEGAÇÃO
    const mainNav = document.getElementById('main-nav-desktop');
    if (mainNav) mainNav.addEventListener('click', handleNavClick);
    const mobileNav = document.getElementById('mobile-menu-content');
    if (mobileNav) mobileNav.addEventListener('click', handleNavClick);
});
