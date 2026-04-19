console.log("✅ TPM Admin Dashboard JS is parsing successfully!");

// --- 0. Theme Toggle Logic ---
const themeToggleBtn = document.getElementById('theme-toggle');
const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');

// Check local storage or system preference
if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    themeToggleLightIcon.classList.remove('hidden');
} else {
    document.documentElement.classList.remove('dark');
    themeToggleDarkIcon.classList.remove('hidden');
}

themeToggleBtn.addEventListener('click', function() {
    themeToggleDarkIcon.classList.toggle('hidden');
    themeToggleLightIcon.classList.toggle('hidden');

    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('color-theme', isDark ? 'dark' : 'light');
});

// --- 0.5 View Switching Logic ---
function switchView(viewId) {
    ['view-home', 'view-ai-reports', 'view-console', 'view-kanban', 'view-list'].forEach(id => {
        const el = document.getElementById(id);
        if (id === viewId) {
            el.classList.remove('hidden');
            el.classList.remove('animate-view');
            void el.offsetWidth; // Magic browser reflow trick to restart the animation
            el.classList.add('animate-view');
        } else {
            el.classList.add('hidden');
        }
    });

    const views = {
        'view-home': { title: '<svg class="w-6 h-6 text-indigo-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5"></path></svg> TPM Orchestrator', showBack: false },
        'view-ai-reports': { title: '<svg class="w-6 h-6 text-indigo-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> AI Status Reports', showBack: true },
        'view-console': { title: '<svg class="w-6 h-6 text-indigo-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg> System Console', showBack: true },
        'view-kanban': { title: '<svg class="w-6 h-6 text-indigo-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"></path></svg> Project Kanban', showBack: true },
        'view-list': { title: '<svg class="w-6 h-6 text-indigo-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M8 14h12M8 18h12"></path></svg> Project Grid', showBack: true }
    };

    document.getElementById('header-title').innerHTML = views[viewId].title;
    document.getElementById('btn-back-home').classList.toggle('hidden', !views[viewId].showBack);
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.target === viewId) {
            btn.classList.add('bg-white', 'text-indigo-600', 'shadow-md', 'dark:bg-indigo-500', 'dark:text-white');
            btn.classList.remove('text-white/70', 'hover:bg-white/10', 'hover:text-white');
        } else {
            btn.classList.remove('bg-white', 'text-indigo-600', 'shadow-md', 'dark:bg-indigo-500', 'dark:text-white');
            btn.classList.add('text-white/70', 'hover:bg-white/10', 'hover:text-white');
        }
    });
    
    if (viewId === 'view-kanban') fetchKanbanData();
    if (viewId === 'view-list') fetchListData();

    localStorage.setItem('active-view', viewId);
}

// --- 1. Socket.io Logic ---
const socket = io();
const terminal = document.getElementById('terminal');

socket.on('connect', () => {
    document.getElementById('status-dot').className = 'w-2 h-2 bg-green-500 shadow-[0_0_8px_#22c55e]';
    document.getElementById('status-text').innerText = 'Online';
});

socket.on('disconnect', () => {
    document.getElementById('status-dot').className = 'w-2 h-2 bg-red-500 shadow-[0_0_8px_#ef4444]';
    document.getElementById('status-text').innerText = 'Offline';
});

function appendToTerminal(data) {
    if (terminal.innerText.includes('Waiting for events')) terminal.innerHTML = '';
    let existingLine = document.getElementById(`step-${data.stepId}`);

    if (existingLine && data.status !== 'loading') {
        // Update existing
        existingLine.className = `log-line log-${data.status} flex items-start space-x-3`;
        existingLine.querySelector('.icon-container').innerHTML = `<span>${data.icon}</span>`;
        
        let textClass = "text-slate-400";
        if (data.status === 'success') textClass = "text-green-400";
        if (data.status === 'error') textClass = "text-red-400";
        if (data.status === 'warning') textClass = "text-yellow-400";
        
        existingLine.querySelector('.message-text').className = `message-text flex-1 ${textClass}`;
        existingLine.querySelector('.message-text').innerHTML = data.message;
    } else if (!existingLine) {
        // Create new
        const div = document.createElement('div');
        div.id = `step-${data.stepId}`;
        div.className = `log-line log-${data.status} flex items-start space-x-3`;

        const iconHtml = data.icon;

        div.innerHTML = `
            <span class="text-slate-600 shrink-0 text-xs mt-1">${data.time}</span>
            <span class="text-indigo-400 font-bold shrink-0">[${data.projectName}]</span>
            <div class="icon-container shrink-0">${iconHtml}</div>
            <span class="message-text flex-1 ${data.status === 'info' ? 'text-slate-300' : 'text-slate-400'}">${data.message}</span>
        `;
        terminal.appendChild(div);
    }
    terminal.scrollTop = terminal.scrollHeight;
}

