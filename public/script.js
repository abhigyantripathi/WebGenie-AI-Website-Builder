const log = document.getElementById('log');
const promptInput = document.getElementById('prompt-input');
const submitBtn = document.getElementById('submit-btn');
const preview = document.getElementById('preview');

let ws;

function connectWebSocket() {
    ws = new WebSocket('ws://localhost:3000');

    ws.onopen = () => {
        console.log('✅ WebSocket connection established.');
        log.innerHTML = '<div>Connection established. Ready to generate.</div>';
        submitBtn.disabled = false;
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const logEntry = document.createElement('pre');
        logEntry.style.margin = '5px 0';
        logEntry.style.fontFamily = 'monospace';

        if (message.type === 'command') {
            logEntry.textContent = `\n> ${message.data}`;
        } else if (message.type === 'command-result') {
            logEntry.textContent = message.data;
        } else if (message.type === 'file-update') {
            const filePath = message.data.path;
            logEntry.textContent = `📝 Writing to ${filePath}...`;
            
            // If the main HTML file is updated, refresh the iframe
            if (filePath.endsWith('index.html')) {
                // Add a timestamp to bust the cache and force a reload
                preview.src = `index.html?t=${new Date().getTime()}`;
            }
        } else if (message.type === 'done') {
            logEntry.textContent = message.data;
        } else {
            logEntry.textContent = message.data;
        }

        log.appendChild(logEntry);
        log.scrollTop = log.scrollHeight;
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        log.innerHTML = '<div>Connection error. Please ensure the backend server is running and try refreshing.</div>';
    };

    ws.onclose = () => {
        console.log('⚪ WebSocket connection closed.');
        log.innerHTML += '<div>Connection closed. Please refresh the page.</div>';
        submitBtn.disabled = true;
    };
}

submitBtn.addEventListener('click', () => {
    const userProblem = promptInput.value;
    if (userProblem && ws.readyState === WebSocket.OPEN) {
        log.innerHTML = '';
        preview.src = 'about:blank'; // Clear the preview iframe
        ws.send(userProblem);
    } else if (ws.readyState !== WebSocket.OPEN) {
        log.innerHTML = '<div>Connection is not open. Please wait or refresh.</div>';
    }
});

submitBtn.disabled = true;
connectWebSocket();