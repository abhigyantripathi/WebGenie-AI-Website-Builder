import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import { exec } from "child_process";
import { promisify } from "util";
import os from 'os';
import fs from "fs/promises";
import path from "path";
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const platform = os.platform();
const bashPath = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
const GENERATED_SITE_DIR = 'generated-site';

// --- Helper function to ensure a directory exists ---
async function ensureDirectoryExists(directory) {
    try {
        await fs.mkdir(directory, { recursive: true });
    } catch (err) {
        console.error(`❌ Critical error: Failed to create directory ${directory}:`, err);
        // If we can't even create the directory, we should stop.
        process.exit(1);
    }
}

// --- Helper function to clear directory ---
async function clearDirectory(directory) {
    try {
        // First, check if the directory exists. If not, do nothing.
        await fs.access(directory);
        const files = await fs.readdir(directory);
        for (const file of files) {
            const filePath = path.join(directory, file);
            const stat = await fs.lstat(filePath);
            if (stat.isDirectory()) {
                // If you expect subdirectories, you might need a recursive delete
                // For now, we'll assume it's just files.
            } else {
                await fs.unlink(filePath);
            }
        }
        console.log(`✅ Directory ${directory} cleared.`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // This is fine, directory just doesn't exist to be cleared.
            return;
        }
        console.error(`❌ Failed to clear directory ${directory}:`, err);
        // Re-throw the error to be caught by the calling function's handler
        throw err;
    }
}


const asyncExecute = async (command) => {
  try {
    const { stdout, stderr } = await promisify(exec)(command, {
      shell: `"${bashPath}"`,
      env: process.env,
    });
    if (stderr) return `Error: ${stderr}`;
    return `Success: ${stdout} || Task executed completely`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

async function executeCommand({ command }, ws) {
  console.log("📤 Executing command:\n", command);
  ws.send(JSON.stringify({ type: 'command', data: command }));

  const trimmed = command.trim();
  const heredocMatch = trimmed.match(/^cat <<EOF > (.+?)\n([\s\S]*?)\nEOF$/);

  if (heredocMatch) {
    const filePath = heredocMatch[1].trim();
    const content = heredocMatch[2];

    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      console.log("✅ File written to:", filePath);
      ws.send(JSON.stringify({ type: 'file-update', data: { path: filePath } }));
      return `✅ File written to ${filePath}`;
    } catch (err) {
      return `❌ Failed to write file: ${err.message}`;
    }
  }

  try {
    const { stdout, stderr } = await asyncExecute(command);
    if (stderr) return `⚠️ Error: ${stderr}`;
    ws.send(JSON.stringify({ type: 'command-result', data: `✅ Success: ${stdout}` }));
    return `✅ Success: ${stdout}`;
  } catch (err) {
    return `❌ Exec failed: ${err.message}`;
  }
}


const executeCommandDeclaration = {
    name: "executeCommand",
    description: "Execute a single terminal/shell command. A command can be to create a folder, file, write on a file, edit the file or delete the file",
    parameters: {
        type: 'OBJECT',
        properties: {
            command: {
                type: 'STRING',
                description: 'It will be a single terminal command. Ex: "mkdir calculator"'
            },
        },
        required: ['command']
    }
}

const availableTools = {
    executeCommand
}

async function runAgent(userProblem, ws) {
    const History = []; // Reset history for each new request
    History.push({
        role: 'user',
        parts: [{ text: userProblem }]
    });

    while (true) {
        // *** CHANGE: Added a try...catch around the AI call itself ***
        try {
            const response = await ai.models.generateContent({
                model: "gemini-1.5-flash",
                contents: History,
                config: {
                    systemInstruction: `
    You are a website-building expert. Your job is to help the user build a frontend website step-by-step using terminal commands.

    ✅ IMPORTANT RULE:
    - ALL generated files (HTML, CSS, JS, images, etc.) MUST be placed inside the '${GENERATED_SITE_DIR}/' directory.
    - ALWAYS use the full path for file operations.
    - Example for creating a file: touch ${GENERATED_SITE_DIR}/index.html
    - Example for writing a file: cat <<EOF > ${GENERATED_SITE_DIR}/index.html

    ✅ Tools Available:
    - You can execute terminal or shell commands using the tool 'executeCommand'.

    🖥️ Environment:
    - The user's operating system is: ${platform}
    - Assume a Unix-like shell.

    📋 Your Workflow:
    1. Create HTML, CSS, and JS files directly inside the '${GENERATED_SITE_DIR}' folder. DO NOT create any sub-folders inside it unless necessary for the website structure itself.
    2. Write code into those files using the heredoc format.
    3. Use only one shell command at a time.
    4. Use the tool \`executeCommand\` for each shell command.
    `
    ,
                    tools: [{
                        functionDeclarations: [executeCommandDeclaration]
                    }],
                },
            });

            if (response.functionCalls && response.functionCalls.length > 0) {
                const { name, args } = response.functionCalls[0];
                const funCall = availableTools[name];
                const result = await funCall(args, ws);

                History.push({
                    role: "model",
                    parts: [{ functionCall: response.functionCalls[0] }],
                });

                History.push({
                    role: "user",
                    parts: [{ functionResponse: { name, response: { result } } }],
                });
            } else {
                History.push({
                    role: 'model',
                    parts: [{ text: response.text }]
                });
                ws.send(JSON.stringify({ type: 'done', data: response.text }));
                break;
            }
        } catch (error) {
            // *** NEW: Catch errors from the AI or tools and report them safely ***
            console.error("❌ Error during agent execution:", error);
            ws.send(JSON.stringify({ type: 'error', data: `An error occurred on the server: ${error.message}` }));
            break; // Exit the loop on error
        }
    }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));
app.use(express.static(GENERATED_SITE_DIR));

wss.on('connection', (ws) => {
    // *** CHANGE: Wrap the entire message handler in a try...catch block ***
    ws.on('message', async (message) => {
        try {
            await clearDirectory(GENERATED_SITE_DIR);

            const userProblem = message.toString();
            await runAgent(userProblem, ws);
        } catch (error) {
            // This is the safety net that prevents the server from crashing.
            console.error("❌ Fatal error in message handler:", error);
            ws.send(JSON.stringify({ type: 'error', data: 'A critical error occurred on the server. Please try again.' }));
        }
    });

    ws.on('error', (err) => {
        // Also log WebSocket-specific errors
        console.error("❌ WebSocket error:", err);
    });
});

// *** CHANGE: Use an async IIFE to set up directories before starting the server ***
(async () => {
    await ensureDirectoryExists(GENERATED_SITE_DIR);

    server.listen(3000, () => {
        console.log('✅ Server is running on http://localhost:3000');
        console.log(`Serving UI from 'public' and generated sites from '${GENERATED_SITE_DIR}'`);
    });
})();