socket.on('server-log', (data) => {
    appendToTerminal(data);
    updateProjectCardVisuals(data);
    
    // NEW: Show toast globally for errors and warnings
    if (data.status === 'error' || data.status === 'warning') {
        showSystemToast(data);
    }
});

function updateProjectCardVisuals(data) {
    const msg = data.message;

    // 1. INSTANT QUEUE ADDITION: Catch the webhook system log
    if (data.projectName === 'System' && msg.includes('Webhook received for')) {
        const match = msg.match(/\[(.*?)\]/);
        if (match) addToVisualQueue(match[1]);
        return;
    }

    // 2. QUEUE SHUFFLE: Catch the queue starting log to remove it from the deck
    if (data.projectName === 'Queue' && msg.includes('Starting queued task for')) {
        const match = msg.match(/Starting queued task for (.*)/);
        if (match) {
            // Remove the chip, allowing the actual card to take over
            removeFromVisualQueue(match[1]);
        }
        return;
    }

    // Ignore any other generic system/queue logs
    if (data.projectName === 'System' || data.projectName === 'Queue') return;
    
    // 3. MAIN CARD LOGIC
    const safeId = 'card-' + data.projectName.replace(/[^a-zA-Z0-9]/g, '-');
    let card = document.getElementById(safeId);
    
    if(!card) {
        document.getElementById('empty-projects').classList.add('hidden');
        const grid = document.getElementById('project-cards-grid');
        
        card = document.createElement('div');
        card.id = safeId;
        card.className = "bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-3 transition-all animate-fade-in";
        card.innerHTML = `
            <div class="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
                <h3 class="font-bold text-slate-800 dark:text-white truncate pr-4">${data.projectName}</h3>
                <span class="card-badge shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800">Processing</span>
            </div>
            <div class="card-logs flex-1 space-y-2 text-xs text-slate-600 dark:text-slate-300 overflow-y-auto max-h-32 terminal-scroll pr-2"></div>
            <div class="w-full bg-slate-100 dark:bg-slate-700/50 rounded-full h-1.5 mt-2 overflow-hidden">
                <div class="card-progress bg-indigo-500 h-1.5 rounded-full transition-all duration-700 ease-out" style="width: 5%"></div>
            </div>
        `;
        grid.insertBefore(card, grid.firstChild);
    }

    // 4. SELF-CLEANING SPINNERS: Stop old loaders on this specific card
    const oldSpinners = card.querySelectorAll('.spinner');
    oldSpinners.forEach(spin => {
        const container = spin.parentElement;
        container.innerHTML = '✓';
        container.className = 'mt-0.5 text-emerald-500 font-bold text-[10px]';
    });

    // Add the log entry to the card
    const logsContainer = card.querySelector('.card-logs');
    const logEntry = document.createElement('div');
    logEntry.className = "flex space-x-2 items-start opacity-80 hover:opacity-100 transition-opacity";
    logEntry.innerHTML = `<span class="mt-0.5 shrink-0">${data.icon}</span> <span class="flex-1 leading-relaxed">${data.message}</span>`;
    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;

    // Heuristically advance the progress bar based on your backend log keywords
    const progress = card.querySelector('.card-progress');
    const badge = card.querySelector('.card-badge');
    const lowerMsg = msg.toLowerCase();
    
    // Reset state if a new cycle starts for an already completed card (Conflict Resolution)
    if (lowerMsg.includes('locked')) {
        progress.style.width = '25%';
        progress.className = 'card-progress bg-indigo-500 h-1.5 rounded-full transition-all duration-700 ease-out';
        badge.className = 'card-badge shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800';
        badge.innerText = 'Processing';
    }
    
    if (lowerMsg.includes('dynamically') || lowerMsg.includes('failover')) progress.style.width = '45%';
    if (lowerMsg.includes('generated')) progress.style.width = '70%';
    if (lowerMsg.includes('pdf and slack') || lowerMsg.includes('perfectly')) progress.style.width = '85%';
    if (lowerMsg.includes('complete')) {
        progress.style.width = '100%';
        progress.classList.replace('bg-indigo-500', 'bg-emerald-500');
        badge.className = "card-badge shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800";
        badge.innerText = "Done";
    }
    if (data.status === 'error') {
        progress.classList.replace('bg-indigo-500', 'bg-red-500');
        badge.className = "card-badge shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800";
        badge.innerText = "Failed";
    }

    // 5. INJECT ACTION BUTTONS & PREVIEW LINKS
    if (data.meta && data.meta.links) {
        const actionsId = 'actions-' + safeId;
        
        const oldActions = document.getElementById(actionsId);
        if (oldActions) oldActions.remove(); // Destroy old block to refresh links
        
        const actionsDiv = document.createElement('div');
            actionsDiv.id = actionsId;
            actionsDiv.className = "mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-2 animate-fade-in";
            
            let modelBadge = '';
            if (data.meta.model) {
                const badgeColor = data.meta.model === 'Gemini' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800';
                modelBadge = `<span class="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded border ${badgeColor} flex items-center"><svg class="w-2.5 h-2.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> ${data.meta.model}</span>`;
            }

            actionsDiv.innerHTML = `
                <div class="flex justify-between items-center mb-1 px-1">
                    <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">Generated Documents ${modelBadge}</span>
                </div>
                <div class="flex w-full gap-2">
                    <!-- Slack Group -->
                    <div class="flex flex-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 transition">
                        <a href="${data.meta.links.slack}" target="_blank" class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"><svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg> Preview Slack</a>
                        <div class="w-px bg-slate-300 dark:bg-slate-600 my-1"></div>
                        <button onclick="showRefineBox('${safeId}', 'slack')" class="px-2 group relative text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 flex items-center justify-center transition-colors">
                            <svg class="w-3.5 h-3.5 group-hover:-rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            <span class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 text-[9px] font-bold text-white bg-slate-800 dark:bg-slate-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-lg border border-slate-700">Refine Slack Draft</span>
                        </button>
                    </div>
                    <!-- PDF Group -->
                    <div class="flex flex-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 transition">
                        <a href="${data.meta.links.pdf}" target="_blank" class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"><svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg> Preview PDF</a>
                        <div class="w-px bg-slate-300 dark:bg-slate-600 my-1"></div>
                        <button onclick="showRefineBox('${safeId}', 'pdf')" class="px-2 group relative text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 flex items-center justify-center transition-colors">
                            <svg class="w-3.5 h-3.5 group-hover:-rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            <span class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 text-[9px] font-bold text-white bg-slate-800 dark:bg-slate-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-lg border border-slate-700">Refine PDF Draft</span>
                        </button>
                    </div>
                </div>
                
                <!-- Inline AI Input Block -->
                <div id="refine-box-${safeId}" class="hidden mt-1 p-2 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800/50 flex-col gap-2 shadow-inner">
                    <div class="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center" id="refine-title-${safeId}">Refining</div>
                    <textarea id="refine-input-${safeId}" class="w-full text-xs p-2 rounded-md bg-white dark:bg-slate-950 border border-blue-200 dark:border-blue-800/80 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-400 dark:placeholder-slate-600 transition-all" rows="2" placeholder="e.g., Make the tone more aggressive..."></textarea>
                    <div class="flex gap-2 justify-end mt-1">
                        <button onclick="cancelRefine('${safeId}')" class="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition">Cancel</button>
                        <button onclick="submitRefine('${data.meta.sheetName}', ${data.meta.rowIndex}, '${safeId}', this)" class="px-3 py-1.5 text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow transition flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Regenerate</button>
                    </div>
                </div>
                <div class="flex w-full gap-2 mt-1">
                    <button onclick="triggerAction('${data.meta.sheetName}', ${data.meta.rowIndex}, 'approved', this)" class="flex-1 flex items-center justify-center px-3 py-1.5 text-[11px] font-bold rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 transition"><svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg> Approve & Publish</button>
                </div>
            `;
            card.appendChild(actionsDiv);
    }
}

