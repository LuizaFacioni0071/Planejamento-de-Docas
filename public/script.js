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
    function setupDayNavigation() {
        const dayNavLinks = document.querySelectorAll('.main-nav a, #mobile-menu-content a');
        dayNavLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                currentView = link.id.replace('nav-', '');
                updateView();
                closeMobileMenu();
            });
        });
    }

    const mainNavDesktop = document.getElementById('main-nav-desktop');
    if (mainNavDesktop) {
        mainNavDesktop.addEventListener('click', (e) => {
            const navLink = e.target.closest('a');
            if (navLink) {
                e.preventDefault();
                currentView = navLink.id.replace('nav-', '');
                updateView();
            }
        });
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
        appContainer.innerHTML = `<main id="view-today" class="container view"><div id="unassigned-tasks" class="unassigned-container"><h2>Pedidos do Dia</h2><div id="unassigned-list" class="task-list"></div></div><div id="dock-board" class="dock-board-container"></div><div id="daily-agenda" class="daily-agenda-container"><h2>Finalizados do Dia</h2><div id="agenda-list" class="agenda-list"></div></div></main>`;
        renderPendingTasks(tasks, document.getElementById('unassigned-list'));
        renderDockBoard(tasks, document.getElementById('dock-board'));
        renderFinalizados(tasks, document.getElementById('agenda-list'));
        initializeDesktopInteractions();
    }
    
    // RENDERIZAÇÃO TELEMÓVEL
    function renderMobileTodayView(tasks) {
        appContainer.innerHTML = `
            <main id="view-today" class="container view">
                <nav class="mobile-view-nav">
                    <button id="mobile-tab-pedidos" class="mobile-tab-btn active">Pedidos</button>
                    <button id="mobile-tab-docas" class="mobile-tab-btn">Docas</button>
                    <button id="mobile-tab-finalizados" class="mobile-tab-btn">Finalizados</button>
                </nav>
                <div class="mobile-view-content">
                    <div id="content-pedidos" class="unassigned-container active"></div>
                    <div id="content-docas" class="dock-board-container"></div>
                    <div id="content-finalizados" class="daily-agenda-container"></div>
                </div>
            </main>`;
        renderPendingTasks(tasks, document.getElementById('content-pedidos'));
        renderDockBoard(tasks, document.getElementById('content-docas'));
        renderFinalizados(tasks, document.getElementById('content-finalizados'));
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
        container.innerHTML = '';
        const unassignedTasks = tasks.filter(task => !task.assignedTo && (task.status === 'Aguardando' || task.status === 'Não Compareceu'));
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

    function renderDockBoard(tasks, container) {
        if (!container) return;
        container.innerHTML = '';
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
        container.innerHTML = '';
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

    function initializeDesktopInteractions() {
        const draggableContainers = [...document.querySelectorAll('.task-list-group'), ...document.querySelectorAll('.drop-zone')];
        draggableContainers.forEach(container => {
            if (container.sortableInstance) container.sortableInstance.destroy();
            container.sortableInstance = new Sortable(container, {
                group: 'shared', animation: 150, filter: '.non-draggable',
                onEnd: (evt) => {
                    const taskId = evt.item.id; const task = findTaskById(taskId); if (!task) return;
                    if (task.assignedTo) { const oldDock = findDockById(task.assignedTo.dockId); if (oldDock) { oldDock.status = 'livre'; oldDock.taskIdAtual = null; } }
                    const targetContainer = evt.to;
                    if (targetContainer.classList.contains('drop-zone')) {
                        const targetDockId = targetContainer.dataset.dockId;
                        const dock = findDockById(targetDockId);
                        if (dock.status !== 'livre') { alert(`A doca ${dock.numero} não está disponível (Status: ${dock.status}).`); socket.emit('board:update', { tasks: allTasks, boardData }); return; }
                        task.assignedTo = { dockId: targetDockId, time: targetContainer.dataset.time };
                        task.status = 'Agendado';
                        dock.status = 'ocupada';
                        dock.taskIdAtual = task.id;
                    } else {
                        task.assignedTo = null;
                        task.status = 'Aguardando';
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
        setupDragToScroll();
    }
    
    function initializeMobileInteractions() {
        const tabs = document.querySelectorAll('.mobile-tab-btn');
        const contents = document.querySelectorAll('.mobile-view-content > div');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`content-${tab.id.split('-')[2]}`).classList.add('active');
            });
        });
        document.querySelectorAll('#content-pedidos .task-card').forEach(card => {
            card.addEventListener('click', () => openScheduleModal(card.id));
        });
        document.querySelectorAll('#content-docas .task-card, #content-finalizados .agenda-item').forEach(card => {
            card.addEventListener('click', () => openModal('details', card.id));
        });
        document.querySelectorAll('.block-btn').forEach(button => {
             button.addEventListener('click', handleBlockButtonClick);
        });
    }
    
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
                <p><strong>Entrada na Doca:</strong> ${task.horaEntrada ? new Date(task.horaEntrada).toLocaleString('pt-BR') : 'N/A'}</p>
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
        let optionsHTML = '<p>Selecione o próximo horário livre:</p>';
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
            <div class="schedule-options-list">${optionsHTML.includes('<button') ? optionsHTML : '<p>Nenhuma doca livre encontrada a partir de agora.</p>'}</div>`;
        
        modalContent.querySelector('.close-button').addEventListener('click', closeModal);
        document.querySelectorAll('.schedule-option-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const { taskId, dockId, time } = e.currentTarget.dataset;
                const taskToSchedule = findTaskById(taskId);
                const dockToSchedule = findDockById(dockId);
                if (taskToSchedule && dockToSchedule) {
                    taskToSchedule.assignedTo = { dockId, time };
                    taskToSchedule.status = 'Agendado';
                    dockToSchedule.status = 'ocupada';
                    dockToSchedule.taskIdAtual = taskId;
                    socket.emit('board:update', { tasks: allTasks, boardData });
                    closeModal();
                }
            });
        });
        modal.style.display = 'block';
    }

    function closeModal() { modal.style.display = 'none'; currentTaskInModal = null; }
    
    function handleStartProcess() {
        const task = currentTaskInModal;
        if (task && task.assignedTo && task.status === 'Agendado') {
            task.status = 'Em Processo';
            task.horaEntrada = new Date();
            socket.emit('board:update', { tasks: allTasks, boardData });
            closeModal();
        } else { alert('A tarefa precisa estar agendada numa doca para ser iniciada.'); }
    }

    function handleEndProcess() {
        const task = currentTaskInModal;
        if (task && task.status === 'Em Processo') {
            task.status = 'Finalizado';
            task.horaFinalizacao = new Date();
            const dock = findDockById(task.assignedTo.dockId);
            if (dock) { dock.status = 'livre'; dock.taskIdAtual = null; }
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
    
    function renderMobileNav() {
        const mobileNav = document.getElementById('mobile-menu-content');
        mobileNav.innerHTML = `<a href="#" id="nav-yesterday">Resumo de Ontem</a><a href="#" id="nav-today" class="active">Planejamento de Hoje</a><a href="#" id="nav-tomorrow">Previsão de Amanhã</a>`;
    }
    function openMobileMenu() { mobileMenu.classList.add('open'); overlay.classList.add('open'); }
    function closeMobileMenu() { mobileMenu.classList.remove('open'); overlay.classList.remove('open'); }
    hamburgerBtn.addEventListener('click', openMobileMenu);
    closeMenuBtn.addEventListener('click', closeMobileMenu);
    overlay.addEventListener('click', closeMobileMenu);

    function setupDragToScroll() {
        const slider = document.querySelector('.dock-board-container');
        if (!slider) return;
        let isDown = false, startX, scrollLeft;
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

    function findTaskById(id) { return allTasks.find(task => task.id === id); }
    function findDockById(id) { return Object.values(boardData).flatMap(cd => Object.values(cd).flatMap(mod => mod)).find(d => d.id === id); }
    function isSameDay(date1, date2) { return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate(); }
    
    setupDayNavigation();
});
