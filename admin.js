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
    ['view-home', 'view-ai-reports', 'view-console'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== viewId);
    });

    const views = {
        'view-home': { title: '🚀 TPM Orchestrator', showBack: false },
        'view-ai-reports': { title: '🤖 AI Status Reports', showBack: true },
        'view-console': { title: '💻 System Console', showBack: true }
    };

    document.getElementById('header-title').innerHTML = views[viewId].title;
    document.getElementById('btn-back-home').classList.toggle('hidden', !views[viewId].showBack);
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

socket.on('server-log', (data) => {
    // 1. Update the traditional terminal view
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
    } else {
        // Create new
        const div = document.createElement('div');
        div.id = `step-${data.stepId}`;
        div.className = `log-line log-${data.status} flex items-start space-x-3`;

        const iconHtml = data.status === 'loading' ? '<div class="spinner mt-0.5"></div>' : `<span>${data.icon}</span>`;

        div.innerHTML = `
            <span class="text-slate-600 shrink-0 text-xs mt-1">${data.time}</span>
            <span class="text-indigo-400 font-bold shrink-0">[${data.projectName}]</span>
            <div class="icon-container shrink-0">${iconHtml}</div>
            <span class="message-text flex-1 ${data.status === 'info' ? 'text-slate-300' : 'text-slate-400'}">${data.message}</span>
        `;
        terminal.appendChild(div);
    }
    terminal.scrollTop = terminal.scrollHeight;

    // 2. Update the Visual Project Cards in the AI view
    updateProjectCardVisuals(data);
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
    logEntry.innerHTML = `<span class="mt-0.5">${data.icon === '⏳' ? '<div class="spinner mt-0"></div>' : data.icon}</span> <span class="flex-1 leading-relaxed">${data.message}</span>`;
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
                modelBadge = `<span class="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded border ${badgeColor}">✨ ${data.meta.model}</span>`;
            }

            actionsDiv.innerHTML = `
                <div class="flex justify-between items-center mb-1 px-1">
                    <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">Generated Documents ${modelBadge}</span>
                </div>
                <div class="flex w-full gap-2">
                    <!-- Slack Group -->
                    <div class="flex flex-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 transition">
                        <a href="${data.meta.links.slack}" target="_blank" class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400">📄 Preview Slack</a>
                        <div class="w-px bg-slate-300 dark:bg-slate-600 my-1"></div>
                        <button onclick="showRefineBox('${safeId}', 'slack')" class="px-2 group relative text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 flex items-center justify-center transition-colors">
                            <svg class="w-3.5 h-3.5 group-hover:-rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            <span class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 text-[9px] font-bold text-white bg-slate-800 dark:bg-slate-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-lg border border-slate-700">Refine Slack Draft</span>
                        </button>
                    </div>
                    <!-- PDF Group -->
                    <div class="flex flex-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 transition">
                        <a href="${data.meta.links.pdf}" target="_blank" class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400">📄 Preview PDF</a>
                        <div class="w-px bg-slate-300 dark:bg-slate-600 my-1"></div>
                        <button onclick="showRefineBox('${safeId}', 'pdf')" class="px-2 group relative text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 flex items-center justify-center transition-colors">
                            <svg class="w-3.5 h-3.5 group-hover:-rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            <span class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 text-[9px] font-bold text-white bg-slate-800 dark:bg-slate-900 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-lg border border-slate-700">Refine PDF Draft</span>
                        </button>
                    </div>
                </div>
                
                <!-- Inline AI Input Block -->
                <div id="refine-box-${safeId}" class="hidden mt-1 p-2 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800/50 flex-col gap-2 shadow-inner">
                    <div class="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider" id="refine-title-${safeId}">Refining</div>
                    <textarea id="refine-input-${safeId}" class="w-full text-xs p-2 rounded-md bg-white dark:bg-slate-950 border border-blue-200 dark:border-blue-800/80 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-400 dark:placeholder-slate-600 transition-all" rows="2" placeholder="e.g., Make the tone more aggressive..."></textarea>
                    <div class="flex gap-2 justify-end mt-1">
                        <button onclick="cancelRefine('${safeId}')" class="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition">Cancel</button>
                        <button onclick="submitRefine('${data.meta.sheetName}', ${data.meta.rowIndex}, '${safeId}', this)" class="px-3 py-1.5 text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow transition flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Regenerate</button>
                    </div>
                </div>
                <div class="flex w-full gap-2 mt-1">
                    <button onclick="triggerAction('${data.meta.sheetName}', ${data.meta.rowIndex}, 'approved', this)" class="flex-1 px-3 py-1.5 text-[11px] font-bold rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 transition">🚀 Approve & Publish</button>
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
    document.getElementById(`refine-title-${safeId}`).innerHTML = `✨ Refining <span class="text-slate-800 dark:text-white">${target === 'slack' ? 'Slack' : 'PDF'}</span> Document`;
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
    btn.innerText = '⏳ Sending...';
    btn.disabled = true;
    
    try {
        await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetName, rowIndex, triggerValue: action })
        });
        btn.innerText = '✅ Updated';
    } catch (err) {
        btn.innerText = '❌ Failed';
    }
    setTimeout(() => {
        btn.innerText = originalText;
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
    btn.innerText = 'Syncing...';

    const emailColumns = Array.from(document.querySelectorAll('input[name="emailCols"]:checked')).map(cb => cb.value);
    const slackColumns = Array.from(document.querySelectorAll('input[name="slackCols"]:checked')).map(cb => cb.value);

    await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailColumns, slackColumns })
    });

    btn.innerText = 'Saved ✅';
    setTimeout(() => {
        btn.innerText = 'Save Logic';
    }, 2000);
});

// Initialize
fetchConfig();