// --- Queue UI Helpers ---
function addToVisualQueue(name) {
    document.getElementById('visual-queue-container').classList.remove('hidden');
    document.getElementById('empty-projects').classList.add('hidden');
    const queue = document.getElementById('visual-queue');
    const safeId = 'q-' + name.replace(/[^a-zA-Z0-9]/g, '-');
    
    if(!document.getElementById(safeId)) {
        const chip = document.createElement('div');
        chip.id = safeId;
        chip.className = "px-3 py-1 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 rounded-full text-xs font-bold border border-indigo-200 dark:border-indigo-800 transition-all duration-500 transform scale-0 opacity-0 flex items-center shadow-sm";
        chip.innerHTML = `<svg class="w-3 h-3 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${name}`;
        queue.appendChild(chip);
        
        // Trigger entrance animation
        setTimeout(() => chip.classList.remove('scale-0', 'opacity-0'), 10);
    }
}

function removeFromVisualQueue(name) {
    const safeId = 'q-' + name.replace(/[^a-zA-Z0-9]/g, '-');
    const chip = document.getElementById(safeId);
    if (chip) {
        chip.classList.add('scale-0', 'opacity-0', 'w-0', 'px-0', 'overflow-hidden'); // exit animation
        setTimeout(() => {
            chip.remove();
            if (document.getElementById('visual-queue').children.length === 0) {
                document.getElementById('visual-queue-container').classList.add('hidden');
                // Restore empty state ONLY if no project cards exist
                if (document.getElementById('project-cards-grid').children.length === 0) {
                    document.getElementById('empty-projects').classList.remove('hidden');
                }
            }
        }, 500);
    }
}

function clearTerminal() { 
    terminal.innerHTML = '<div class="text-slate-600 italic underline decoration-slate-800">Waiting for events...</div>'; 
}

// --- 1.5 Action API Logic ---
window.showRefineBox = (safeId, target) => {
    const box = document.getElementById(`refine-box-${safeId}`);
    box.classList.remove('hidden');
    box.classList.add('flex');
    box.dataset.target = target;
    document.getElementById(`refine-title-${safeId}`).innerHTML = `<svg class="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg> Refining <span class="text-slate-800 dark:text-white ml-1">${target === 'slack' ? 'Slack' : 'PDF'}</span> Document`;
    document.getElementById(`refine-input-${safeId}`).focus();
};

window.cancelRefine = (safeId) => {
    const box = document.getElementById(`refine-box-${safeId}`);
    box.classList.add('hidden');
    box.classList.remove('flex');
    document.getElementById(`refine-input-${safeId}`).value = '';
};

window.submitRefine = async (sheetName, rowIndex, safeId, btn) => {
    const inputEl = document.getElementById(`refine-input-${safeId}`);
    const customPrompt = inputEl.value.trim();
    if (!customPrompt) return;
    
    const target = document.getElementById(`refine-box-${safeId}`).dataset.target;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner !w-3 !h-3"></div>';
    btn.disabled = true;
    inputEl.disabled = true;
    
    try {
        await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetName, rowIndex, triggerValue: 'refine', customPrompt, target })
        });
    } catch (err) {
        console.error("Refinement failed to queue", err);
    }
};

window.triggerAction = async (sheetName, rowIndex, action, btn) => {
    const originalText = btn.innerText;
    btn.innerHTML = '<div class="spinner !w-3 !h-3"></div> Sending...';
    btn.disabled = true;
    
    try {
        await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetName, rowIndex, triggerValue: action })
        });
        btn.innerHTML = '<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Saved';
    } catch (err) {
        btn.innerHTML = 'Failed';
    }
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }, 3000);
};

// --- 2. Configuration API Logic ---
async function fetchConfig() {
    try {
        const res = await fetch('/api/columns');
        const data = await res.json();
        
        document.getElementById('config-loading').classList.add('hidden');
        document.getElementById('config-form').classList.remove('hidden');

        const buildCols = (container, activeList, name) => {
            container.innerHTML = data.headers.map(h => `
                <label class="flex items-center space-x-3 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg cursor-pointer transition-colors duration-150">
                    <input type="checkbox" name="${name}" value="${h}" ${activeList.includes(h) ? 'checked' : ''} class="w-4 h-4 text-indigo-600 dark:text-indigo-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-indigo-500 dark:focus:ring-offset-gray-800">
                    <span class="text-sm text-gray-700 dark:text-gray-300">${h}</span>
                </label>
            `).join('');
        };

        buildCols(document.getElementById('email-cols'), data.activeConfig.emailColumns, 'emailCols');
        buildCols(document.getElementById('slack-cols'), data.activeConfig.slackColumns, 'slackCols');
    } catch (err) {
        document.getElementById('config-loading').innerHTML = `❌ Failed to load: ${err.message}`;
    }
}

document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.innerHTML = '<div class="spinner !w-4 !h-4"></div>';

    const emailColumns = Array.from(document.querySelectorAll('input[name="emailCols"]:checked')).map(cb => cb.value);
    const slackColumns = Array.from(document.querySelectorAll('input[name="slackCols"]:checked')).map(cb => cb.value);

    await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailColumns, slackColumns })
    });

    btn.innerHTML = 'Saved';
    setTimeout(() => {
        btn.innerHTML = 'Save Logic';
    }, 2000);
});

// --- 3. State Rehydration ---
async function restoreState() {
    try {
        const res = await fetch('/api/state');
        const state = await res.json();
        
        // 1. Restore System Terminal Logs
        state.systemLogs.forEach(log => appendToTerminal(log));

        // 2. Restore Pending Queue Chips
        state.queue.forEach(qName => addToVisualQueue(qName));
        
        // 3. Restore Project Cards
        Object.values(state.projectState).forEach(proj => {
            // Replay the historical logs to rebuild the card DOM
            proj.logs.forEach(log => updateProjectCardVisuals(log));
            
            // If the project finished and has links, force the action panel to rebuild
            if (proj.meta) {
                updateProjectCardVisuals({
                    message: 'Restoring UI state', 
                    projectName: proj.logs[0].projectName, 
                    meta: proj.meta
                });
            }
        });
    } catch (err) {
        console.error("Failed to restore state:", err);
    }
}

// Initialize
fetchConfig();
restoreState();

// Restore last active view
const savedView = localStorage.getItem('active-view');
switchView(['view-home', 'view-ai-reports', 'view-console', 'view-kanban', 'view-list'].includes(savedView) ? savedView : 'view-home');

// --- 4. Kanban Logic ---
async function fetchKanbanData() {
    try {
        const res = await fetch('/api/kanban');
        const projects = await res.json();
        
        if (projects.error) {
            const board = document.getElementById('kanban-board');
            board.innerHTML = `<div class="w-full mt-10 p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-center text-red-600 dark:text-red-400 font-medium">Failed to load board: ${projects.error}</div>`;
            return;
        }
        
        const board = document.getElementById('kanban-board');
        board.innerHTML = '';
        
        // Group projects by their Current Status
        const grouped = {};
        projects.forEach(p => {
            const s = p.currentStatus || 'Uncategorized';
            if (!grouped[s]) grouped[s] = [];
            grouped[s].push(p);
        });
        
        // Dynamically build the columns and cards
        Object.keys(grouped).sort().forEach(status => {
            const col = document.createElement('div');
            col.className = "kanban-col flex-shrink-0 w-80 bg-slate-200/50 dark:bg-slate-800/50 rounded-xl flex flex-col max-h-full border border-slate-200 dark:border-slate-700";
            col.ondragover = allowDrop;
            col.ondrop = (e) => dropKanban(e, status);
            
            col.innerHTML = `
                <div class="p-3 font-bold text-sm text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <span>${status}</span><span class="bg-slate-200 dark:bg-slate-700 px-2 rounded-full text-xs">${grouped[status].length}</span>
                </div>
                <div class="kanban-body flex-1 overflow-y-auto p-3 space-y-3 terminal-scroll"></div>
            `;
            board.appendChild(col);
            
            const colBody = col.querySelector('.kanban-body');
            grouped[status].forEach(p => {
            const cardId = `kb-${p.row}`;
            const card = document.createElement('div');
            card.id = cardId;
            card.draggable = true;
            card.ondragstart = dragKanban;
            card.dataset.row = p.row;
            card.dataset.sheet = p.sheetName;
            card.className = "bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow group";
            
            card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                        <h4 class="font-bold text-slate-800 dark:text-white text-sm select-none pr-2 leading-tight">${p.projectName}</h4>
                        <button onclick="triggerAction('${p.sheetName}', ${p.row}, 'new', this)" title="Generate AI Docs" class="shrink-0 text-[10px] px-1.5 py-1 flex items-center bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-800 transition"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> AI Docs</button>
                    </div>
                <textarea oninput="debounceKanbanEdit(${p.row}, '${p.sheetName}', 'slackDraft', this.value)" class="w-full text-xs text-slate-600 dark:text-slate-400 bg-transparent border-none resize-none focus:ring-1 focus:ring-blue-500 rounded p-1 -ml-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/50 focus:bg-white dark:focus:bg-slate-950" rows="3" placeholder="Add draft details...">${p.description}</textarea>
                <div class="mt-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="text-[9px] text-slate-400 font-mono">Row ${p.row}</span>
                    <span class="text-[10px] bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-500">Drag to move</span>
                </div>
            `;
colBody.appendChild(card);
                });
            });
            
    } catch (err) {
        console.error('Kanban fetch error:', err);
    }
}


function allowDrop(ev) { ev.preventDefault(); }
function dragKanban(ev) { ev.dataTransfer.setData("text", ev.target.id); }

async function dropKanban(ev, newStatus) {
    ev.preventDefault();
    const cardId = ev.dataTransfer.getData("text");
    const card = document.getElementById(cardId);
    const colBody = ev.target.closest('.kanban-col').querySelector('.kanban-body');
    
    if (colBody && card) {
        colBody.appendChild(card);
        
        // Update counts dynamically
        document.querySelectorAll('.kanban-col').forEach(col => {
            const badge = col.querySelector('.rounded-full');
            if (badge) badge.innerText = col.querySelector('.kanban-body').children.length;
        });
        
        showSyncStatus();
        
        // Save the new Status to Google Sheets
        await fetch('/api/kanban/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetName: card.dataset.sheet, row: card.dataset.row, colKey: 'currentStatus', newValue: newStatus })
        });
    }
}

let debounceTimer;
function debounceKanbanEdit(row, sheetName, colKey, newValue) {
    clearTimeout(debounceTimer);
    showSyncStatus('typing...');
    debounceTimer = setTimeout(async () => {
        await fetch('/api/kanban/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetName, row, colKey, newValue })
        });
        showSyncStatus();
    }, 1000); // Wait 1 second after typing stops before saving to avoid rate limits
}

function showSyncStatus(msg = '<svg class="w-3.5 h-3.5 inline mr-1 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Synced') {
    const el = document.getElementById('kanban-sync-status');
    el.innerHTML = msg;
    el.classList.remove('opacity-0');
    if (msg.includes('Synced')) setTimeout(() => el.classList.add('opacity-0'), 2000);
}

// --- 5. Project Grid Logic ---
let globalListData = []; // Store fetched data locally for instant filtering

async function fetchListData(sheetName = null) {
    try {
        // 1. Populate TPM Dropdown if empty
        const select = document.getElementById('tpm-selector');
        if (select.options.length === 0) {
            const tpmRes = await fetch('/api/tpms');
            const tpms = await tpmRes.json();
            tpms.forEach(tpm => {
                const opt = document.createElement('option');
                opt.value = tpm;
                opt.textContent = tpm;
                select.appendChild(opt);
            });
            if (!sheetName && tpms.length > 0) sheetName = tpms[0];
        } else if (!sheetName) {
            sheetName = select.value;
        }
        
        const board = document.getElementById('list-board');
        board.innerHTML = '<div class="p-12 w-full flex justify-center items-center text-slate-400 dark:text-slate-500 font-medium"><div class="spinner !w-5 !h-5 mr-3"></div> Loading project data...</div>';

        const res = await fetch(`/api/kanban?sheet=${encodeURIComponent(sheetName)}`);
        globalListData = await res.json();
        
        if (globalListData.error) {
            const board = document.getElementById('list-board');
            board.innerHTML = `<div class="w-full mt-10 p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-center text-red-600 dark:text-red-400 font-medium">Failed to load grid: ${globalListData.error}</div>`;
            return;
        }
        // Dynamically populate the status filter
        const statusSelect = document.getElementById('list-status-filter');
        const uniqueStatuses = [...new Set(globalListData.map(p => p.currentStatus || 'Uncategorized'))].sort();
        statusSelect.innerHTML = '<option value="">All Statuses</option>' + uniqueStatuses.map(s => `<option value="${s}">${s}</option>`).join('');
        
        // Clear filters on fresh load
        document.getElementById('list-search').value = '';
        statusSelect.value = '';
        
        renderListData();
    } catch (err) {
        console.error('List fetch error:', err);
    }
}

window.renderListData = () => {
        const board = document.getElementById('list-board');
        const searchTerm = document.getElementById('list-search').value.toLowerCase();
        const statusFilter = document.getElementById('list-status-filter').value;
        
        // 1. Apply Filters
        const filteredData = globalListData.filter(p => {
            const matchesSearch = p.projectName.toLowerCase().includes(searchTerm) || p.assignee.toLowerCase().includes(searchTerm);
            const matchesStatus = statusFilter === '' || p.currentStatus === statusFilter;
            return matchesSearch && matchesStatus;
        });

        // 2. Group by Phase
        const grouped = {};
        filteredData.forEach(p => {
            const s = p.phase || 'General';
            if (!grouped[s]) grouped[s] = [];
            grouped[s].push(p);
        });
        
        const uniqueStatuses = [...new Set(globalListData.map(p => p.currentStatus || 'Uncategorized'))].sort();

        // 3. Build Proper HTML Table
        let html = `<table class="w-full text-left border-collapse min-w-[1400px]">
            <thead class="text-slate-500 dark:text-slate-400 text-xs font-semibold tracking-wide z-20">
                <tr>
                    <th class="p-3 w-12 text-center sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">#</th>
                    <th class="p-3 w-64 sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Project / Task</th>
                    <th class="p-3 w-44 sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Status</th>
                    <th class="p-3 w-36 sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Assignee</th>
                    <th class="p-3 w-32 sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Due Date</th>
                    <th class="p-3 min-w-[200px] sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Integrations</th>
                    <th class="p-3 min-w-[200px] sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Completed Scope</th>
                    <th class="p-3 min-w-[250px] sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">Status Comments</th>
                    <th class="p-3 w-28 text-center sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur z-20 border-b border-slate-200 dark:border-slate-700 shadow-sm">AI Actions</th>
                </tr>
            </thead>
            <tbody class="text-xs">`;

        let serialNo = 1;
        
        const inputClass = "w-full bg-transparent border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md px-2 py-1.5 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-950 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-600 text-xs";
        const textareaClass = "w-full bg-transparent border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md px-2 py-1.5 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-950 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 outline-none resize-y terminal-scroll transition-all placeholder-slate-400 dark:placeholder-slate-600 text-xs leading-relaxed";

        Object.keys(grouped).sort().forEach(phase => {
            html += `
            <tr class="bg-slate-100/50 dark:bg-slate-800/30">
                <td colspan="9" class="px-4 py-3.5 font-bold text-sm text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                    <div class="flex items-center gap-2 sticky left-4">
                        <div class="w-1.5 h-4 bg-indigo-500 rounded-full"></div>
                        ${phase} <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-700/50 px-2 py-0.5 rounded-full ml-2">${grouped[phase].length} tasks</span>
                    </div>
                </td>
            </tr>`;
            
            grouped[phase].forEach(p => {
                let optionsHtml = uniqueStatuses.map(s => `<option value="${s}" ${p.currentStatus === s ? 'selected' : ''}>${s}</option>`).join('');
                if (!uniqueStatuses.includes(p.currentStatus)) {
                    optionsHtml += `<option value="${p.currentStatus}" selected hidden>${p.currentStatus}</option>`;
                }

                html += `
                <tr class="border-b border-slate-100 dark:border-slate-800/60 hover:bg-white dark:hover:bg-slate-800/80 transition-colors group align-top bg-white/50 dark:bg-transparent">
                    <td class="p-3 text-center text-slate-400 font-mono pt-4">${serialNo++}</td>
                    <td class="p-3 pt-4 font-semibold text-slate-800 dark:text-slate-200">
                        <div class="truncate max-w-[15rem]" title="${p.projectName}">${p.projectName}</div>
                    </td>
                    <td class="p-3 pt-3">
                        <select onchange="updateListCell('${p.sheetName}', ${p.row}, 'currentStatus', this.value)" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 rounded-full px-3 py-1.5 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer transition-all shadow-sm text-xs font-medium">
                            ${optionsHtml}
                        </select>
                    </td>
                    <td class="p-3 pt-3">
                        <input type="text" oninput="debounceListEdit('${p.sheetName}', ${p.row}, 'assignee', this.value)" value="${p.assignee}" class="${inputClass}" placeholder="Unassigned">
                    </td>
                    <td class="p-3 pt-3">
                        <input type="text" oninput="debounceListEdit('${p.sheetName}', ${p.row}, 'dueDate', this.value)" value="${p.dueDate}" class="${inputClass}" placeholder="No Date">
                    </td>
                    <td class="p-3 pt-3">
                        <textarea oninput="debounceListEdit('${p.sheetName}', ${p.row}, 'currentIntegrations', this.value)" class="${textareaClass}" rows="2" placeholder="List integrations...">${p.currentIntegrations}</textarea>
                    </td>
                    <td class="p-3 pt-3">
                        <textarea oninput="debounceListEdit('${p.sheetName}', ${p.row}, 'completedScope', this.value)" class="${textareaClass}" rows="2" placeholder="List scope...">${p.completedScope}</textarea>
                    </td>
                    <td class="p-3 pt-3">
                        <textarea oninput="debounceListEdit('${p.sheetName}', ${p.row}, 'taskComments', this.value)" class="${textareaClass}" rows="2" placeholder="Add status notes...">${p.taskComments}</textarea>
                    </td>
                    <td class="p-3 pt-3 text-center align-top">
                        <button onclick="triggerListAI('${p.sheetName}', ${p.row}, this)" class="mt-0.5 text-[11px] font-bold px-3 py-1.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/30 border border-indigo-200 dark:border-indigo-500/30 rounded-full shadow-sm transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 w-full flex items-center justify-center gap-1.5">
                            <svg class="w-3.5 h-3.5 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> AI
                        </button>
                    </td>
                </tr>`;
            });
        });
        html += `</tbody></table>`;
        board.innerHTML = html;
}

let listDebounceTimer;
function debounceListEdit(sheetName, row, colKey, newValue) {
    clearTimeout(listDebounceTimer);
    const el = document.getElementById('list-sync-status');
    el.innerHTML = 'typing...'; el.classList.remove('opacity-0');
    
    listDebounceTimer = setTimeout(async () => {
        el.innerHTML = '<div class="spinner !w-3 !h-3 inline-block mr-1"></div> Syncing...';
        await fetch('/api/kanban/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheetName, row, colKey, newValue }) });
        el.innerHTML = '<svg class="w-4 h-4 mr-1 text-emerald-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Synced';
        setTimeout(() => el.classList.add('opacity-0'), 2000);
    }, 1000);
}
window.updateListCell = (sheetName, row, colKey, newValue) => debounceListEdit(sheetName, row, colKey, newValue);

// --- 6. AI List Trigger with Toast ---
window.triggerListAI = async (sheetName, row, btn) => {
    // 1. Actually fire the backend trigger silently
    triggerAction(sheetName, row, 'new', btn);
    
    // 2. Build the visual toast
    const container = document.getElementById('ai-toast-container');
    const toast = document.createElement('div');
    toast.className = "pointer-events-auto bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-800 shadow-2xl rounded-xl p-4 w-80 transform translate-y-full opacity-0 transition-all duration-500 ease-out flex flex-col gap-3";
    toast.innerHTML = `
        <div class="flex justify-between items-start">
            <div class="flex items-center gap-2">
                <svg class="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <div>
                    <h4 class="font-bold text-slate-800 dark:text-white text-sm">AI Docs Generating</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400">${sheetName} Row ${row}</p>
                </div>
            </div>
            <button onclick="this.closest('.pointer-events-auto').remove()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none">&times;</button>
        </div>
        <button onclick="switchView('view-ai-reports'); this.closest('.pointer-events-auto').remove()" class="w-full bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 text-xs font-bold py-2 rounded-lg transition shadow-sm">
            Go to Status Management Tool
        </button>
    `;
    container.appendChild(toast);
    
    // Animate in, then auto-remove after 7 seconds
    setTimeout(() => toast.classList.remove('translate-y-full', 'opacity-0'), 50);
    setTimeout(() => { toast.classList.add('translate-y-full', 'opacity-0'); setTimeout(() => toast.remove(), 500); }, 7000);
};

// --- 7. System Error/Warning Toast ---
window.showSystemToast = (data) => {
    const container = document.getElementById('ai-toast-container');
    if (!container) return;

    const isError = data.status === 'error';
    const title = isError ? 'System Error' : 'System Warning';
    
    // Explicit class strings used to ensure Tailwind JIT compilation works
    const borderColor = isError ? 'border-red-200 dark:border-red-800' : 'border-yellow-200 dark:border-yellow-800';
    const iconColor = isError ? 'text-red-500' : 'text-yellow-500';
    const btnBg = isError ? 'bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50' : 'bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50';
    const btnText = isError ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400';

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto bg-white dark:bg-slate-800 border ${borderColor} shadow-2xl rounded-xl p-4 w-80 transform translate-y-full opacity-0 transition-all duration-500 ease-out flex flex-col gap-3`;
    
    toast.innerHTML = `
        <div class="flex justify-between items-start">
            <div class="flex items-center gap-2 ${iconColor}">
                <div class="w-6 h-6 flex items-center justify-center">${data.icon}</div>
                <div class="overflow-hidden">
                    <h4 class="font-bold text-slate-800 dark:text-white text-sm">${title}</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400 truncate w-48" title="${data.projectName}">[${data.projectName}]</p>
                </div>
            </div>
            <button onclick="this.closest('.pointer-events-auto').remove()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none">&times;</button>
        </div>
        <p class="text-xs text-slate-600 dark:text-slate-300 break-words" title="${data.message}">${data.message}</p>
        <button onclick="switchView('view-console'); this.closest('.pointer-events-auto').remove()" class="w-full ${btnBg} ${btnText} ${borderColor} border text-xs font-bold py-2 rounded-lg transition shadow-sm flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            View in Console
        </button>
    `;
    container.appendChild(toast);
    
    // Animate in, auto-remove after 10 seconds (gives them time to read errors)
    setTimeout(() => toast.classList.remove('translate-y-full', 'opacity-0'), 50);
    setTimeout(() => { 
        if (toast.parentElement) {
            toast.classList.add('translate-y-full', 'opacity-0'); 
            setTimeout(() => toast.remove(), 500); 
        }
    }, 10000); 
};